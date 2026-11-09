// Signed short-lived session. Uses Web Crypto so it runs in Next.js middleware.
// Each session is bound to a subject and role; user/operator routes must enforce
// permissions on the server, not only hide tabs.
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const TTL = 12 * 60 * 60 * 1000;
export type SessionRole = "admin" | "operator";
export type SessionIdentity = {
  v: 2;
  iss: "adi-smart-incinerator";
  aud: "adi-dashboard";
  sub: string;
  role: SessionRole;
  iat: number;
  exp: number;
  jti: string;
};

function base64Url(value: Uint8Array) {
  return btoa(Array.from(value, x => String.fromCharCode(x)).join("")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromBase64Url(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 2048) throw new Error("Invalid token");
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded + "=".repeat((4 - padded.length % 4) % 4)), char => char.charCodeAt(0));
}
async function sessionKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET belum ditetapkan.");
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign","verify"]);
}
export async function createSessionToken(subject: string, role: SessionRole = "admin") {
  if (!subject || subject.length > 128) throw new Error("Invalid subject");
  const now = Date.now();
  const claim: SessionIdentity = {
    v: 2,
    iss: "adi-smart-incinerator",
    aud: "adi-dashboard",
    sub: subject,
    role,
    iat: now,
    exp: now + TTL,
    jti: crypto.randomUUID()
  };
  const payload = base64Url(encoder.encode(JSON.stringify(claim)));
  const signature = await crypto.subtle.sign("HMAC", await sessionKey(), encoder.encode(payload));
  return payload + "." + base64Url(new Uint8Array(signature));
}
export async function readSessionToken(token: string | undefined): Promise<SessionIdentity | null> {
  if (!token || token.length > 4096) return null;
  try {
    const pieces = token.split(".");
    if (pieces.length !== 2) return null;
    const valid = await crypto.subtle.verify(
      "HMAC", await sessionKey(), fromBase64Url(pieces[1]), encoder.encode(pieces[0])
    );
    if (!valid) return null;
    const claim = JSON.parse(decoder.decode(fromBase64Url(pieces[0]))) as Partial<SessionIdentity>;
    const now = Date.now();
    if (claim.v !== 2 || claim.iss !== "adi-smart-incinerator" || claim.aud !== "adi-dashboard" ||
      (claim.role !== "admin" && claim.role !== "operator") ||
      typeof claim.sub !== "string" || claim.sub.length < 1 || claim.sub.length > 128 ||
      typeof claim.jti !== "string" || claim.jti.length < 16 ||
      typeof claim.iat !== "number" || typeof claim.exp !== "number" ||
      !Number.isFinite(claim.iat) || !Number.isFinite(claim.exp) ||
      claim.iat > now + 60_000 || claim.exp <= now || claim.exp > claim.iat + TTL
    ) return null;
    return claim as SessionIdentity;
  } catch {
    return null;
  }
}
// Admin-only default is deliberate. Additional operator endpoints must opt in
// with explicit role permissions when multi-user accounts are introduced.
export async function verifySessionToken(token: string | undefined, roles: SessionRole[] = ["admin"]) {
  const session = await readSessionToken(token);
  return !!session && roles.includes(session.role);
}
