"""Rate limiter in-memory (token bucket) untuk /token — mitigasi H1.

Setiap `POST /token` yang sukses mint room + men-dispatch agent LLM berbayar.
Tanpa batas, satu JWT guest yang valid (~1 jam) bisa loop /token tanpa henti →
biaya membengkak. Limiter ini membatasi per-`sub` (setelah auth) → 429.

Catatan: in-memory = single-process. Untuk deploy multi-worker, ganti ke store
bersama (mis. Redis). Cukup untuk v1. Limiter per-`sub` TIDAK membatasi abuse
anonim secara agregat (tiap sign-in anonim = `sub` baru = bucket baru) — itu
dibatasi oleh CAPTCHA/rate-limit sign-in anonim sisi Supabase (SIM-1).
"""

from __future__ import annotations

import threading
import time
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass


@dataclass
class _Bucket:
    tokens: float
    updated: float


class RateLimiter:
    """Token bucket per-key, aman-thread (endpoint sync jalan di threadpool).

    `max_keys` adalah batas KERAS: bucket disimpan di LRU dan yang paling lama tak
    dipakai dievaksi (O(1)) saat penuh, jadi dict tak pernah melampaui `max_keys`.
    """

    def __init__(
        self,
        capacity: int,
        refill_seconds: float,
        *,
        clock: Callable[[], float] = time.monotonic,
        max_keys: int = 100_000,
    ) -> None:
        if capacity < 1 or refill_seconds <= 0:
            raise ValueError("capacity >= 1 dan refill_seconds > 0")
        if max_keys < 1:
            raise ValueError("max_keys >= 1")
        self._capacity = float(capacity)
        self._refill_rate = capacity / refill_seconds  # token per detik
        self._clock = clock
        self._max_keys = max_keys
        self._buckets: OrderedDict[str, _Bucket] = OrderedDict()
        self._lock = threading.Lock()

    def check(self, key: str) -> float:
        """Konsumsi satu token untuk `key`.

        Returns:
            0.0 bila diizinkan; selain itu perkiraan detik hingga token berikutnya
            tersedia (dipakai sebagai `Retry-After`).
        """
        now = self._clock()
        with self._lock:
            bucket = self._buckets.get(key)
            if bucket is None:
                if len(self._buckets) >= self._max_keys:
                    self._buckets.popitem(last=False)  # evaksi LRU (paling lama tak dipakai)
                bucket = _Bucket(tokens=self._capacity, updated=now)
                self._buckets[key] = bucket
            else:
                self._buckets.move_to_end(key)  # tandai baru-dipakai (LRU)
                elapsed = now - bucket.updated
                bucket.tokens = min(
                    self._capacity, bucket.tokens + elapsed * self._refill_rate
                )
                bucket.updated = now

            if bucket.tokens >= 1.0:
                bucket.tokens -= 1.0
                return 0.0
            return (1.0 - bucket.tokens) / self._refill_rate
