// Sends visitors without a session cookie to the sign-in page before any admin page
// renders. This is only a shortcut: a cookie can be forged, so every admin page and
// action still checks the session against the database (src/lib/auth/session.ts).
import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "ssr_admin"; // keep in step with src/lib/auth/session.ts

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (pathname === "/admin/login" || request.cookies.has(SESSION_COOKIE)) {
    return withNoIndex(NextResponse.next());
  }
  const login = new URL("/admin/login", request.url);
  login.searchParams.set("next", pathname + search);
  return withNoIndex(NextResponse.redirect(login));
}

function withNoIndex(res: NextResponse) {
  res.headers.set("X-Robots-Tag", "noindex, nofollow");
  return res;
}

export const config = {
  matcher: ["/admin", "/admin/:path*"],
};
