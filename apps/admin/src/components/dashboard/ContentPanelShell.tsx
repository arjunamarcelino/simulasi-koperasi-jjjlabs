import type { ReactNode } from "react";
import type { Toast } from "../../stores/adminCrud";

/**
 * Shared chrome for the SIM-18 content panels (quiz + mading). Keeps each panel's narrowing simple:
 * the panel returns <PanelFallback> for the non-ready states, then renders its ready UI inside
 * <ContentPanelShell>. Extracted so the loading/error/idle guards + the status toast + the heading
 * row aren't duplicated across both panels (review P3).
 */
type UiStatus = "idle" | "loading" | "ready" | "error" | "authLost";

/** Loading / authLost message, error + retry, or null for idle. (Ready is rendered by the caller.) */
export function PanelFallback({
  status,
  loadingText,
  errorText,
  onRetry,
}: {
  status: UiStatus;
  loadingText: string;
  errorText: string;
  onRetry: () => void;
}) {
  if (status === "loading" || status === "authLost") {
    return <p className="text-ink-soft">{loadingText}</p>;
  }
  if (status === "error") {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-ink-soft">{errorText}</p>
        <button onClick={onRetry} className="rounded bg-forest px-4 py-2 font-semibold text-cream">
          Coba lagi
        </button>
      </div>
    );
  }
  return null; // idle
}

/** Ready-state wrapper: a heading row (title + optional right slot), the status toast, then content. */
export function ContentPanelShell({
  title,
  headerRight,
  toast,
  children,
}: {
  title: string;
  headerRight?: ReactNode;
  toast: Toast | null;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-forest">{title}</h2>
        {headerRight}
      </div>
      {toast && (
        <p
          className={`text-sm ${toast.tone === "success" ? "text-forest" : "text-red-700"}`}
          role="status"
        >
          {toast.text}
        </p>
      )}
      {children}
    </div>
  );
}
