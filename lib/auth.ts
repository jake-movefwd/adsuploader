import type { NextAuthOptions } from "next-auth";
import FacebookProvider from "next-auth/providers/facebook";
import GoogleProvider from "next-auth/providers/google";

const FACEBOOK_SCOPES = "ads_management,ads_read,business_management";
const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/drive.readonly",
].join(" ");

/**
 * NextAuth configuration.
 *
 * Session strategy is JWT (no database) — nothing persists server-side, per the
 * project constraints. Provider access tokens are stored in the encrypted JWT
 * keyed by provider so a user can log in with Facebook (primary) and then link
 * Google on-demand for the Drive source without either token clobbering the other.
 *
 * The `session` callback deliberately exposes ONLY display fields and capability
 * booleans to the client — raw access tokens never leave the server.
 */
export const authOptions: NextAuthOptions = {
  providers: [
    FacebookProvider({
      clientId: process.env.FACEBOOK_CLIENT_ID as string,
      clientSecret: process.env.FACEBOOK_CLIENT_SECRET as string,
      authorization: {
        params: { scope: FACEBOOK_SCOPES },
      },
    }),
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
      authorization: {
        params: {
          scope: GOOGLE_SCOPES,
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    /**
     * Runs on sign-in (when `account` is present) and on every subsequent
     * session read. On sign-in we merge the new provider's token into the
     * existing token without discarding the other provider's credentials.
     */
    async jwt({ token, account }) {
      if (account?.provider === "facebook" && account.access_token) {
        token.facebook = { accessToken: account.access_token };
      }
      if (account?.provider === "google" && account.access_token) {
        token.google = {
          accessToken: account.access_token,
          refreshToken: account.refresh_token ?? token.google?.refreshToken,
          expiresAt: account.expires_at,
        };
      }
      return token;
    },
    async session({ session, token }) {
      session.hasFacebook = Boolean(token.facebook?.accessToken);
      session.hasGoogle = Boolean(token.google?.accessToken);
      return session;
    },
  },
};
