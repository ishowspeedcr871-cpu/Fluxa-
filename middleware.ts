import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/services/auth/constants";

const protectedRoutes = [
  "/dashboard",
  "/organization",
  "/onboarding/organization",
  "/printers",
  "/analytics",
  "/reports",
  "/developer",
  "/settings",
  "/profile",
  "/invitations",
  "/customer",
  "/employee",
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/developer/login")) return NextResponse.next();

  if (pathname.startsWith("/developer")) {
    if (request.cookies.has("fluxa_master_developer")) {
      return NextResponse.next();
    }
    const devLoginUrl = new URL("/developer/login", request.url);
    devLoginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(devLoginUrl);
  }

  const isProtectedRoute = protectedRoutes.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );

  if (!isProtectedRoute) return NextResponse.next();

  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (sessionCookie) return NextResponse.next();

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
