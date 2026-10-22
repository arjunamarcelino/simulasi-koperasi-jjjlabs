"""Akhir sesi: satu hasil per sesi; auditor tak pernah jalan dua kali (race lama)."""

from __future__ import annotations

import asyncio

from runtime.lifecycle import SessionLifecycle


class _Pub:
    def __init__(self) -> None:
        self.ended: list[dict] = []

    async def session_ended(self, result: dict) -> None:
        self.ended.append(result)


def _build(delay: float = 0.0):
    calls: list[str] = []
    stops: list[int] = []
    pub = _Pub()

    async def _stop() -> None:
        stops.append(1)

    async def _finalize(trigger: str) -> dict:
        calls.append(trigger)
        await asyncio.sleep(delay)
        return {"trigger": trigger}

    lc = SessionLifecycle(stop_speaking=_stop, finalize=_finalize, publisher=pub)
    return lc, calls, stops, pub


def test_manual_end_runs_finalize_once_and_returns_same_result():
    async def go():
        lc, calls, stops, pub = _build()
        first = await lc.end_manual()
        second = await lc.end_manual()
        return lc, first, second, calls, stops, pub

    lc, first, second, calls, stops, pub = asyncio.run(go())
    assert lc.ended
    assert first == second == {"trigger": "manual"}
    assert calls == ["manual"] and stops == [1]
    assert pub.ended == []  # jalur manual: hasil lewat balasan RPC, bukan data message


def test_concurrent_manual_and_force_quit_share_one_result():
    async def go():
        lc, calls, _, pub = _build(delay=0.05)
        manual, _ = await asyncio.gather(lc.end_manual(), lc.force_quit())
        return manual, calls, pub

    manual, calls, pub = asyncio.run(go())
    assert calls == ["manual"]  # yang pertama menang; auditor sekali
    assert manual == {"trigger": "manual"}
    assert pub.ended == []  # force-quit datang kedua → tak publish ulang


def test_force_quit_publishes_and_later_end_session_gets_same_result():
    async def go():
        lc, calls, _, pub = _build()
        await lc.force_quit()
        late = await lc.end_manual()
        return late, calls, pub

    late, calls, pub = asyncio.run(go())
    assert calls == ["force_quit_level_2"]
    assert pub.ended == [{"trigger": "force_quit_level_2"}]
    assert late == {"trigger": "force_quit_level_2"}


def test_stop_failure_does_not_lose_result():
    async def go():
        lc, calls, _, _ = _build()

        async def _boom() -> None:
            raise RuntimeError("AgentSession isn't running")

        lc._stop_speaking = _boom
        return await lc.end_manual(), calls

    result, calls = asyncio.run(go())
    assert result == {"trigger": "manual"} and calls == ["manual"]
