"""SIM-21: parsing/validasi output AI Auditor (gagal-aman).

Semua test SINKRON dan menjalankan coroutine via `asyncio.run(...)` — suite ini
tak punya plugin async (lih. konvensi test lain). Klien Azure OpenAI disuntikkan
(fixture `fake_openai`), jadi tak ada jaringan.
"""

from __future__ import annotations

import asyncio
import json

import pytest
from auditor import _FALLBACK_NARRATIVE, run_auditor
from scenarios import get_scenario

SCENARIO_ID = "kredit-macet"  # punya auditor (taxonomy + score_keys)
TRANSCRIPT = [("user", "halo pak"), ("assistant", "ya, ada apa?")]


def _run(fake_client) -> dict:
    scenario = get_scenario(SCENARIO_ID)
    return asyncio.run(
        run_auditor(fake_client, "dep-auditor", scenario, TRANSCRIPT, "manual")
    )


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


def test_valid_payload_passes_through_and_stamps(fake_openai):
    result = _run(fake_openai(_valid_payload()))
    assert result["stateClassification"]["State_Jalur_Remedi"] == "SESUAI"
    assert result["scores"] == {"member_centric": 80, "compliance": 70, "soft_skills": 65}
    assert result["endingType"] == "good"
    assert result["narrativeFeedback"].startswith("Petugas")
    # Stamp identitas otoritatif.
    assert result["scenarioId"] == SCENARIO_ID
    assert result["trigger"] == "manual"


def test_missing_keys_get_model_defaults(fake_openai):
    # Hanya endingType yang dikirim → sisanya diisi default model (partial salvage).
    result = _run(fake_openai(json.dumps({"endingType": "bad"})))
    assert result["endingType"] == "bad"
    assert result["stateClassification"] == {}
    assert result["scores"] == {}
    assert result["narrativeFeedback"] == ""
    assert result["scenarioId"] == SCENARIO_ID


# --- jalur gagal-aman: FALLBACK NETRAL (regresi crash) ----------------------


@pytest.mark.parametrize("content", ["null", "[1, 2]", "42", '"teks"', "true"])
def test_non_object_json_falls_back_without_crashing(fake_openai, content):
    # Regresi: dulu `None.setdefault` / non-dict crash DI LUAR try (session mati).
    result = _run(fake_openai(content))
    assert result["endingType"] == "neutral"
    assert result["narrativeFeedback"] == _FALLBACK_NARRATIVE
    assert result["scenarioId"] == SCENARIO_ID
    assert result["trigger"] == "manual"


def test_malformed_json_falls_back(fake_openai):
    result = _run(fake_openai("{bukan json"))
    assert result["endingType"] == "neutral"
    assert result["narrativeFeedback"] == _FALLBACK_NARRATIVE


def test_client_error_falls_back(fake_openai):
    result = _run(fake_openai(raises=RuntimeError("Azure down")))
    assert result["endingType"] == "neutral"
    assert result["narrativeFeedback"] == _FALLBACK_NARRATIVE


def test_empty_choices_falls_back(fake_openai):
    result = _run(fake_openai(no_choices=True))
    assert result["endingType"] == "neutral"
    assert result["narrativeFeedback"] == _FALLBACK_NARRATIVE


# --- salvage per-key (nilai salah-tipe/di-luar-rentang tak merusak sisanya) --


def test_mixed_scores_keeps_good_drops_bad(fake_openai):
    payload = json.dumps(
        {"scores": {"member_centric": 80, "compliance": "tinggi"}, "endingType": "neutral"}
    )
    result = _run(fake_openai(payload))
    # compliance ("tinggi") tak ternumerik → dibuang; member_centric tetap ada.
    assert result["scores"] == {"member_centric": 80}


def test_scores_out_of_range_are_clamped(fake_openai):
    payload = json.dumps({"scores": {"a": 150, "b": -5, "c": 99.7}})
    result = _run(fake_openai(payload))
    assert result["scores"] == {"a": 100, "b": 0, "c": 99}


def test_scores_infinity_and_overflow_salvage_per_key(fake_openai):
    # json.loads menghasilkan inf dari 1e999 dan int presisi-arbitrer dari literal
    # besar; keduanya tak boleh menjatuhkan seluruh audit (regresi OverflowError).
    payload = '{"scores": {"pos": 1e999, "neg": -1e999, "big": ' + "9" * 400 + ', "ok": 72}}'
    result = _run(fake_openai(payload))
    # pos/neg inf → clamp ke batas; big (overflow float) dibuang; ok tetap ada.
    assert result["scores"] == {"pos": 100, "neg": 0, "ok": 72}
    assert result["endingType"] == "neutral"  # BUKAN fallback penuh
    assert result["narrativeFeedback"] == ""  # field valid lain tak ikut hilang


def test_scores_nan_is_dropped(fake_openai):
    result = _run(fake_openai('{"scores": {"bad": NaN, "ok": 40}}'))
    assert result["scores"] == {"ok": 40}


def test_scores_wrong_type_becomes_empty_others_survive(fake_openai):
    payload = json.dumps({"scores": [1, 2, 3], "narrativeFeedback": "tetap ada"})
    result = _run(fake_openai(payload))
    assert result["scores"] == {}
    assert result["narrativeFeedback"] == "tetap ada"


def test_bad_ending_type_coerced_to_neutral(fake_openai):
    for bad in ("GOOD", "excellent", 42):
        payload = json.dumps({"endingType": bad, "scores": {"x": 50}})
        result = _run(fake_openai(payload))
        assert result["endingType"] == "neutral"
        assert result["scores"] == {"x": 50}  # salah endingType tak buang scores


def test_state_classification_non_dict_becomes_empty(fake_openai):
    payload = json.dumps({"stateClassification": ["a", "b"], "endingType": "good"})
    result = _run(fake_openai(payload))
    assert result["stateClassification"] == {}
    assert result["endingType"] == "good"


def test_state_classification_values_stringified(fake_openai):
    payload = json.dumps({"stateClassification": {"State_X": 3, "State_Y": None}})
    result = _run(fake_openai(payload))
    assert result["stateClassification"] == {"State_X": "3", "State_Y": ""}


def test_oversize_narrative_truncated_others_survive(fake_openai):
    payload = json.dumps({"narrativeFeedback": "x" * 5000, "scores": {"a": 50}})
    result = _run(fake_openai(payload))
    # Narasi dipotong (bukan menjatuhkan audit); scores valid tetap ada.
    assert len(result["narrativeFeedback"]) == 4000
    assert result["scores"] == {"a": 50}


def test_non_string_narrative_coerced_others_survive(fake_openai):
    for bad in (123, None, ["a"]):
        payload = json.dumps({"narrativeFeedback": bad, "endingType": "good"})
        result = _run(fake_openai(payload))
        assert isinstance(result["narrativeFeedback"], str)
        assert result["endingType"] == "good"  # salah-tipe narasi tak buang ending


def test_llm_supplied_identity_is_overwritten(fake_openai):
    payload = json.dumps(
        {"scenarioId": "HACKED", "trigger": "HACKED", "endingType": "good"}
    )
    result = _run(fake_openai(payload))
    assert result["scenarioId"] == SCENARIO_ID
    assert result["trigger"] == "manual"


# --- garansi "tak pernah raise" atas seluruh matriks ------------------------


@pytest.mark.parametrize(
    "kwargs",
    [
        {"content": None},
        {"content": ""},
        {"content": "{bad"},
        {"content": "null"},
        {"content": "[1,2]"},
        {"content": '{"scores": {"x": "abc"}}'},
        {"content": '{"stateClassification": 5}'},
        {"content": '{"endingType": []}'},
        {"raises": RuntimeError("boom")},
        {"no_choices": True},
    ],
)
def test_never_raises(fake_openai, kwargs):
    result = _run(fake_openai(**kwargs))
    assert isinstance(result, dict)
    assert result["scenarioId"] == SCENARIO_ID
    assert set(result) >= {
        "stateClassification",
        "scores",
        "endingType",
        "narrativeFeedback",
        "scenarioId",
        "trigger",
    }
