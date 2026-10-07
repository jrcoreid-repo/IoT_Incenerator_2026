import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const body = await request.json();
  const username = process.env.ADMIN_USERNAME ?? "admin";
  const password = process.env.ADMIN_PASSWORD ?? "admin123";

  if (body.username !== username || body.password !== password) {
    return NextResponse.json(
      { ok: false, message: "Nama pengguna atau kata sandi salah." },
      { status: 401 }
    );
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set("jr_admin", "ok", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12
  });
  return response;
}
