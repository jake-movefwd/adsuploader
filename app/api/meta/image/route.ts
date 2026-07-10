import { NextRequest, NextResponse } from "next/server";
import { del, get } from "@vercel/blob";
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
 * Three request shapes:
 *   - Local:  application/json { accountId, blobUrl, filename } — the browser
 *             uploaded bytes straight to Vercel Blob (bypassing this Function's
 *             ~4.5MB body limit); we fetch them back server-to-server, forward
 *             to Meta, then delete the transient blob.
 *   - Drive:  application/json { accountId, fileId } — the file is downloaded
 *             server-side (bytes never touch the browser) then forwarded to Meta.
 *   - Legacy local: multipart/form-data with `accountId` and `file`, kept for
 *             small files that don't go through Blob.
 *
 * Responds with { filename, assetId, imageUrl } where assetId is the Meta image
 * hash and imageUrl is the Meta-hosted image URL (when returned).
 */
export async function POST(req: NextRequest) {
  let blobUrlToClean: string | null = null;
  try {
    const token = await requireToken(req);
    const fbToken = requireFacebookToken(token);

    const contentType = req.headers.get("content-type") ?? "";
    let accountId: string;
    let filename: string;
    let blob: Blob;

    if (contentType.includes("application/json")) {
      const payload = await req.json();
      const { accountId: acct } = payload;

      if (payload.blobUrl) {
        const { blobUrl, filename: fname } = payload;
        if (!acct || !blobUrl || !fname) {
          return NextResponse.json(
            { error: "accountId, blobUrl and filename are required" },
            { status: 400 }
          );
        }
        blobUrlToClean = blobUrl;
        // The blob lives in a private store, so it can't be fetched anonymously
        // by URL — read it back with the read-write token via the SDK.
        const blobRes = await get(blobUrl, { access: "private" });
        if (!blobRes || blobRes.statusCode !== 200) {
          return NextResponse.json(
            { error: "Failed to read uploaded file" },
            { status: 502 }
          );
        }
        const contentTypeHeader = blobRes.blob.contentType ?? "";
        if (!isAcceptedMimeType(contentTypeHeader)) {
          return NextResponse.json(
            { error: `Unsupported file type: ${contentTypeHeader}` },
            { status: 400 }
          );
        }
        accountId = acct;
        filename = fname;
        blob = await new Response(blobRes.stream).blob();
      } else {
        const { fileId } = payload;
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
      }
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

    const { hash, url } = await uploadImage(accountId, fbToken, filename, blob);
    return NextResponse.json({ filename, assetId: hash, imageUrl: url });
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
  } finally {
    if (blobUrlToClean) {
      await del(blobUrlToClean).catch(() => {
        // best-effort cleanup; the blob store isn't user-facing storage
      });
    }
  }
}
