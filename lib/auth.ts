import type { NextAuthOptions } from "next-auth";
import type { JWT } from "next-auth/jwt";
import { decode } from "next-auth/jwt";
import { cookies } from "next/headers";
import FacebookProvider from "next-auth/providers/facebook";
import GoogleProvider from "next-auth/providers/google";

const FACEBOOK_SCOPES = "ads_management,ads_read,business_management";
const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  // drive.readonly is all we need: it lets the Picker browse the user's Drive to
  // select creative files AND to select an existing transcript Doc (whose link goes
  // straight into the output). We no longer create Docs, so no write scopes
  // (drive.file / documents) are requested.
  "https://www.googleapis.com/auth/drive.readonly",
].join(" ");

/**
 * NextAuth v4 rebuilds the JWT from scratch (just `name`/`email`/`picture`/`sub`)
 * on every OAuth sign-in callback — it does NOT decode the existing session
 * cookie first. That's fine for a fresh login, but it means linking a second
 * provider (e.g. Google, on top of an existing Facebook session) silently
 * drops the first provider's token unless we manually recover it here.
 */
async function getExistingToken(): Promise<JWT | null> {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) return null;
  const store = cookies();
  const raw =
    store.get("__Secure-next-auth.session-token")?.value ??
    store.get("next-auth.session-token")?.value;
  if (!raw) return null;
  try {
    return await decode({ token: raw, secret });
  } catch {
    return null;
  }
}

/**
 * Exchanges a Google refresh token for a fresh access token. Returns the new
 * access token and its expiry (epoch seconds), or null if the exchange fails.
 *
 * Google access tokens live ~1 hour; without this the server-side Drive calls
 * (getDriveFileMeta / downloadDriveFile) 401 once the stored token goes stale.
 */
async function refreshGoogleAccessToken(
  refreshToken: string
): Promise<{ accessToken: string; expiresAt: number } | null> {
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID as string,
        client_secret: process.env.GOOGLE_CLIENT_SECRET as string,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!data.access_token) return null;
    const expiresAt = Math.floor(Date.now() / 1000) + (data.expires_in ?? 3600);
    return { accessToken: data.access_token, expiresAt };
  } catch {
    return null;
  }
}

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
     * session read. NextAuth hands us a fresh `token` (no custom fields) on
     * every sign-in, so on sign-in we first recover the other provider's
     * credentials from the still-valid session cookie before applying the
     * provider that was just used — that's what lets Facebook + Google
     * coexist after on-demand linking.
     */
    async jwt({ token, account }) {
      if (account) {
        const existing = await getExistingToken();
        if (existing?.facebook && !token.facebook) {
          token.facebook = existing.facebook;
        }
        if (existing?.google && !token.google) {
          token.google = existing.google;
        }
      }
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
      // On token reads (no fresh sign-in), transparently refresh the Google
      // access token when it's at/near expiry so server-side Drive calls never
      // hit a stale-token 401.
      if (!account && token.google?.expiresAt) {
        const nowSec = Math.floor(Date.now() / 1000);
        const expiresSoon = token.google.expiresAt - 60 <= nowSec;
        if (expiresSoon) {
          const refreshed = token.google.refreshToken
            ? await refreshGoogleAccessToken(token.google.refreshToken)
            : null;
          if (refreshed) {
            token.google = {
              accessToken: refreshed.accessToken,
              // Google does not return a new refresh token on refresh — keep ours.
              refreshToken: token.google.refreshToken,
              expiresAt: refreshed.expiresAt,
            };
          } else {
            // Unrecoverable (refresh failed, or no refresh token on an older
            // session) — drop Google creds so `hasGoogle` flips false and the UI
            // re-prompts an on-demand link instead of looping on 401s.
            delete token.google;
          }
        }
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
