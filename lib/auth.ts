// Sesi admin bertanda tangan HMAC-SHA256; kompatibel dengan middleware Edge.
const encoder = new TextEncoder();
const TTL = 12 * 60 * 60 * 1000;
function base64Url(value: Uint8Array) {
  return btoa(Array.from(value, x => String.fromCharCode(x)).join("")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromBase64Url(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded + "=".repeat((4 - padded.length % 4) % 4)), char => char.charCodeAt(0));
}
async function sessionKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET belum ditetapkan.");
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign","verify"]);
}
export async function createSessionToken() {
  const payload = base64Url(encoder.encode(JSON.stringify({ exp: Date.now() + TTL })));
  const signature = await crypto.subtle.sign("HMAC", await sessionKey(), encoder.encode(payload));
  return payload + "." + base64Url(new Uint8Array(signature));
}
export async function verifySessionToken(token: string | undefined) {
  if (!token) return false;
  try {
    const pieces = token.split(".");
    if (pieces.length !== 2) return false;
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(pieces[0]))) as { exp?: unknown };
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return false;
    return crypto.subtle.verify("HMAC", await sessionKey(), fromBase64Url(pieces[1]), encoder.encode(pieces[0]));
  } catch { return false; }
}
