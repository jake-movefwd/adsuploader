import { NextRequest } from "next/server";
import { uploadVideoFromStream, withRetry } from "@/lib/meta";
import {
  requireToken,
  requireFacebookToken,
  requireGoogleToken,
} from "@/lib/session";
import { fetchDriveFileResponse, getDriveFileMeta } from "@/lib/drive";
import { isVideoMime } from "@/lib/constants";

export const runtime = "nodejs";
// Server-driven chunked upload can run long; hint a generous duration.
export const maxDuration = 300;

/**
 * GET /api/meta/video/from-drive?accountId=...&fileId=...  (Server-Sent Events)
 *
 * Drive videos can't be chunked in the browser (the bytes live in Drive), so the
 * server streams the file straight from Drive to Meta's start/transfer/finish
 * flow, forwarding progress as SSE events:
 *   { type: "progress", phase: "upload", progress: 0..1 }
 *   { type: "uploaded", assetId, filename }   // bytes transferred; now processing
 *   { type: "error", error }
 *
 * The file is streamed chunk-by-chunk and never buffered whole in memory. Meta's
 * processing/transcode is polled by the client via /api/meta/video/status so a
 * slow transcode can't time out this function.
 */
export async function GET(req: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      try {
        const token = await requireToken(req);
        const fbToken = requireFacebookToken(token);
        const googleToken = requireGoogleToken(token);

        const accountId = req.nextUrl.searchParams.get("accountId");
        const fileId = req.nextUrl.searchParams.get("fileId");
        if (!accountId || !fileId) {
          send({ type: "error", error: "accountId and fileId are required" });
          controller.close();
          return;
        }

        const meta = await getDriveFileMeta(googleToken, fileId);
        if (!isVideoMime(meta.mimeType)) {
          send({ type: "error", error: `Not a video: ${meta.mimeType}` });
          controller.close();
          return;
        }
        if (!meta.size) {
          // Meta's resumable upload sizes its transfer windows off file_size;
          // starting with 0 breaks the session. Drive omits size for some items.
          send({
            type: "error",
            error: "Could not determine the video's size from Drive",
          });
          controller.close();
          return;
        }

        // Stream the Drive body straight through to Meta — never buffered whole.
        const driveRes = await withRetry(() =>
          fetchDriveFileResponse(googleToken, fileId)
        );
        if (!driveRes.body) {
          send({ type: "error", error: "Drive returned an empty response" });
          controller.close();
          return;
        }

        const { videoId } = await uploadVideoFromStream({
          accountId,
          token: fbToken,
          size: meta.size,
          source: driveRes.body,
          filename: meta.name,
          onUploadProgress: (uploadedBytes) =>
            send({
              type: "progress",
              phase: "upload",
              progress: meta.size ? uploadedBytes / meta.size : 1,
            }),
        });

        // Bytes are in; Meta transcodes async. The client polls
        // /api/meta/video/status for readiness so this function can return now.
        send({ type: "uploaded", assetId: videoId, filename: meta.name });
        controller.close();
      } catch (err) {
        console.error("[video-upload] from-drive route error:", err);
        const message =
          err instanceof Error ? err.message : "Drive video upload failed";
        send({ type: "error", error: message });
        controller.close();
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
