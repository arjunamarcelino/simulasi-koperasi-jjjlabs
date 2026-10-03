import { useAdminAuth } from "../stores/adminAuth.store";

/**
 * Protected admin landing — placeholder shell (SIM-14 is the GATE; real dashboard
 * widgets land in later M3 tickets). Reaching this means require_role('admin') passed.
 */
export function AdminShell({ userId }: { userId: string }) {
  const signOut = useAdminAuth((s) => s.signOut);
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-forest">Dasbor Admin</h1>
        <button
          onClick={() => void signOut()}
          className="rounded border border-brown px-3 py-1 text-sm"
        >
          Keluar
        </button>
      </header>
      <p className="text-ink-soft">
        Anda masuk sebagai admin (<code>{userId}</code>). Fitur dasbor (analitik,
        papan peringkat) menyusul di tiket M3 berikutnya.
      </p>
    </main>
  );
}
