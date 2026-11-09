import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/auth";

function preventCache(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store, no-cache, max-age=0, must-revalidate");
  response.headers.set("Pragma", "no-cache");
  return response;
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const session = request.cookies.get("jr_admin")?.value;
  const signedIn = await verifySessionToken(session);

  // Halaman login hanya untuk pengunjung tanpa sesi sah.
  if (pathname === "/login") {
    if (signedIn) {
      const url = request.nextUrl.clone();
      url.pathname = "/admin";
      url.search = "";
      return preventCache(NextResponse.redirect(url));
    }
    return preventCache(NextResponse.next());
  }

  // Semua halaman dashboard (termasuk URL root) bersifat privat.
  if (!signedIn) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return preventCache(NextResponse.redirect(url));
  }

  // Setelah autentikasi, / selalu menuju dashboard pengelola.
  if (pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/admin";
    url.search = "";
    return preventCache(NextResponse.redirect(url));
  }

  return preventCache(NextResponse.next());
}

export const config = { matcher: ["/", "/login", "/admin/:path*"] };
