import type { Unsubscribe } from "./contract";

/** Minimal emitter: enough for every stream, no dependency. Shared by the mock and
 * LiveKit transports (identical fan-out semantics). */
export class Emitter<T> {
  private readonly listeners = new Set<(value: T) => void>();

  subscribe(cb: (value: T) => void): Unsubscribe {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  emit(value: T): void {
    for (const cb of [...this.listeners]) cb(value);
  }

  clear(): void {
    this.listeners.clear();
  }
}
