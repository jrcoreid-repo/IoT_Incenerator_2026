import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createSessionToken } from "@/lib/auth";
import { clearAccountLoginAttempts, consumeLoginAttempt } from "@/lib/login-rate-limit";
import { trustedAuthRequest } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };

function matches(a: string, b: string) {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}
function error(message: string, status: number, retryAfter?: number) {
  const headers: Record<string, string> = { ...NO_STORE };
  if (retryAfter !== undefined) headers["Retry-After"] = String(Math.max(1, retryAfter));
  return NextResponse.json({ message }, { status, headers });
}

export async function POST(request: Request) {
  if (!trustedAuthRequest(request)) return error("Permintaan ditolak.", 403);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return error("Gunakan format JSON untuk login.", 415);
  }
  if (Number(request.headers.get("content-length") || 0) > 2048) {
    return error("Permintaan login terlalu besar.", 413);
  }

  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password || password.length < 12 || !process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    return error("Kredensial pengelola belum dikonfigurasi di server.", 503);
  }
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > 2048) return error("Permintaan login terlalu besar.", 413);
    const body = JSON.parse(text) as { username?: unknown; password?: unknown };
    if (typeof body.username !== "string" || typeof body.password !== "string" ||
        body.username.length > 128 || body.password.length > 512) {
      return error("Nama pengguna atau kata sandi salah.", 401);
    }

    // In production Upstash Redis is mandatory. Never silently downgrade
    // to per-process memory counters on serverless production instances.
    let limited: Awaited<ReturnType<typeof consumeLoginAttempt>>;
    try {
      limited = await consumeLoginAttempt(body.username, request);
    } catch {
      return error("Pelindung login sedang tidak tersedia. Coba lagi nanti.", 503);
    }
    if (!limited.allowed) {
      return error("Terlalu banyak percobaan login. Coba lagi nanti.", 429, limited.retryAfter);
    }

    if (!matches(body.username, username) || !matches(body.password, password)) {
      return error("Nama pengguna atau kata sandi salah.", 401);
    }

    const token = await createSessionToken(username, "admin");
    try {
      await clearAccountLoginAttempts(body.username);
    } catch {
      return error("Pelindung login sedang tidak tersedia. Coba lagi nanti.", 503);
    }
    const response = NextResponse.json({ ok: true }, { headers: NO_STORE });
    response.cookies.set("jr_admin", token, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 12,
      priority: "high"
    });
    return response;
  } catch {
    return error("Permintaan login tidak valid.", 400);
  }
}
