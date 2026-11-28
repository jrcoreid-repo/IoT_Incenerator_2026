import { NextRequest, NextResponse } from "next/server";
import { readSessionToken } from "@/lib/auth";

function preventCache(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store, no-cache, max-age=0, must-revalidate");
  response.headers.set("Pragma", "no-cache");
  return response;
}
function redirect(request: NextRequest, pathname: string) {
  // Next.js middleware requires an absolute redirect URL. Behind Caddy,
  // request.nextUrl can incorrectly have localhost:3000 as its origin.
  // Only recognize our explicit public hostname; never redirect based on
  // arbitrary user-provided Host or X-Forwarded-Host values.
  const host = request.headers.get("host")?.toLowerCase();
  const forwardedHost = request.headers.get("x-forwarded-host")?.toLowerCase();
  const publicHost = host === "adi-incinerator.live" || forwardedHost === "adi-incinerator.live";
  const url = new URL(pathname, publicHost ? "https://adi-incinerator.live" : request.nextUrl.origin);
  return preventCache(NextResponse.redirect(url));
}
export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const session = await readSessionToken(request.cookies.get("jr_admin")?.value);
  const isAdmin = !!session && session.role === "admin" && session.sv === 0 &&
    session.sub === process.env.ADMIN_USERNAME;
  const isOperator = !!session && session.role === "operator" && session.sv >= 1;

  // An operator with a revoked session must still be able to access login:
  // middleware cannot check Node/Redis account state; the server page/API can.
  if (pathname === "/login") {
    return isAdmin ? redirect(request, "/admin") : preventCache(NextResponse.next());
  }
  if (!isAdmin && !isOperator) return redirect(request, "/login");

  if (pathname === "/") return redirect(request, isAdmin ? "/admin" : "/dashboard");
  if (pathname.startsWith("/admin")) {
    return isAdmin ? preventCache(NextResponse.next()) : redirect(request, "/dashboard");
  }
  if (pathname.startsWith("/dashboard") && isAdmin) return redirect(request, "/admin");
  return preventCache(NextResponse.next());
}
export const config = { matcher: ["/", "/login", "/admin/:path*", "/dashboard/:path*"] };
