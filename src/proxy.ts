import { NextResponse, type NextRequest } from "next/server";
import { LOCAL_SESSION_COOKIE, decodeLocalSession } from "@/lib/local-session";
import { SESSION_COOKIE, decryptSession } from "@/lib/session-token";

const PROTECTED = ["/chat", "/settings", "/profile"];
const AUTH_PAGES = ["/login", "/signup", "/forgot-password"];

/**
 * Optimistic route guard. Pages re-check the session server-side (requireUser),
 * so this only handles fast redirects.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const session =
    (await decryptSession(request.cookies.get(SESSION_COOKIE)?.value, process.env.AUTH_SECRET)) ??
    (process.env.FLASK_API_URL ? null : decodeLocalSession(request.cookies.get(LOCAL_SESSION_COOKIE)?.value));

  const isProtected = PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const isAuthPage = AUTH_PAGES.includes(pathname);

  if (isProtected && !session) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }
  if (isAuthPage && session) {
    return NextResponse.redirect(new URL("/chat", request.url));
  }
  if (pathname === "/" && session) {
    return NextResponse.redirect(new URL("/chat", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/chat/:path*", "/settings/:path*", "/profile/:path*", "/login", "/signup", "/forgot-password"],
};
