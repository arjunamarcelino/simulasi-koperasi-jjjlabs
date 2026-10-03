import { useCallback, useState, type FormEvent } from "react";
import { useAdminAuth } from "../stores/adminAuth.store";
import { Turnstile } from "./Turnstile";
import type { LoginErrorKind } from "../lib/mapAuthError";

const MESSAGES: Record<LoginErrorKind, string> = {
  invalid_credentials: "Email atau kata sandi salah.",
  email_not_confirmed: "Akun belum dikonfirmasi — hubungi admin sistem.",
  rate_limited: "Terlalu banyak percobaan. Coba lagi beberapa saat lagi.",
  unknown: "Gagal masuk. Coba lagi.",
};

export function LoginForm() {
  const signIn = useAdminAuth((s) => s.signIn);
  const gate = useAdminAuth((s) => s.gate);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState<string | undefined>(undefined);
  const onToken = useCallback((t: string | undefined) => setToken(t), []);

  const error = gate.status === "unauthenticated" ? gate.loginError : null;
  const signingIn = gate.status === "unauthenticated" && gate.signingIn;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void signIn(email.trim(), password, token);
  };

  // NO signup path — admin accounts are provisioned (service_role/dashboard).
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-xl font-bold text-forest">Admin — Simulasi Koperasi</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Email
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded border border-brown bg-parchment px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Kata sandi
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded border border-brown bg-parchment px-3 py-2"
          />
        </label>
        <Turnstile onToken={onToken} />
        {error && <p className="text-sm text-danger">{MESSAGES[error]}</p>}
        <button
          type="submit"
          disabled={signingIn}
          className="rounded bg-forest px-4 py-2 font-semibold text-cream disabled:opacity-60"
        >
          {signingIn ? "Masuk…" : "Masuk"}
        </button>
      </form>
    </main>
  );
}
