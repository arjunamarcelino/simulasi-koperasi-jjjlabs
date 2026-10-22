"""Observer (Lapisan 2): penilaian gagal-aman + DriftTracker."""

from __future__ import annotations

import asyncio
import json

import pytest
from evaluation.observer import DriftTracker, evaluate_turn
from scenarios import get_scenario

SPEC = get_scenario("kredit-macet").drift


def _judge(client) -> str:
    return asyncio.run(evaluate_turn(client, "model-observer", SPEC, "bayar sekarang!", "maaf"))


@pytest.mark.parametrize("judgment", ["escalate", "neutral", "deescalate"])
def test_valid_judgment_passes(fake_gemini, judgment):
    assert _judge(fake_gemini(json.dumps({"judgment": judgment}))) == judgment


@pytest.mark.parametrize(
    "kwargs",
    [
        {"text": json.dumps({"judgment": "marah"})},
        {"text": "{bad"},
        {"text": None},
        {"raises": RuntimeError("down")},
    ],
)
def test_bad_output_is_neutral(fake_gemini, kwargs):
    assert _judge(fake_gemini(**kwargs)) == "neutral"


def test_uses_json_mode(fake_gemini):
    client = fake_gemini(json.dumps({"judgment": "neutral"}))
    _judge(client)
    assert client.calls[0]["config"].response_mime_type == "application/json"
    assert client.calls[0]["model"] == "model-observer"


def test_tracker_levels_rise_and_fall():
    t = DriftTracker(SPEC)  # level1=2, level2=4
    seq = ["escalate", "neutral", "escalate", "escalate", "deescalate", "escalate", "escalate"]
    assert [t.apply(j) for j in seq] == [0, 0, 1, 1, 1, 1, 2]
