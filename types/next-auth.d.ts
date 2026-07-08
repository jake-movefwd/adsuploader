import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  /**
   * Shape returned to the CLIENT via useSession()/getSession().
   * IMPORTANT: never place raw access tokens here — only display fields
   * and capability booleans. Tokens live in the encrypted JWT (server-only).
   */
  interface Session {
    user?: {
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
    /** True once the user has linked Facebook (always true after login). */
    hasFacebook: boolean;
    /** True once the user has linked Google (on-demand for Drive source). */
    hasGoogle: boolean;
  }
}

declare module "next-auth/jwt" {
  /**
   * Encrypted, server-only JWT. Provider tokens are stored keyed by provider
   * so Facebook and Google credentials coexist after on-demand linking.
   */
  interface JWT {
    facebook?: {
      accessToken: string;
    };
    google?: {
      accessToken: string;
      refreshToken?: string;
      /** epoch seconds when the access token expires */
      expiresAt?: number;
    };
  }
}
