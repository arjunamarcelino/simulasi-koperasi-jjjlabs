import { ENV } from "../../config/env";
import type { SessionTransport } from "./contract";
import { LiveKitTransport } from "./livekit/LiveKitTransport";
import { MockTransport } from "./mock/MockTransport";

/**
 * The single place a concrete transport is named. Sync + static import on
 * purpose: keeping `createTransport`/`start()` synchronous avoids widening the
 * mount/unmount lifecycle race (see plan §Gotcha 1/3). livekit-client rides in
 * the bundle regardless of mode — acceptable for this app.
 */
export function createTransport(): SessionTransport {
  switch (ENV.transport) {
    case "livekit":
      return new LiveKitTransport();
    case "mock":
      return new MockTransport();
  }
}
