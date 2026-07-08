import { NextRequest, NextResponse } from "next/server";
import { fetchAdAccounts, MetaApiError } from "@/lib/meta";
import {
  requireToken,
  requireFacebookToken,
  UnauthorizedError,
  unauthorizedResponse,
} from "@/lib/session";

export const runtime = "nodejs";

/** GET /api/meta/adaccounts — ad accounts the logged-in user can access. */
export async function GET(req: NextRequest) {
  try {
    const token = await requireToken(req);
    const fbToken = requireFacebookToken(token);
    const accounts = await fetchAdAccounts(fbToken);
    return NextResponse.json({ accounts });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return unauthorizedResponse(err.message);
    }
    if (err instanceof MetaApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Failed to load ad accounts" },
      { status: 500 }
    );
  }
}
