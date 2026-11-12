import { NextResponse } from "next/server";
import { trustedAuthRequest } from "@/lib/request-security";

export async function POST(request: Request) {
  if (!trustedAuthRequest(request)) {
    return NextResponse.json({ message: "Permintaan ditolak." }, {
      status: 403,
      headers: { "Cache-Control": "private, no-store, max-age=0" }
    });
  }
  const response = NextResponse.json({ ok: true }, {
    headers: { "Cache-Control": "private, no-store, max-age=0" }
  });
  response.cookies.set("jr_admin", "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
    priority: "high"
  });
  return response;
}
