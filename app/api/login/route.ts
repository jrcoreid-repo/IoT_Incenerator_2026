import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createSessionToken } from "@/lib/auth";
export const runtime = "nodejs";
function matches(a: string, b: string) {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}
export async function POST(request: Request) {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password || password.length < 12 || !process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    return NextResponse.json({ message: "Kredensial pengelola belum dikonfigurasi di server." }, { status: 503 });
  }
  try {
    const body = await request.json() as { username?: unknown; password?: unknown };
    if (typeof body.username !== "string" || typeof body.password !== "string" || !matches(body.username, username) || !matches(body.password, password)) {
      return NextResponse.json({ message: "Nama pengguna atau kata sandi salah." }, { status: 401 });
    }
    const token = await createSessionToken();
    const response = NextResponse.json({ ok: true });
    response.cookies.set("jr_admin", token, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 12 });
    return response;
  } catch {
    return NextResponse.json({ message: "Permintaan login tidak valid." }, { status: 400 });
  }
}
