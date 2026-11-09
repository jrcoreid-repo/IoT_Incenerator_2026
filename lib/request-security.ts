// Reject browser-initiated cross-site POSTs to auth endpoints.
// SameSite=Strict is retained independently as a second CSRF barrier.
export function trustedAuthRequest(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  if (site === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true; // Non-browser clients may omit Origin.
  try {
    const requestOrigin = new URL(request.url).origin;
    return new URL(origin).origin === requestOrigin && origin !== "null";
  } catch { return false; }
}
