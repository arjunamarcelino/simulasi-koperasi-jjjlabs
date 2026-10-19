"""Hasil terskrip tutorial membawa bentuk `AuditorResult` lengkap (tanpa nilai ICA)."""

from __future__ import annotations

from scenarios import get_scenario
from single_npc.runner import scripted_result


def test_tutorial_result_has_empty_personal_feedback():
    result = scripted_result(get_scenario("tutorial-koperasi-konsumen"), "manual")
    assert result["values"] == {}
    assert result["progressFeedback"] == ""
    assert result["nextStep"] == ""
    assert result["evaluationFailed"] is False
