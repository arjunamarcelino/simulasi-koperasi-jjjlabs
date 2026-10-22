import { useEffect, useRef } from "react";
import { ENV } from "../config/env";

/**
 * Cloudflare Turnstile widget. Supabase CAPTCHA is project-global, so admin password
 * login needs a token when it's enabled. Renders only when VITE_TURNSTILE_SITE_KEY is
 * set; otherwise nothing (login proceeds tokenless — fine locally where CAPTCHA is off).
 */
type TurnstileApi = {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      callback: (token: string) => void;
      "error-callback"?: () => void;
      "expired-callback"?: () => void;
    },
  ) => string;
  remove: (id: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";

export function Turnstile({ onToken }: { onToken: (token: string | undefined) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const siteKey = ENV.turnstileSiteKey?.trim();

  useEffect(() => {
    const el = ref.current;
    if (!siteKey || !el) return;
    let widgetId: string | undefined;

    const render = () => {
      if (!window.turnstile) return;
      widgetId = window.turnstile.render(el, {
        sitekey: siteKey,
        callback: (t) => onToken(t),
        "error-callback": () => onToken(undefined),
        "expired-callback": () => onToken(undefined),
      });
    };

    if (window.turnstile) {
      render();
    } else {
      const script = document.createElement("script");
      script.src = SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      script.onload = render;
      document.head.appendChild(script);
    }

    return () => {
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [siteKey, onToken]);

  if (!siteKey) return null;
  return <div ref={ref} />;
}
