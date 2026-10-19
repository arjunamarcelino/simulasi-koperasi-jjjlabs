"""Model auditor cadangan dibaca dari env (nama model = env, GOTCHA #6)."""

from __future__ import annotations

import settings


def test_auditor_fallback_model_defaults_to_lite(monkeypatch):
    monkeypatch.delenv("GEMINI_AUDITOR_FALLBACK_MODEL", raising=False)
    assert settings.models().auditor_fallback == "gemini-3.5-flash-lite"


def test_auditor_fallback_model_from_env(monkeypatch):
    monkeypatch.setenv("GEMINI_AUDITOR_FALLBACK_MODEL", "model-x")
    assert settings.models().auditor_fallback == "model-x"


def test_empty_auditor_fallback_disables_it(monkeypatch):
    monkeypatch.setenv("GEMINI_AUDITOR_FALLBACK_MODEL", "  ")
    assert settings.models().auditor_fallback is None
