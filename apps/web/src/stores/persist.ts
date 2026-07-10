/**
 * Tiny typed localStorage helpers for the game store. All access is guarded
 * (storage may be unavailable / quota-full / corrupt); on any failure we fall
 * back to defaults so the session keeps running in-memory.
 *
 * Rules: JSON is parsed AS `unknown` (never `any`) and validated with a type
 * guard before use.
 */

export function loadNumber(key: string, fallback: number): number {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

export function saveNumber(key: string, value: number): void {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // storage unavailable / full — session continues in-memory
  }
}

export function loadJson<T>(
  key: string,
  fallback: T,
  isValid: (u: unknown) => u is T,
): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return isValid(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function saveJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable / full — session continues in-memory
  }
}
