import { ENV } from "../config/env";
import type { SessionTransport } from "./contract.provisional";
import { LiveKitTransport } from "./livekit/LiveKitTransport";
import { MockTransport } from "./mock/MockTransport";

/** Satu-satunya tempat implementasi konkret disebut namanya. */
export function createTransport(): SessionTransport {
  switch (ENV.transport) {
    case "livekit":
      return new LiveKitTransport();
    case "mock":
      return new MockTransport();
  }
}
