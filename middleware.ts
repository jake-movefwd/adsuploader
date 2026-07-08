export { default } from "next-auth/middleware";

/**
 * Protects every PAGE route. Unauthenticated requests are redirected to /login
 * (configured via authOptions.pages.signIn). The matcher excludes:
 *   - /api/*        (API routes self-validate via requireToken and must return
 *                    JSON 401s to fetch callers, not 302-redirects to HTML)
 *   - /login        (the sign-in page itself)
 *   - Next.js internals and static assets
 *
 * Defense in depth: every /api/meta and /api/drive route independently calls
 * requireToken() before any external call, so tokens are never used unauthenticated.
 */
export const config = {
  matcher: [
    "/((?!api|login|_next/static|_next/image|favicon.ico).*)",
  ],
};
