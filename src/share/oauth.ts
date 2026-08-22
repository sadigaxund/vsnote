/**
 * OAuth sign-in helpers (TODO §8.2). The backend owns the whole flow —
 * these are only the capability probe and the start URL builder.
 */

export interface OAuthProviders {
  google: boolean;
}

/** Cached for the session: provider config changes require a deploy. */
let cached: OAuthProviders | null = null;

export async function fetchOAuthProviders(): Promise<OAuthProviders> {
  if (cached) return cached;
  try {
    const res = await fetch(`/api/auth/oauth/providers`, { credentials: "include" });
    if (!res.ok) throw new Error(String(res.status));
    cached = (await res.json()) as OAuthProviders;
  } catch {
    cached = { google: false };
  }
  return cached;
}

/** Root-relative path the callback should land on after sign-in. */
export function oauthStartUrl(returnTo = "/"): string {
  const safe = returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/";
  return `/api/auth/oauth/google/start?return_to=${encodeURIComponent(safe)}`;
}
