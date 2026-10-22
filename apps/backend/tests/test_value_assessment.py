"""Feedback personal berbasis nilai ICA: cap konsistensi, tren, dan parse riwayat.

Fungsi murni (tanpa LLM/jaringan). Integrasinya ke `run_auditor` diuji di
`test_auditor_parse.py`.
"""

from __future__ import annotations

import pytest
from evaluation.auditor import _apply_value_caps, _compute_trends
from scenarios import ValueCap
from schemas import parse_history


def _entry(scenario_id: str = "kredit-macet", **values: str) -> dict:
    return {
        "scenario_id": scenario_id,
        "played_on": "2026-10-18",
        "values": {k: {"status": s, "evidence": f"bukti {k}"} for k, s in values.items()},
        "next_step": "",
    }


def _current(**values: str) -> dict:
    return {k: {"status": s, "evidence": f"bukti {k}"} for k, s in values.items()}


# --- tren: dibanding kemunculan TERAKHIR nilai yang sama --------------------


@pytest.mark.parametrize(
    ("prev", "cur", "trend"),
    [
        ("DIABAIKAN", "TERCERMIN", "MENGUAT"),
        ("BELUM_TAMPAK", "TERCERMIN", "MENGUAT"),
        ("TERCERMIN", "TERCERMIN", "TETAP"),
        ("DIABAIKAN", "DIABAIKAN", "TETAP"),
        ("TERCERMIN", "BELUM_TAMPAK", "MELEMAH"),
        ("BELUM_TAMPAK", "DIABAIKAN", "MELEMAH"),
    ],
)
def test_trend_from_previous_status(prev, cur, trend):
    history = parse_history([_entry(kepedulian=prev)])
    out = _compute_trends(_current(kepedulian=cur), history)
    assert out["kepedulian"]["trend"] == trend


def test_trend_is_baru_diuji_when_value_never_assessed():
    history = parse_history([_entry(keadilan="TERCERMIN")])
    out = _compute_trends(_current(kepedulian="TERCERMIN"), history)
    assert out["kepedulian"]["trend"] == "BARU_DIUJI"


def test_trend_uses_most_recent_occurrence_only():
    # Riwayat terbaru dulu: TERCERMIN (terbaru) mengalahkan DIABAIKAN (lebih lama).
    history = parse_history([_entry(kepedulian="TERCERMIN"), _entry(kepedulian="DIABAIKAN")])
    out = _compute_trends(_current(kepedulian="TERCERMIN"), history)
    assert out["kepedulian"]["trend"] == "TETAP"


def test_trend_skips_sessions_that_did_not_assess_the_value():
    # Lintas skenario: sesi terbaru (RAT) tak menilai keadilan → pakai sesi sebelumnya.
    history = parse_history(
        [
            _entry("rapat-anggota-tahunan", demokrasi="TERCERMIN"),
            _entry("kredit-macet", keadilan="DIABAIKAN"),
        ]
    )
    out = _compute_trends(_current(keadilan="TERCERMIN"), history)
    assert out["keadilan"]["trend"] == "MENGUAT"


def test_trend_keeps_status_and_evidence():
    out = _compute_trends(_current(kepedulian="TERCERMIN"), [])
    assert out["kepedulian"] == {
        "status": "TERCERMIN",
        "evidence": "bukti kepedulian",
        "trend": "BARU_DIUJI",
    }


# --- cap: label nilai tak boleh bertentangan dengan state auditor -----------

_CAP = ValueCap(state="State_Jalur_Remedi", state_value="MELANGGAR_PROSEDUR", value="keadilan")


def test_cap_lowers_status_when_state_matches():
    out = _apply_value_caps(
        _current(keadilan="TERCERMIN"), {"State_Jalur_Remedi": "MELANGGAR_PROSEDUR"}, (_CAP,)
    )
    assert out["keadilan"]["status"] == "DIABAIKAN"
    assert out["keadilan"]["evidence"] == "bukti keadilan"  # bukti LLM dipertahankan


def test_cap_ignored_when_state_differs():
    out = _apply_value_caps(
        _current(keadilan="TERCERMIN"), {"State_Jalur_Remedi": "SESUAI"}, (_CAP,)
    )
    assert out["keadilan"]["status"] == "TERCERMIN"


def test_cap_never_raises_a_lower_status():
    cap = ValueCap(
        state="State_Jalur_Remedi",
        state_value="MELANGGAR_PROSEDUR",
        value="keadilan",
        max_status="BELUM_TAMPAK",
    )
    out = _apply_value_caps(
        _current(keadilan="DIABAIKAN"), {"State_Jalur_Remedi": "MELANGGAR_PROSEDUR"}, (cap,)
    )
    assert out["keadilan"]["status"] == "DIABAIKAN"


def test_cap_for_unassessed_value_is_noop():
    out = _apply_value_caps(
        _current(kepedulian="TERCERMIN"), {"State_Jalur_Remedi": "MELANGGAR_PROSEDUR"}, (_CAP,)
    )
    assert out == _current(kepedulian="TERCERMIN")


# --- parse_history: riwayat dari metadata dispatch, gagal-aman --------------


@pytest.mark.parametrize("raw", [None, {}, "teks", 42])
def test_parse_history_non_list_is_empty(raw):
    assert parse_history(raw) == []


def test_parse_history_drops_malformed_entries():
    raw = [_entry(kepedulian="TERCERMIN"), "sampah", {"values": {}}, {"scenario_id": 5}]
    history = parse_history(raw)
    assert [e.scenario_id for e in history] == ["kredit-macet"]


def test_parse_history_keeps_at_most_five_newest():
    raw = [_entry(f"s-{i}", kepedulian="TERCERMIN") for i in range(8)]
    assert [e.scenario_id for e in parse_history(raw)] == [f"s-{i}" for i in range(5)]


def test_parse_history_coerces_values_and_bounds_text():
    raw = [
        {
            "scenario_id": "kredit-macet",
            "values": {
                "kepedulian": {"status": "luar biasa", "evidence": "x" * 500},
                "keadilan": "TERCERMIN",  # bukan objek → dibuang
            },
            "next_step": "y" * 900,
        }
    ]
    (entry,) = parse_history(raw)
    assert entry.values["kepedulian"].status == "BELUM_TAMPAK"
    assert len(entry.values["kepedulian"].evidence) == 200
    assert "keadilan" not in entry.values
    assert len(entry.next_step) == 300
