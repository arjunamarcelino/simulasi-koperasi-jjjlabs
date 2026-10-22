"""SIM-21: parsing/validasi output AI Auditor (gagal-aman).

Semua test SINKRON dan menjalankan coroutine via `asyncio.run(...)` — suite ini
tak punya plugin async (lih. konvensi test lain). Klien Gemini disuntikkan
(fixture `fake_gemini`), jadi tak ada jaringan.
"""

from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

import pytest
from evaluation import auditor
from evaluation.auditor import _FALLBACK_NARRATIVE, run_auditor
from google.genai import errors as genai_errors
from scenarios import get_scenario
from schemas import parse_history

SCENARIO_ID = "kredit-macet"  # punya auditor (taxonomy + score_keys)
TRANSCRIPT = [("user", "halo pak"), ("assistant", "ya, ada apa?")]


def _run(fake_client, history: list | None = None) -> dict:
    scenario = get_scenario(SCENARIO_ID)
    return asyncio.run(
        run_auditor(
            fake_client,
            "model-auditor",
            scenario,
            TRANSCRIPT,
            "manual",
            history=parse_history(history or []),
        )
    )


def _system_prompt(fake_client) -> str:
    return fake_client.calls[-1]["config"].system_instruction


def _valid_payload() -> str:
    return json.dumps(
        {
            "stateClassification": {
                "State_Analisis_Masalah": "BENAR",
                "State_Jalur_Remedi": "SESUAI",
            },
            "scores": {"member_centric": 80, "compliance": 70, "soft_skills": 65},
            "endingType": "good",
            "narrativeFeedback": "Petugas menggali akar masalah lebih dulu.",
        }
    )


# --- jalur sukses -----------------------------------------------------------


def test_valid_payload_passes_through_and_stamps(fake_gemini):
    result = _run(fake_gemini(_valid_payload()))
    assert result["stateClassification"]["State_Jalur_Remedi"] == "SESUAI"
    assert result["scores"] == {"member_centric": 80, "compliance": 70, "soft_skills": 65}
    assert result["endingType"] == "good"
    assert result["narrativeFeedback"].startswith("Petugas")
    # Stamp identitas otoritatif.
    assert result["scenarioId"] == SCENARIO_ID
    assert result["trigger"] == "manual"


def test_missing_keys_get_model_defaults(fake_gemini):
    # Hanya endingType yang dikirim → sisanya diisi default model (partial salvage).
    result = _run(fake_gemini(json.dumps({"endingType": "bad"})))
    assert result["endingType"] == "bad"
    assert result["stateClassification"] == {}
    assert result["scores"] == {}
    assert result["narrativeFeedback"] == ""
    assert result["scenarioId"] == SCENARIO_ID


# --- jalur gagal-aman: FALLBACK NETRAL (regresi crash) ----------------------


@pytest.mark.parametrize("content", ["null", "[1, 2]", "42", '"teks"', "true"])
def test_non_object_json_falls_back_without_crashing(fake_gemini, content):
    # Regresi: dulu `None.setdefault` / non-dict crash DI LUAR try (session mati).
    result = _run(fake_gemini(content))
    assert result["endingType"] == "neutral"
    assert result["narrativeFeedback"] == _FALLBACK_NARRATIVE
    assert result["scenarioId"] == SCENARIO_ID
    assert result["trigger"] == "manual"


def test_malformed_json_falls_back(fake_gemini):
    result = _run(fake_gemini("{bukan json"))
    assert result["endingType"] == "neutral"
    assert result["narrativeFeedback"] == _FALLBACK_NARRATIVE


def test_client_error_falls_back(fake_gemini):
    result = _run(fake_gemini(raises=RuntimeError("Gemini down")))
    assert result["endingType"] == "neutral"
    assert result["narrativeFeedback"] == _FALLBACK_NARRATIVE


def test_empty_content_falls_back_with_narrative(fake_gemini):
    # text None/"" (safety filter / tanpa kandidat / kosong) → fallback bernarasi, bukan blank.
    for content in (None, ""):
        result = _run(fake_gemini(content))
        assert result["endingType"] == "neutral"
        assert result["narrativeFeedback"] == _FALLBACK_NARRATIVE


# --- salvage per-key (nilai salah-tipe/di-luar-rentang tak merusak sisanya) --


def test_mixed_scores_keeps_good_drops_bad(fake_gemini):
    payload = json.dumps(
        {"scores": {"member_centric": 80, "compliance": "tinggi"}, "endingType": "neutral"}
    )
    result = _run(fake_gemini(payload))
    # compliance ("tinggi") tak ternumerik → dibuang; member_centric tetap ada.
    assert result["scores"] == {"member_centric": 80}


def test_scores_out_of_range_are_clamped(fake_gemini):
    payload = json.dumps({"scores": {"a": 150, "b": -5, "c": 99.7}})
    result = _run(fake_gemini(payload))
    assert result["scores"] == {"a": 100, "b": 0, "c": 99}


def test_scores_infinity_and_overflow_salvage_per_key(fake_gemini):
    # json.loads menghasilkan inf dari 1e999 dan int presisi-arbitrer dari literal
    # besar; keduanya tak boleh menjatuhkan seluruh audit (regresi OverflowError).
    payload = '{"scores": {"pos": 1e999, "neg": -1e999, "big": ' + "9" * 400 + ', "ok": 72}}'
    result = _run(fake_gemini(payload))
    # pos/neg inf → clamp ke batas; big (overflow float) dibuang; ok tetap ada.
    assert result["scores"] == {"pos": 100, "neg": 0, "ok": 72}
    assert result["endingType"] == "neutral"  # BUKAN fallback penuh
    assert result["narrativeFeedback"] == ""  # field valid lain tak ikut hilang


def test_scores_nan_is_dropped(fake_gemini):
    result = _run(fake_gemini('{"scores": {"bad": NaN, "ok": 40}}'))
    assert result["scores"] == {"ok": 40}


def test_scores_wrong_type_becomes_empty_others_survive(fake_gemini):
    payload = json.dumps({"scores": [1, 2, 3], "narrativeFeedback": "tetap ada"})
    result = _run(fake_gemini(payload))
    assert result["scores"] == {}
    assert result["narrativeFeedback"] == "tetap ada"


def test_bad_ending_type_coerced_to_neutral(fake_gemini):
    for bad in ("GOOD", "excellent", 42):
        payload = json.dumps({"endingType": bad, "scores": {"x": 50}})
        result = _run(fake_gemini(payload))
        assert result["endingType"] == "neutral"
        assert result["scores"] == {"x": 50}  # salah endingType tak buang scores


def test_state_classification_non_dict_becomes_empty(fake_gemini):
    payload = json.dumps({"stateClassification": ["a", "b"], "endingType": "good"})
    result = _run(fake_gemini(payload))
    assert result["stateClassification"] == {}
    assert result["endingType"] == "good"


def test_state_classification_values_stringified(fake_gemini):
    payload = json.dumps({"stateClassification": {"State_X": 3, "State_Y": None}})
    result = _run(fake_gemini(payload))
    assert result["stateClassification"] == {"State_X": "3", "State_Y": ""}


def test_state_classification_value_length_bounded(fake_gemini):
    # Nilai objek bersarang besar di-str() lalu dipotong (tak menyimpan blob tak terbatas).
    payload = json.dumps({"stateClassification": {"State_X": {"nested": "y" * 1000}}})
    result = _run(fake_gemini(payload))
    assert len(result["stateClassification"]["State_X"]) <= 200


def test_oversize_narrative_truncated_others_survive(fake_gemini):
    payload = json.dumps({"narrativeFeedback": "x" * 5000, "scores": {"a": 50}})
    result = _run(fake_gemini(payload))
    # Narasi dipotong (bukan menjatuhkan audit); scores valid tetap ada.
    assert len(result["narrativeFeedback"]) == 4000
    assert result["scores"] == {"a": 50}


def test_non_string_narrative_coerced_others_survive(fake_gemini):
    for bad in (123, None, ["a"]):
        payload = json.dumps({"narrativeFeedback": bad, "endingType": "good"})
        result = _run(fake_gemini(payload))
        assert isinstance(result["narrativeFeedback"], str)
        assert result["endingType"] == "good"  # salah-tipe narasi tak buang ending


def test_llm_supplied_identity_is_overwritten(fake_gemini):
    payload = json.dumps(
        {"scenarioId": "HACKED", "trigger": "HACKED", "endingType": "good"}
    )
    result = _run(fake_gemini(payload))
    assert result["scenarioId"] == SCENARIO_ID
    assert result["trigger"] == "manual"


def test_unhashable_ending_type_coerced_to_neutral(fake_gemini):
    # `[] in _ALLOWED_ENDINGS` akan TypeError tanpa guard isinstance di _coerce_ending.
    result = _run(fake_gemini('{"endingType": []}'))
    assert result["endingType"] == "neutral"


# --- garansi "tak pernah raise": sapuan wakil atas cabang-cabang exception utama,
# bukan pengulangan test ber-asersi-nilai di atas (lih. test spesifik masing-masing).


@pytest.mark.parametrize(
    "kwargs",
    [
        {"text": "{bad"},  # JSONDecodeError
        {"text": "null"},  # JSON valid non-object
        {"text": '{"scores": {"x": 1e999}}'},  # OverflowError di validator
        {"text": '{"endingType": []}'},  # nilai unhashable
        {"raises": RuntimeError("boom")},  # error klien
        {"text": None},  # tanpa kandidat (.text None)
    ],
)
def test_never_raises(fake_gemini, kwargs):
    result = _run(fake_gemini(**kwargs))
    assert isinstance(result, dict)
    assert result["scenarioId"] == SCENARIO_ID
    assert set(result) >= {
        "stateClassification",
        "scores",
        "endingType",
        "narrativeFeedback",
        "values",
        "progressFeedback",
        "nextStep",
        "evaluationFailed",
        "scenarioId",
        "trigger",
    }


# --- nilai ICA (feedback personal) ------------------------------------------
# kredit-macet menilai kepedulian, keadilan, tanggung_jawab_pribadi.


def _values_payload(values: object, **extra: object) -> str:
    base = json.loads(_valid_payload())
    base["values"] = values
    base.update(extra)
    return json.dumps(base)


def _value(status: str, evidence: str = "bukti") -> dict:
    return {"status": status, "evidence": evidence}


def _history_entry(**values: str) -> dict:
    return {
        "scenario_id": "keanggotaan-fiktif",
        "played_on": "2026-10-18",
        "values": {k: _value(s, f"bukti lama {k}") for k, s in values.items()},
        "next_step": "Tanyakan dulu kesulitan lawan bicara sebelum membahas aturan.",
    }


def test_values_progress_and_next_step_pass_through(fake_gemini):
    payload = _values_payload(
        {"kepedulian": _value("TERCERMIN", "Menanyakan kabar warung Pak Joko.")},
        progressFeedback="Ini titik awal Anda.",
        nextStep="Tanyakan komitmen pembayaran yang realistis.",
    )
    result = _run(fake_gemini(payload))
    assert result["values"] == {
        "kepedulian": {
            "status": "TERCERMIN",
            "evidence": "Menanyakan kabar warung Pak Joko.",
            "trend": "BARU_DIUJI",
        }
    }
    assert result["progressFeedback"] == "Ini titik awal Anda."
    assert result["nextStep"] == "Tanyakan komitmen pembayaran yang realistis."


def test_values_outside_scenario_spec_are_dropped(fake_gemini):
    payload = _values_payload(
        {"kepedulian": _value("TERCERMIN"), "demokrasi": _value("TERCERMIN")}
    )
    result = _run(fake_gemini(payload))
    assert set(result["values"]) == {"kepedulian"}


def test_value_status_is_case_insensitive_and_unknown_coerced(fake_gemini):
    payload = _values_payload(
        {"kepedulian": _value("tercermin"), "keadilan": _value("LUAR_BIASA")}
    )
    result = _run(fake_gemini(payload))
    assert result["values"]["kepedulian"]["status"] == "TERCERMIN"
    assert result["values"]["keadilan"]["status"] == "BELUM_TAMPAK"


def test_value_evidence_is_bounded(fake_gemini):
    result = _run(fake_gemini(_values_payload({"kepedulian": _value("TERCERMIN", "x" * 500)})))
    assert len(result["values"]["kepedulian"]["evidence"]) == 200


def test_values_wrong_type_becomes_empty_others_survive(fake_gemini):
    result = _run(fake_gemini(_values_payload(["kepedulian"])))
    assert result["values"] == {}
    assert result["endingType"] == "good"


def test_value_item_that_is_not_an_object_is_dropped(fake_gemini):
    payload = _values_payload({"kepedulian": "TERCERMIN", "keadilan": _value("TERCERMIN")})
    result = _run(fake_gemini(payload))
    assert set(result["values"]) == {"keadilan"}


def test_progress_and_next_step_are_bounded(fake_gemini):
    payload = _values_payload({}, progressFeedback="p" * 5000, nextStep=["bukan teks"])
    result = _run(fake_gemini(payload))
    assert len(result["progressFeedback"]) == 2000
    assert isinstance(result["nextStep"], str)


def test_state_violation_caps_conflicting_value(fake_gemini):
    payload = json.loads(_values_payload({"keadilan": _value("TERCERMIN")}))
    payload["stateClassification"]["State_Jalur_Remedi"] = "MELANGGAR_PROSEDUR"
    result = _run(fake_gemini(json.dumps(payload)))
    assert result["values"]["keadilan"]["status"] == "DIABAIKAN"


def test_trend_compares_with_player_history(fake_gemini):
    payload = _values_payload({"kepedulian": _value("TERCERMIN")})
    result = _run(fake_gemini(payload), history=[_history_entry(kepedulian="DIABAIKAN")])
    assert result["values"]["kepedulian"]["trend"] == "MENGUAT"


def test_history_from_unknown_scenario_is_ignored(fake_gemini):
    entry = _history_entry(kepedulian="DIABAIKAN") | {"scenario_id": "skenario-palsu"}
    client = fake_gemini(_values_payload({"kepedulian": _value("TERCERMIN")}))
    result = _run(client, history=[entry])
    assert result["values"]["kepedulian"]["trend"] == "BARU_DIUJI"
    assert "bukti lama kepedulian" not in _system_prompt(client)


def test_prompt_carries_history_evidence_and_last_next_step(fake_gemini):
    client = fake_gemini(_valid_payload())
    _run(client, history=[_history_entry(kepedulian="DIABAIKAN")])
    system = _system_prompt(client)
    assert "bukti lama kepedulian" in system
    assert "Tanyakan dulu kesulitan lawan bicara sebelum membahas aturan." in system
    assert "Pak Bambang" in system  # skenario lama disebut lewat NPC-nya


def test_prompt_marks_first_session_without_history(fake_gemini):
    client = fake_gemini(_valid_payload())
    _run(client)
    assert "belum ada riwayat" in _system_prompt(client)


def test_prompt_lists_only_the_scenario_values(fake_gemini):
    client = fake_gemini(_valid_payload())
    _run(client)
    system = _system_prompt(client)
    assert "Tanggung Jawab Pribadi" in system
    assert "Demokrasi" not in system


def test_fallback_has_no_values_or_progress(fake_gemini):
    result = _run(fake_gemini(raises=RuntimeError("Gemini down")))
    assert result["values"] == {}
    assert result["progressFeedback"] == ""
    assert result["nextStep"] == ""



# --- coba ulang + model cadangan (Gemini sibuk / gagal) ----------------------

PRIMARY = "model-utama"
FALLBACK = "model-cadangan"


def _overloaded() -> genai_errors.ServerError:
    return genai_errors.ServerError(
        503, {"error": {"code": 503, "message": "high demand", "status": "UNAVAILABLE"}}
    )


def _bad_request() -> genai_errors.ClientError:
    return genai_errors.ClientError(
        400, {"error": {"code": 400, "message": "bad", "status": "INVALID_ARGUMENT"}}
    )


def _scripted_client(script: dict[str, list]):
    """Per model: daftar hasil berurutan — str (teks respons) atau exception (dilempar)."""
    calls: list[str] = []

    async def _generate_content(**kwargs):
        model = kwargs["model"]
        calls.append(model)
        outcome = script[model].pop(0)
        if isinstance(outcome, BaseException):
            raise outcome
        return SimpleNamespace(text=outcome)

    return SimpleNamespace(
        aio=SimpleNamespace(models=SimpleNamespace(generate_content=_generate_content)),
        calls=calls,
    )


@pytest.fixture
def sleeps(monkeypatch) -> list[float]:
    """Jeda coba-ulang direkam, tidak benar-benar ditunggu."""
    recorded: list[float] = []

    async def _fake_sleep(delay: float) -> None:
        recorded.append(delay)

    monkeypatch.setattr(auditor, "_sleep", _fake_sleep)
    return recorded


def _run_models(client, *, fallback: str | None = FALLBACK) -> dict:
    return asyncio.run(
        run_auditor(
            client,
            PRIMARY,
            get_scenario(SCENARIO_ID),
            TRANSCRIPT,
            "manual",
            fallback_model=fallback,
        )
    )


def test_transient_error_is_retried_on_the_same_model(sleeps):
    client = _scripted_client({PRIMARY: [_overloaded(), _overloaded(), _valid_payload()]})
    result = _run_models(client)
    assert result["endingType"] == "good"
    assert client.calls == [PRIMARY, PRIMARY, PRIMARY]
    assert sleeps == [1.0, 2.0]  # jeda bertambah


def test_primary_exhausted_switches_to_fallback_model(sleeps):
    client = _scripted_client(
        {PRIMARY: [_overloaded()] * 4, FALLBACK: [_valid_payload()]}
    )
    result = _run_models(client)
    assert result["endingType"] == "good"
    assert client.calls == [PRIMARY] * 4 + [FALLBACK]
    assert sleeps == [1.0, 2.0, 4.0]


def test_non_transient_error_goes_straight_to_fallback(sleeps):
    client = _scripted_client({PRIMARY: [_bad_request()], FALLBACK: [_valid_payload()]})
    result = _run_models(client)
    assert result["endingType"] == "good"
    assert client.calls == [PRIMARY, FALLBACK]
    assert sleeps == []


def test_unparseable_output_tries_the_fallback_model(sleeps):
    client = _scripted_client({PRIMARY: ["{bukan json"], FALLBACK: [_valid_payload()]})
    result = _run_models(client)
    assert result["endingType"] == "good"
    assert client.calls == [PRIMARY, FALLBACK]


def test_all_models_failing_returns_the_fallback_narrative(sleeps):
    client = _scripted_client({PRIMARY: [_overloaded()] * 4, FALLBACK: [_overloaded()] * 4})
    result = _run_models(client)
    assert result["narrativeFeedback"] == _FALLBACK_NARRATIVE
    assert result["values"] == {}
    assert client.calls == [PRIMARY] * 4 + [FALLBACK] * 4


def test_without_fallback_model_only_the_primary_is_tried(sleeps):
    client = _scripted_client({PRIMARY: [_overloaded()] * 4})
    result = _run_models(client, fallback=None)
    assert result["narrativeFeedback"] == _FALLBACK_NARRATIVE
    assert client.calls == [PRIMARY] * 4


def test_success_on_first_try_never_touches_the_fallback(sleeps):
    client = _scripted_client({PRIMARY: [_valid_payload()], FALLBACK: []})
    _run_models(client)
    assert client.calls == [PRIMARY]
    assert sleeps == []


def test_time_budget_caps_the_whole_evaluation(monkeypatch):
    # Panggilan yang menggantung tak boleh menahan pemain: anggaran habis → fallback.
    monkeypatch.setattr(auditor, "_AUDIT_BUDGET_S", 0.05)

    async def _hang(**_kwargs):
        await asyncio.sleep(5)

    client = SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(generate_content=_hang)))
    result = _run_models(client)
    assert result["narrativeFeedback"] == _FALLBACK_NARRATIVE


def test_network_blip_is_retried_on_the_same_model(sleeps):
    import httpx

    client = _scripted_client({PRIMARY: [httpx.ConnectError("putus"), _valid_payload()]})
    result = _run_models(client)
    assert result["endingType"] == "good"
    assert client.calls == [PRIMARY, PRIMARY]



# --- penanda evaluasi gagal (FE menampilkan panel fallback, TIDAK menyimpan) --


def test_successful_evaluation_is_not_marked_failed(fake_gemini):
    assert _run(fake_gemini(_valid_payload()))["evaluationFailed"] is False


def test_fallback_result_is_marked_failed(fake_gemini):
    result = _run(fake_gemini(raises=RuntimeError("Gemini down")))
    assert result["narrativeFeedback"] == _FALLBACK_NARRATIVE
    assert result["evaluationFailed"] is True


def test_llm_cannot_mark_its_own_result_failed(fake_gemini):
    # Penanda di-stamp kode (anti-spoof, seperti scenarioId/trigger), bukan dari LLM.
    payload = json.loads(_valid_payload()) | {"evaluationFailed": True}
    assert _run(fake_gemini(json.dumps(payload)))["evaluationFailed"] is False
