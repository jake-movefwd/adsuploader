import { NextRequest } from "next/server";
import { del, get } from "@vercel/blob";
import {
  startVideoUpload,
  transferVideoChunk,
  finishVideoUpload,
  getVideoStatus,
} from "@/lib/meta";
import { requireToken, requireFacebookToken } from "@/lib/session";
import { VIDEO_CHUNK_SIZE, isVideoMime } from "@/lib/constants";

export const runtime = "nodejs";
// Server-driven chunked upload can run long; hint a generous duration.
export const maxDuration = 300;

/**
 * GET /api/meta/video/from-blob?accountId=...&blobUrl=...&filename=...  (SSE)
 *
 * Local videos would blow past Vercel's ~4.5MB Function body limit if chunked
 * through a serverless route from the browser, so the browser instead uploads
 * the whole file straight to Vercel Blob (bypassing that limit) and this route
 * reads the bytes back server-to-server and runs Meta's start/transfer/finish/
 * poll loop — mirroring the Drive path in ./from-drive. Progress streams back:
 *   { type: "progress", phase: "upload"|"processing", progress: 0..1 }
 *   { type: "done", assetId, filename }
 *   { type: "error", error }
 *
 * The transient blob is deleted once the bytes have been forwarded to Meta.
 */
export async function GET(req: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      const blobUrl = req.nextUrl.searchParams.get("blobUrl");
      let blobUrlToClean: string | null = blobUrl;

      try {
        const token = await requireToken(req);
        const fbToken = requireFacebookToken(token);

        const accountId = req.nextUrl.searchParams.get("accountId");
        const filename =
          req.nextUrl.searchParams.get("filename") || "video";
        if (!accountId || !blobUrl) {
          send({ type: "error", error: "accountId and blobUrl are required" });
          controller.close();
          return;
        }

        // The blob lives in a private store, so it can't be fetched anonymously
        // by URL — read it back with the read-write token via the SDK.
        const blobRes = await get(blobUrl, { access: "private" });
        if (!blobRes || blobRes.statusCode !== 200) {
          send({ type: "error", error: "Failed to read uploaded file" });
          controller.close();
          return;
        }
        if (!isVideoMime(blobRes.blob.contentType ?? "")) {
          send({
            type: "error",
            error: `Not a video: ${blobRes.blob.contentType ?? "unknown"}`,
          });
          controller.close();
          return;
        }

        const blob = await new Response(blobRes.stream).blob();
        const size = blob.size;

        // Start phase
        const { uploadSessionId, videoId } = await startVideoUpload(
          accountId,
          fbToken,
          size
        );

        // Transfer phase — advancing by Meta's returned offset.
        let offset = 0;
        while (offset < size) {
          const end = Math.min(offset + VIDEO_CHUNK_SIZE, size);
          const chunk = blob.slice(offset, end);
          const res = await transferVideoChunk(
            accountId,
            fbToken,
            uploadSessionId,
            offset,
            chunk
          );
          offset = res.startOffset;
          send({
            type: "progress",
            phase: "upload",
            progress: size ? offset / size : 1,
          });
          if (res.startOffset === res.endOffset) break;
        }

        // Finish phase
        await finishVideoUpload(accountId, fbToken, uploadSessionId, filename);

        // Poll processing status
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const status = await getVideoStatus(fbToken, videoId);
          send({
            type: "progress",
            phase: "processing",
            progress: Math.min(status.processingProgress / 100, 1),
          });
          if (status.ready) break;
          await new Promise((r) => setTimeout(r, 2000));
        }

        send({ type: "done", assetId: videoId, filename });
        controller.close();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Video upload failed";
        send({ type: "error", error: message });
        controller.close();
      } finally {
        if (blobUrlToClean) {
          await del(blobUrlToClean).catch(() => {
            // best-effort cleanup; the blob store isn't user-facing storage
          });
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
