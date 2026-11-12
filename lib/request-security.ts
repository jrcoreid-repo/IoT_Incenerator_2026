// CSRF defense for authentication and admin-write endpoints.
// Modern browsers set Sec-Fetch-Site; scripts on other origins cannot forge it.
// When it says "same-origin", it is more reliable than the Next.js server URL,
// which may be rewritten to loopback for LAN access (e.g. 172.20.10.2:3000).
export function trustedAuthRequest(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  // A different site OR a sibling origin on the same registrable domain
  // must not be able to make authenticated browser writes.
  if (site === "cross-site" || site === "same-site") return false;

  const rawOrigin = request.headers.get("origin");
  if (!rawOrigin) {
    // Non-browser clients (CLI tests / native apps) may omit Origin.
    return site === null || site === "none" || site === "same-origin";
  }

  try {
    const supplied = new URL(rawOrigin);
    if ((supplied.protocol !== "http:" && supplied.protocol !== "https:") ||
      supplied.origin !== rawOrigin) return false;

    // Browser-enforced Fetch Metadata is authoritative when present.
    // For older browsers that do not send it, validate Origin against Host.
    if (site === "same-origin") return true;

    const serverUrl = new URL(request.url);
    const host = request.headers.get("host");
    if (host) {
      // Never trust client-supplied X-Forwarded-Host.
      const expected = new URL(serverUrl.protocol + "//" + host);
      const scheme =
        process.env.VERCEL === "1" && request.headers.get("x-forwarded-proto") === "https"
          ? "https:"
          : serverUrl.protocol;
      return supplied.origin === scheme + "//" + expected.host;
    }
    return supplied.origin === serverUrl.origin;
  } catch {
    return false;
  }
}
