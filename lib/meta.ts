/**
 * Meta Graph API helpers. All functions run SERVER-SIDE only and take the
 * Facebook access token explicitly — tokens must never reach the browser.
 */

import {
  META_TRANSFER_CHUNK_SIZE,
  META_FETCH_TIMEOUT_MS,
  DRIVE_READ_STALL_MS,
} from "@/lib/constants";

const API_VERSION = process.env.META_GRAPH_API_VERSION || "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${API_VERSION}`;
// Video uploads use the dedicated graph-video host.
const GRAPH_VIDEO_BASE = `https://graph-video.facebook.com/${API_VERSION}`;

export class MetaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Meta Graph API error code (e.g. 4 = app rate limit), when present. */
    readonly code?: number
  ) {
    super(message);
    this.name = "MetaApiError";
  }
}

/** Extracts a human-readable message from a Meta error response body. */
async function readError(res: Response): Promise<never> {
  let message = `Meta API request failed (${res.status})`;
  let code: number | undefined;
  try {
    const body = await res.json();
    if (body?.error?.message) {
      message = body.error.message;
    }
    if (typeof body?.error?.code === "number") {
      code = body.error.code;
    }
  } catch {
    // non-JSON error body; keep the generic message
  }
  throw new MetaApiError(message, res.status, code);
}

export interface AdAccount {
  name: string;
  account_id: string;
  /** Full "act_<account_id>" id used in edge URLs. */
  id: string;
}

/** GET /me/adaccounts?fields=name,account_id (paginated, follows `next`). */
export async function fetchAdAccounts(token: string): Promise<AdAccount[]> {
  const accounts: AdAccount[] = [];
  let url:
    | string
    | null = `${GRAPH_BASE}/me/adaccounts?fields=name,account_id&limit=200&access_token=${encodeURIComponent(
    token
  )}`;

  while (url) {
    const res: Response = await fetch(url);
    if (!res.ok) await readError(res);
    const body: any = await res.json();
    for (const a of body.data ?? []) {
      accounts.push({
        name: a.name,
        account_id: a.account_id,
        id: a.id ?? `act_${a.account_id}`,
      });
    }
    url = body.paging?.next ?? null;
  }
  return accounts;
}

export interface UploadImageResult {
  /** The Meta image hash — used as the asset id. */
  hash: string;
  /** The Meta-hosted image URL, if returned (surfaced to caption writers). */
  url?: string;
}

/**
 * Uploads an image to /{ad_account_id}/adimages via multipart and returns the
 * Meta-assigned hash (the image "asset_id") plus the hosted image URL.
 */
export async function uploadImage(
  accountId: string,
  token: string,
  filename: string,
  bytes: Blob
): Promise<UploadImageResult> {
  const form = new FormData();
  form.append("access_token", token);
  // The multipart field name becomes the key in the response `images` map.
  form.append("source", bytes, filename);

  const res = await fetch(`${GRAPH_BASE}/${accountId}/adimages`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) await readError(res);

  const body = await res.json();
  const images = body.images ?? {};
  const first = Object.values(images)[0] as
    | { hash?: string; url?: string }
    | undefined;
  if (!first?.hash) {
    throw new MetaApiError("Meta did not return an image hash", 502);
  }
  return { hash: first.hash, url: first.url };
}

export interface VideoStartResult {
  videoId: string;
  uploadSessionId: string;
  startOffset: number;
  endOffset: number;
}

/** Start phase: reserves a video id + upload session for a file of `fileSize` bytes. */
export async function startVideoUpload(
  accountId: string,
  token: string,
  fileSize: number
): Promise<VideoStartResult> {
  const form = new FormData();
  form.append("access_token", token);
  form.append("upload_phase", "start");
  form.append("file_size", String(fileSize));

  const res = await fetch(`${GRAPH_VIDEO_BASE}/${accountId}/advideos`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(META_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) await readError(res);

  const body = await res.json();
  return {
    videoId: body.video_id,
    uploadSessionId: body.upload_session_id,
    startOffset: Number(body.start_offset),
    endOffset: Number(body.end_offset),
  };
}

export interface VideoTransferResult {
  startOffset: number;
  endOffset: number;
}

/**
 * Transfer phase: uploads one chunk at `startOffset` and returns the next
 * offsets Meta expects. When startOffset === endOffset, transfer is complete.
 */
export async function transferVideoChunk(
  accountId: string,
  token: string,
  uploadSessionId: string,
  startOffset: number,
  chunk: Blob
): Promise<VideoTransferResult> {
  const form = new FormData();
  form.append("access_token", token);
  form.append("upload_phase", "transfer");
  form.append("upload_session_id", uploadSessionId);
  form.append("start_offset", String(startOffset));
  form.append("video_file_chunk", chunk, "chunk");

  const res = await fetch(`${GRAPH_VIDEO_BASE}/${accountId}/advideos`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(META_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) await readError(res);

  const body = await res.json();
  return {
    startOffset: Number(body.start_offset),
    endOffset: Number(body.end_offset),
  };
}

/**
 * Finish phase: commits the upload session. `title` sets the video's display
 * name in the Meta Ads media library (otherwise it shows as "Untitled").
 */
export async function finishVideoUpload(
  accountId: string,
  token: string,
  uploadSessionId: string,
  title?: string
): Promise<void> {
  const form = new FormData();
  form.append("access_token", token);
  form.append("upload_phase", "finish");
  form.append("upload_session_id", uploadSessionId);
  if (title) {
    form.append("title", title);
  }

  const res = await fetch(`${GRAPH_VIDEO_BASE}/${accountId}/advideos`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(META_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) await readError(res);
}

export interface VideoStatus {
  processingProgress: number;
  videoStatus: string;
  ready: boolean;
}

/** GET /{video_id}?fields=status — used to poll post-upload processing. */
export async function getVideoStatus(
  token: string,
  videoId: string
): Promise<VideoStatus> {
  const url = `${GRAPH_BASE}/${videoId}?fields=status&access_token=${encodeURIComponent(
    token
  )}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(META_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) await readError(res);

  const body = await res.json();
  const status = body.status ?? {};
  const processingProgress = Number(status.processing_progress ?? 0);
  const videoStatus = String(status.video_status ?? "processing");
  return {
    processingProgress,
    videoStatus,
    ready: videoStatus === "ready" || processingProgress >= 100,
  };
}

/**
 * Retries `fn` on transient failures (network blips, Meta/Drive 5xx, 429) with
 * exponential backoff. 4xx (bad request, auth, not-a-video) are NOT retried —
 * they won't succeed on a second try. Used to keep a single hiccup on a long
 * multi-chunk upload from aborting the whole transfer.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: { attempts?: number; baseDelayMs?: number }
): Promise<T> {
  const attempts = opts?.attempts ?? 3;
  const baseDelayMs = opts?.baseDelayMs ?? 1000;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1 || !isRetriableError(err)) throw err;
      await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** i));
    }
  }
  throw lastErr;
}

/** Meta rate-limit error codes — retrying these makes throttling worse. */
const META_RATE_LIMIT_CODES = new Set([4, 17, 32, 613]);

/** Retriable = a genuine transient failure, not a client mistake or throttle. */
function isRetriableError(err: unknown): boolean {
  // Never retry a rate limit — backing off harder means NOT hammering it.
  if (err instanceof MetaApiError && err.code !== undefined) {
    if (META_RATE_LIMIT_CODES.has(err.code)) return false;
  }
  const status = (err as { status?: number } | null)?.status;
  if (typeof status === "number") {
    if (status === 429) return false; // rate limited — do not retry
    return status >= 500;
  }
  // AbortSignal.timeout fires a DOMException (TimeoutError/AbortError) — the
  // request stalled and never completed, so a retry is worth a shot.
  const name = (err as { name?: string } | null)?.name;
  if (name === "TimeoutError" || name === "AbortError") return true;
  // A thrown TypeError from fetch() means the request never completed (DNS,
  // connection reset, TLS) — safe to retry.
  return err instanceof TypeError;
}

/** Concatenates buffered stream parts into one contiguous Uint8Array. */
function concatChunks(parts: Uint8Array[], total: number): Uint8Array {
  if (parts.length === 1) return parts[0];
  const out = new Uint8Array(total);
  let pos = 0;
  for (const part of parts) {
    out.set(part, pos);
    pos += part.length;
  }
  return out;
}

/**
 * Reads the next stream chunk but rejects if no bytes arrive within `timeoutMs`.
 * A stalled Google Drive download (throttling) would otherwise hang until the
 * Vercel function is killed at maxDuration — a silent, undiagnosable drop. This
 * turns it into a fast, clear error the caller can surface and the user retry.
 */
async function readWithStallGuard(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("Video download stalled — please retry")),
      timeoutMs
    );
  });
  try {
    return await Promise.race([reader.read(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Runs Meta's resumable video upload (start → transfer → finish) by STREAMING
 * `source` and forwarding it to graph-video in `META_TRANSFER_CHUNK_SIZE` chunks.
 * Only ~one chunk is ever held in memory — the whole file is never buffered —
 * which is what stops large videos from OOM-ing / timing out the function.
 *
 * Meta processing (transcode) is intentionally NOT awaited here; the caller
 * polls `getVideoStatus` separately so a slow transcode can't exhaust the
 * upload function's time budget. Returns the new video id.
 */
export async function uploadVideoFromStream(params: {
  accountId: string;
  token: string;
  size: number;
  source: ReadableStream<Uint8Array>;
  filename?: string;
  onUploadProgress?: (uploadedBytes: number) => void;
}): Promise<{ videoId: string }> {
  const { accountId, token, size, source, filename, onUploadProgress } = params;
  const cap = META_TRANSFER_CHUNK_SIZE;
  const startedAt = Date.now();
  const label = `${filename ?? "video"} (${size}B)`;
  const elapsed = () => `+${Date.now() - startedAt}ms`;
  console.log(`[video-upload] start ${label} acct=${accountId}`);

  // Meta drives the resumable protocol: the start/transfer responses tell us the
  // exact byte window (start_offset..end_offset) to send next. We honor that
  // window — clamped to `cap` for memory/request-size safety — and advance
  // strictly by Meta's returned offsets, so the stream position can never
  // desync from what Meta expects (sending ≤ the window is always safe; Meta
  // just returns an advanced start_offset).
  let { uploadSessionId, videoId, startOffset, endOffset } = await withRetry(
    () => startVideoUpload(accountId, token, size)
  );
  console.log(`[video-upload] session ${label} video=${videoId} ${elapsed()}`);

  const reader = source.getReader();
  let buffered: Uint8Array[] = [];
  let bufferedBytes = 0;
  let streamDone = false;

  try {
    while (startOffset < endOffset) {
      const want = Math.min(endOffset - startOffset, cap);

      // Fill the buffer until we hold `want` bytes (or the stream is exhausted).
      // The stall guard converts a throttled/hung Drive read into a clear error.
      while (bufferedBytes < want && !streamDone) {
        const { value, done } = await readWithStallGuard(
          reader,
          DRIVE_READ_STALL_MS
        );
        if (value && value.length) {
          buffered.push(value);
          bufferedBytes += value.length;
        }
        streamDone = done;
      }

      const combined = concatChunks(buffered, bufferedBytes);
      const sendLen = Math.min(want, combined.length);
      if (sendLen === 0) break; // stream ended before Meta expected — stop cleanly

      // Copy into a fresh ArrayBuffer-backed view so it's a valid BlobPart
      // regardless of the source stream's backing buffer type.
      const chunk = new Uint8Array(sendLen);
      chunk.set(combined.subarray(0, sendLen));

      const res = await withRetry(() =>
        transferVideoChunk(
          accountId,
          token,
          uploadSessionId,
          startOffset,
          new Blob([chunk])
        )
      );

      // Consume exactly what we sent; keep the remainder buffered.
      const remainder = combined.subarray(sendLen);
      buffered = remainder.length ? [remainder] : [];
      bufferedBytes = remainder.length;

      startOffset = res.startOffset;
      endOffset = res.endOffset;
      onUploadProgress?.(startOffset);
    }
  } catch (err) {
    // Release the (possibly stalled) source connection so it can't linger.
    await reader.cancel().catch(() => {});
    console.error(
      `[video-upload] transfer failed ${label} at offset ${startOffset} ${elapsed()}:`,
      err
    );
    throw err;
  }

  console.log(
    `[video-upload] transferred ${label} bytes=${startOffset} ${elapsed()}`
  );

  await withRetry(() =>
    finishVideoUpload(accountId, token, uploadSessionId, filename)
  );
  console.log(`[video-upload] finished ${label} video=${videoId} ${elapsed()}`);
  return { videoId };
}
