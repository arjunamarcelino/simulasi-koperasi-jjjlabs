import { useEffect } from "react";
import { initAdminAuth, useAdminAuth } from "../stores/adminAuth.store";
import { LoginForm } from "../components/LoginForm";
import { AdminShell } from "../components/AdminShell";
import { NotAuthorized } from "../components/NotAuthorized";
import { StatusScreen } from "../components/StatusScreen";
import { assertNever } from "../lib/assertNever";

export function App() {
  const gate = useAdminAuth((s) => s.gate);

  // Idempotent (the store guards re-init), so React 19 StrictMode's double-invoke
  // never double-subscribes.
  useEffect(() => {
    initAdminAuth();
  }, []);

  switch (gate.status) {
    case "loading":
      return <StatusScreen title="Memuat…" />;
    case "authUnavailable":
      return (
        <StatusScreen
          title="Autentikasi tidak tersedia"
          message="Konfigurasi Supabase tidak ditemukan. Dasbor admin tidak dapat dibuka."
        />
      );
    case "unauthenticated":
      return <LoginForm />;
    case "authorized":
      return <AdminShell userId={gate.userId} />;
    case "notAuthorized":
      return <NotAuthorized refreshing={gate.refreshing} />;
    case "serviceUnavailable":
      return (
        <StatusScreen
          title="Layanan tidak tersedia"
          message="Tidak dapat memverifikasi akses admin saat ini."
          showRetry
        />
      );
    default:
      return assertNever(gate); // compile error if a new GateState member is unhandled
  }
}
