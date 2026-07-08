import { NextRequest, NextResponse } from "next/server";
import { uploadImage, MetaApiError } from "@/lib/meta";
import {
  downloadDriveFile,
  getDriveFileMeta,
  DriveApiError,
} from "@/lib/drive";
import {
  requireToken,
  requireFacebookToken,
  requireGoogleToken,
  UnauthorizedError,
  unauthorizedResponse,
} from "@/lib/session";
import { isAcceptedMimeType } from "@/lib/constants";

export const runtime = "nodejs";

/**
 * POST /api/meta/image
 *
 * Two request shapes:
 *   - Local:  multipart/form-data with `accountId` and `file`.
 *   - Drive:  application/json { accountId, fileId } — the file is downloaded
 *             server-side (bytes never touch the browser) then forwarded to Meta.
 *
 * Responds with { filename, assetId } where assetId is the Meta image hash.
 */
export async function POST(req: NextRequest) {
  try {
    const token = await requireToken(req);
    const fbToken = requireFacebookToken(token);

    const contentType = req.headers.get("content-type") ?? "";
    let accountId: string;
    let filename: string;
    let blob: Blob;

    if (contentType.includes("application/json")) {
      const { accountId: acct, fileId } = await req.json();
      if (!acct || !fileId) {
        return NextResponse.json(
          { error: "accountId and fileId are required" },
          { status: 400 }
        );
      }
      const googleToken = requireGoogleToken(token);
      const meta = await getDriveFileMeta(googleToken, fileId);
      if (!isAcceptedMimeType(meta.mimeType)) {
        return NextResponse.json(
          { error: `Unsupported file type: ${meta.mimeType}` },
          { status: 400 }
        );
      }
      accountId = acct;
      filename = meta.name;
      blob = await downloadDriveFile(googleToken, fileId);
    } else {
      const form = await req.formData();
      const acct = form.get("accountId");
      const file = form.get("file");
      if (typeof acct !== "string" || !(file instanceof File)) {
        return NextResponse.json(
          { error: "accountId and file are required" },
          { status: 400 }
        );
      }
      if (!isAcceptedMimeType(file.type)) {
        return NextResponse.json(
          { error: `Unsupported file type: ${file.type}` },
          { status: 400 }
        );
      }
      accountId = acct;
      filename = file.name;
      blob = file;
    }

    const assetId = await uploadImage(accountId, fbToken, filename, blob);
    return NextResponse.json({ filename, assetId });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return unauthorizedResponse(err.message);
    }
    if (err instanceof MetaApiError || err instanceof DriveApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Image upload failed" },
      { status: 500 }
    );
  }
}
