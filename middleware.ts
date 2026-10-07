import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/login") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  const session = request.cookies.get("jr_admin")?.value;
  if (session !== "ok") {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api/logout).*)"]
};
