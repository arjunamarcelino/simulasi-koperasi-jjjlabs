import { useAdminAuth } from "../stores/adminAuth.store";
import { DashboardPage } from "./dashboard/DashboardPage";

/**
 * Protected admin surface. Reaching this means require_role('admin') passed. Hosts the
 * dashboard metrics (SIM-15); the leaderboard and further widgets land in later M3 tickets.
 */
export function AdminShell({ userId }: { userId: string }) {
  const signOut = useAdminAuth((s) => s.signOut);
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-forest">Dasbor Admin</h1>
        <button
          onClick={() => void signOut()}
          className="rounded border border-brown px-3 py-1 text-sm"
        >
          Keluar
        </button>
      </header>
      <DashboardPage userId={userId} />
    </main>
  );
}
