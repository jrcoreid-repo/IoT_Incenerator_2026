// CSRF protection for browser POST/PATCH/PUT requests.
// Browser Origin must match the authority actually requested by the client.
// Next.js can normalize Request.url to localhost/127.0.0.1 when serving via
// 0.0.0.0 and accessed from another device over a LAN IP. In that case,
// request.url is NOT the browser-visible origin; HTTP Host is.
export function trustedAuthRequest(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  if (site === "cross-site") return false;

  const rawOrigin = request.headers.get("origin");
  if (!rawOrigin) {
    // Reject same-site subdomain requests lacking Origin; legacy clients
    // without Fetch Metadata remain compatible with the login API.
    return site !== "same-site";
  }

  try {
    const supplied = new URL(rawOrigin);
    // The Origin header contains precisely a scheme + host + optional port.
    // Reject opaque, malformed, non-HTTP and path/query-bearing origins.
    if ((supplied.protocol !== "http:" && supplied.protocol !== "https:") ||
      supplied.origin !== rawOrigin) return false;

    const serverUrl = new URL(request.url);
    const host = request.headers.get("host");
    if (host) {
      // Do not trust X-Forwarded-Host from arbitrary client requests. The
      // Host header contains the exact destination authority used by browsers.
      const expected = new URL(serverUrl.protocol + "//" + host);
      const expectedProtocol =
        process.env.VERCEL === "1" && request.headers.get("x-forwarded-proto") === "https"
          ? "https:"
          : serverUrl.protocol;
      return supplied.origin === expectedProtocol + "//" + expected.host;
    }
    return supplied.origin === serverUrl.origin;
  } catch {
    return false;
  }
}
