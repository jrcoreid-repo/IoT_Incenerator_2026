import "server-only";
import { cookies } from "next/headers";
import { readSessionToken, type SessionIdentity } from "@/lib/auth";
import { getOperator, normalizeUsername } from "@/lib/operator-store";

// Central server-side authorization. Every protected route/API must call this,
// independently of middleware and of the hidden/visible tabs in the UI.
export async function currentSession(): Promise<SessionIdentity | null> {
  const jar = await cookies();
  const session = await readSessionToken(jar.get("jr_admin")?.value);
  if (!session) return null;
  if (session.role === "admin") {
    const admin = process.env.ADMIN_USERNAME;
    return session.sv === 0 && !!admin && session.sub === admin ? session : null;
  }
  if (session.role !== "operator" || session.sv < 1) return null;
  const username = normalizeUsername(session.sub);
  if (username !== session.sub) return null;
  // DB outages fail closed. Route errors should be handled as 503 when relevant.
  const user = await getOperator(username);
  return user && user.active && user.sessionVersion === session.sv ? session : null;
}
