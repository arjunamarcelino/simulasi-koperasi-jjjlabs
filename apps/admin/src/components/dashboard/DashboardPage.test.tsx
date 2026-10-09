// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { DashboardPage } from "./DashboardPage";
import { dashboardMetricsStore } from "../../stores/dashboardMetrics.store";
import { scenarioAnalyticsStore } from "../../stores/scenarioAnalytics.store";

afterEach(cleanup);

describe("DashboardPage unmount owner", () => {
  it("tears down BOTH the metrics store and the drill-down store on unmount", () => {
    // supabase is degraded-null without env → the mount fetch resolves to a non-network error
    // state; we only assert the single unmount effect owns both teardowns.
    const dispose = vi.spyOn(dashboardMetricsStore.getState(), "dispose");
    const close = vi.spyOn(scenarioAnalyticsStore.getState(), "close");
    const { unmount } = render(<DashboardPage userId="u1" />);
    unmount();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    dispose.mockRestore();
    close.mockRestore();
  });
});
