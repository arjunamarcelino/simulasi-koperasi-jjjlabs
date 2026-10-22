import { useAdminAuth } from "../stores/adminAuth.store";

/**
 * Shared presentational surface for the non-interactive gate states: boot "loading",
 * terminal "auth unavailable" (no env — shell never renders), and transient/hard
 * "service unavailable" (with an optional manual retry). Distinct typed states, one
 * component — copy differs, not structure.
 */
export function StatusScreen({
  title,
  message,
  showRetry = false,
}: {
  title: string;
  message?: string;
  showRetry?: boolean;
}) {
  const retry = useAdminAuth((s) => s.retry);
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-lg font-bold text-forest">{title}</h1>
      {message && <p className="text-ink-soft">{message}</p>}
      {showRetry && (
        <button
          onClick={() => void retry()}
          className="rounded bg-forest px-4 py-2 font-semibold text-cream"
        >
          Coba lagi
        </button>
      )}
    </main>
  );
}
