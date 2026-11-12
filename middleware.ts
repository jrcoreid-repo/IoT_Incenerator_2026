import { NextRequest, NextResponse } from "next/server";
import { readSessionToken } from "@/lib/auth";

function preventCache(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store, no-cache, max-age=0, must-revalidate");
  response.headers.set("Pragma", "no-cache");
  return response;
}
function redirect(_request: NextRequest, pathname: string) {
  // Relative Location preserves the browser's public HTTPS origin behind
  // Caddy/other reverse proxies. request.nextUrl can resolve to localhost:3000.
  return preventCache(new NextResponse(null, {
    status: 307,
    headers: { Location: pathname }
  }));
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
