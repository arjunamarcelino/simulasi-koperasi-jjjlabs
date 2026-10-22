import { useAdminAuth } from "../stores/adminAuth.store";

/**
 * 403: a signed-in user who is not an admin (or whose just-granted admin claim hasn't
 * propagated to their token yet). The session is KEPT — "Refresh session & retry"
 * re-mints the token (picking up a fresh is_admin claim) and re-probes; "Keluar" is
 * the only sign-out, never automatic.
 */
export function NotAuthorized({ refreshing }: { refreshing: boolean }) {
  const refreshAndRetry = useAdminAuth((s) => s.refreshAndRetry);
  const signOut = useAdminAuth((s) => s.signOut);
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-bold text-danger">Tidak berwenang</h1>
      <p className="text-ink-soft">
        Akun ini bukan admin. Jika Anda baru saja dijadikan admin, segarkan sesi.
      </p>
      <div className="flex flex-col gap-2">
        <button
          onClick={() => void refreshAndRetry()}
          disabled={refreshing}
          className="rounded bg-forest px-4 py-2 font-semibold text-cream disabled:opacity-60"
        >
          {refreshing ? "Menyegarkan…" : "Segarkan sesi & coba lagi"}
        </button>
        <button
          onClick={() => void signOut()}
          className="rounded border border-brown px-4 py-2"
        >
          Keluar
        </button>
      </div>
    </main>
  );
}
