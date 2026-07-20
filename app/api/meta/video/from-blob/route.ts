import { NextRequest } from "next/server";
import { del, get } from "@vercel/blob";
import { uploadVideoFromStream } from "@/lib/meta";
import { requireToken, requireFacebookToken } from "@/lib/session";
import { isVideoMime } from "@/lib/constants";

export const runtime = "nodejs";
// Server-driven chunked upload can run long; hint a generous duration.
export const maxDuration = 300;

/**
 * GET /api/meta/video/from-blob?accountId=...&blobUrl=...&filename=...&size=...  (SSE)
 *
 * Local videos would blow past Vercel's ~4.5MB Function body limit if chunked
 * through a serverless route from the browser, so the browser instead uploads
 * the whole file straight to Vercel Blob (bypassing that limit) and this route
 * streams the bytes back server-to-server into Meta's start/transfer/finish
 * flow — mirroring the Drive path in ./from-drive. Progress streams back:
 *   { type: "progress", phase: "upload", progress: 0..1 }
 *   { type: "uploaded", assetId, filename }   // bytes transferred; now processing
 *   { type: "error", error }
 *
 * The bytes are streamed chunk-by-chunk (never buffered whole); Meta's transcode
 * is polled by the client via /api/meta/video/status. The transient blob is
 * deleted once the bytes have been forwarded to Meta.
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
        const size = Number(req.nextUrl.searchParams.get("size") ?? 0);
        if (!accountId || !blobUrl) {
          send({ type: "error", error: "accountId and blobUrl are required" });
          controller.close();
          return;
        }
        if (!size) {
          send({ type: "error", error: "size is required" });
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

        // Normalize the SDK stream into a web ReadableStream<Uint8Array> without
        // buffering the whole file (Response.body is the stream, not a copy).
        const source = new Response(blobRes.stream).body;
        if (!source) {
          send({ type: "error", error: "Failed to read uploaded file" });
          controller.close();
          return;
        }

        const { videoId } = await uploadVideoFromStream({
          accountId,
          token: fbToken,
          size,
          source,
          filename,
          onUploadProgress: (uploadedBytes) =>
            send({
              type: "progress",
              phase: "upload",
              progress: size ? uploadedBytes / size : 1,
            }),
        });

        // Bytes are in; Meta transcodes async. The client polls
        // /api/meta/video/status for readiness so this function can return now.
        send({ type: "uploaded", assetId: videoId, filename });
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
