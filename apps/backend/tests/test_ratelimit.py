"""Test rate limiter (H1): unit token-bucket + wiring 429 di /token."""

from __future__ import annotations

from api import server
from api.auth import AuthedUser, verify_supabase_jwt
from api.ratelimit import RateLimiter


class _Clock:
    """Jam yang bisa dimajukan manual (tanpa sleep nyata)."""

    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t

    def advance(self, dt: float) -> None:
        self.t += dt


# ------------------------------ unit -------------------------------------


def test_allows_up_to_capacity_then_blocks():
    clock = _Clock()
    rl = RateLimiter(capacity=3, refill_seconds=60, clock=clock)
    assert rl.check("u") == 0.0
    assert rl.check("u") == 0.0
    assert rl.check("u") == 0.0
    assert rl.check("u") > 0.0  # token ke-4 → ditolak, saran Retry-After > 0


def test_keys_are_isolated():
    clock = _Clock()
    rl = RateLimiter(capacity=1, refill_seconds=60, clock=clock)
    assert rl.check("a") == 0.0
    assert rl.check("a") > 0.0  # a habis
    assert rl.check("b") == 0.0  # b tak terpengaruh


def test_refills_over_time():
    clock = _Clock()
    rl = RateLimiter(capacity=2, refill_seconds=60, clock=clock)  # ~1 token / 30 dtk
    assert rl.check("u") == 0.0
    assert rl.check("u") == 0.0
    assert rl.check("u") > 0.0
    clock.advance(30)  # isi ulang ~1 token
    assert rl.check("u") == 0.0


def test_invalid_config_rejected():
    import pytest

    with pytest.raises(ValueError):
        RateLimiter(capacity=0, refill_seconds=60)
    with pytest.raises(ValueError):
        RateLimiter(capacity=1, refill_seconds=0)


# ---------------------------- wiring 429 ---------------------------------


def test_over_limit_returns_429_with_retry_after(client, monkeypatch):
    monkeypatch.setattr(server, "_TOKEN_LIMITER", RateLimiter(2, 60))
    server.app.dependency_overrides[verify_supabase_jwt] = lambda: AuthedUser(
        user_id="heavy-user", is_anonymous=False, claims={}
    )
    ok1 = client.post("/token", json={"scenario_id": "kredit-macet"})
    ok2 = client.post("/token", json={"scenario_id": "kredit-macet"})
    blocked = client.post("/token", json={"scenario_id": "kredit-macet"})
    assert ok1.status_code == 200
    assert ok2.status_code == 200
    assert blocked.status_code == 429
    assert int(blocked.headers["retry-after"]) >= 1


def test_limit_is_per_user(client, monkeypatch):
    monkeypatch.setattr(server, "_TOKEN_LIMITER", RateLimiter(1, 60))
    current = {"uid": "user-1"}
    server.app.dependency_overrides[verify_supabase_jwt] = lambda: AuthedUser(
        user_id=current["uid"], is_anonymous=False, claims={}
    )
    assert client.post("/token", json={"scenario_id": "kredit-macet"}).status_code == 200
    assert client.post("/token", json={"scenario_id": "kredit-macet"}).status_code == 429
    current["uid"] = "user-2"  # user berbeda → kuota sendiri
    assert client.post("/token", json={"scenario_id": "kredit-macet"}).status_code == 200
