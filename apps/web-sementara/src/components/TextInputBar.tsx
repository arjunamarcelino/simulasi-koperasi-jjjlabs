import { useState } from "react";
import { sessionController } from "../session/controller";
import { useSessionStore } from "../stores/session.store";

export function TextInputBar() {
  const connected = useSessionStore((s) => s.connection === "connected");
  const [value, setValue] = useState("");

  const submit = () => {
    const text = value.trim();
    if (!text || !connected) return;
    sessionController.sendPlayerText(text);
    setValue("");
  };

  return (
    <form
      className="flex flex-1 gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <input
        className="flex-1 rounded-lg border border-line bg-parchment px-3 py-2 outline-none focus:border-forest disabled:opacity-50"
        placeholder={
          connected ? "Ketik jawaban Anda…" : "Menunggu koneksi sesi…"
        }
        value={value}
        disabled={!connected}
        onChange={(event) => setValue(event.target.value)}
      />
      <button
        type="submit"
        disabled={!connected || value.trim() === ""}
        className="rounded-lg bg-forest px-4 py-2 font-semibold text-cream disabled:opacity-40"
      >
        Kirim
      </button>
    </form>
  );
}
