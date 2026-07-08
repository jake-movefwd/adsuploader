import { NextRequest } from "next/server";
import {
  startVideoUpload,
  transferVideoChunk,
  finishVideoUpload,
  getVideoStatus,
} from "@/lib/meta";
import {
  requireToken,
  requireFacebookToken,
  requireGoogleToken,
} from "@/lib/session";
import { downloadDriveFile, getDriveFileMeta } from "@/lib/drive";
import { VIDEO_CHUNK_SIZE, isVideoMime } from "@/lib/constants";

export const runtime = "nodejs";
// Server-driven chunked upload can run long; hint a generous duration.
export const maxDuration = 300;

/**
 * GET /api/meta/video/from-drive?accountId=...&fileId=...  (Server-Sent Events)
 *
 * Drive videos can't be chunked in the browser (the bytes live in Drive), so the
 * server downloads the file and runs Meta's start/transfer/finish/poll loop,
 * streaming progress back as SSE events:
 *   { type: "progress", phase: "upload"|"processing", progress: 0..1 }
 *   { type: "done", assetId, filename }
 *   { type: "error", error }
 *
 * Bytes are held in memory per-chunk and never written to disk.
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

        const blob = await downloadDriveFile(googleToken, fileId);
        const size = blob.size;

        // Start phase
        const { uploadSessionId, videoId } = await startVideoUpload(
          accountId,
          fbToken,
          size
        );

        // Transfer phase — 10MB chunks, advancing by Meta's returned offset.
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
        await finishVideoUpload(accountId, fbToken, uploadSessionId, meta.name);

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

        send({ type: "done", assetId: videoId, filename: meta.name });
        controller.close();
      } catch (err) {
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
