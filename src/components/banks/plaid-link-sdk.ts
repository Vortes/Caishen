import type { PlaidLinkMetadata } from "~/lib/plaid-link-metadata";

export type PlaidHandler = { open: () => void; destroy: () => void };
export type PlaidSdk = {
  create: (options: {
    token: string;
    receivedRedirectUri?: string;
    onSuccess: (publicToken: string, metadata: PlaidLinkMetadata) => void;
    onExit: (
      error: { display_message?: string; error_message?: string } | null,
    ) => void;
  }) => PlaidHandler;
};

declare global {
  interface Window {
    Plaid?: PlaidSdk;
  }
}

let pendingSdk: Promise<PlaidSdk> | undefined;

export function loadPlaid(): Promise<PlaidSdk> {
  if (window.Plaid) return Promise.resolve(window.Plaid);
  if (pendingSdk) return pendingSdk;

  pendingSdk = new Promise<PlaidSdk>((resolve, reject) => {
    const script = document.createElement("script");
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      script.onload = null;
      script.onerror = null;
      if (error || !window.Plaid) {
        script.remove();
        reject(error ?? new Error("Plaid Link did not initialize. Try again."));
      } else resolve(window.Plaid);
    };
    const timeout = setTimeout(
      () => finish(new Error("Plaid Link took too long to load. Try again.")),
      20_000,
    );
    script.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
    script.async = true;
    script.onload = () => finish();
    script.onerror = () =>
      finish(
        new Error(
          "Plaid Link could not load. Check your connection and try again.",
        ),
      );
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    pendingSdk = undefined;
    throw error;
  });
  return pendingSdk;
}
