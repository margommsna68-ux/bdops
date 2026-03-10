export { default } from "next-auth/middleware";

export const config = {
  matcher: [
    // Protect all dashboard routes
    "/((?!api|_next/static|_next/image|favicon.ico|login).*)",
  ],
};
