// Cloudflare Turnstile on the submit form: a check that a person sends the
// submission. The widget gives a token; the form posts it as `turnstileToken`
// and the gallery Worker verifies it with Cloudflare. The app never judges the
// token itself.
//
// The script loads when the form first shows the widget, not with the app. A
// token is good for one verification, so the form mounts a new widget (a new
// React key) after each attempt.

import { useEffect, useRef, useState } from "react";

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** The part of Turnstile's explicit-render API that the form uses. */
interface TurnstileApi {
  render(container: HTMLElement, options: TurnstileOptions): string | undefined;
  remove(widgetId: string): void;
}

interface TurnstileOptions {
  sitekey: string;
  theme: "dark";
  callback: (token: string) => void;
  "expired-callback": () => void;
  "error-callback": (code: string) => boolean;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | null = null;

/** Adds the script once per page. A failed load is forgotten, so the next widget tries again. */
export function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SCRIPT_URL;
      script.async = true;
      const fail = (message: string) => {
        loading = null;
        script.remove();
        reject(new Error(message));
      };
      script.onload = () => window.turnstile ? resolve(window.turnstile) : fail("Turnstile did not start.");
      script.onerror = () => fail("The check could not load. Check the connection, then close and reopen the form.");
      document.head.append(script);
    });
  }
  return loading;
}

/**
 * Shows the check and reports its token: a string when the visitor has passed,
 * null when there is none (not yet, expired or failed).
 */
export function TurnstileCheck({ siteKey, onToken }: { siteKey: string; onToken: (token: string | null) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // The widget calls back long after render; it must reach the current handler.
  const report = useRef(onToken);
  report.current = onToken;

  useEffect(() => {
    let widgetId: string | undefined;
    let mounted = true;
    loadTurnstile().then((turnstile) => {
      if (!mounted || !container.current) return;
      widgetId = turnstile.render(container.current, {
        sitekey: siteKey,
        theme: "dark",
        callback: (token) => {
          if (!mounted) return;
          setProblem(null);
          report.current(token);
        },
        "expired-callback": () => { if (mounted) report.current(null); },
        "error-callback": (code) => {
          if (!mounted) return true;
          report.current(null);
          setProblem(`The check did not complete (Turnstile error ${code}). It tries again by itself; reload the page if it stays.`);
          // Handled here: Turnstile does not also throw.
          return true;
        },
      });
    }).catch((error: unknown) => {
      if (mounted) setProblem(error instanceof Error ? error.message : String(error));
    });
    return () => {
      mounted = false;
      if (widgetId !== undefined) window.turnstile?.remove(widgetId);
      report.current(null);
    };
  }, [siteKey]);

  return (
    <div className="turnstile-check">
      <div ref={container} />
      {problem && <p className="gallery-problem">{problem}</p>}
    </div>
  );
}
