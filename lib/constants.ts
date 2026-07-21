/** Accepted creative MIME types, shared by client pickers and server routes. */
export const ACCEPTED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "video/mp4",
  "video/quicktime",
  "video/mpeg",
] as const;

export type AcceptedMimeType = (typeof ACCEPTED_MIME_TYPES)[number];

export function isAcceptedMimeType(mime: string): mime is AcceptedMimeType {
  return (ACCEPTED_MIME_TYPES as readonly string[]).includes(mime);
}

export function isVideoMime(mime: string): boolean {
  return mime.startsWith("video/");
}

/**
 * Chunk size for browser→serverless uploads. Kept under Vercel's 4.5MB hard
 * request-body limit for serverless Functions (with headroom for multipart
 * overhead) — larger inbound bodies 413 before the route handler even runs.
 */
export const VIDEO_CHUNK_SIZE = 4 * 1024 * 1024;

/**
 * Upper CAP on the OUTBOUND server→Meta transfer chunk. Meta's resumable upload
 * dictates the exact window to send via the start/transfer response offsets; we
 * honor that window but never send more than this per POST. 4MB is the size the
 * pre-streaming code used successfully — larger chunks (e.g. 32MB) are rejected
 * by graph-video and break multi-chunk uploads.
 */
export const META_TRANSFER_CHUNK_SIZE = 4 * 1024 * 1024;

/**
 * Max simultaneous uploads. Serialized (1): running two chunked Meta upload
 * sessions at once made Meta shed load (HTTP 429 / code 2 "temporarily
 * unavailable") and killed near-complete uploads. One at a time keeps Meta
 * seeing a single session, which — with retry-with-backoff — is the reliable
 * combination. Trades batch wall-clock for reliability.
 */
export const MAX_CONCURRENT_UPLOADS = 1;

/**
 * Per-request timeout for outbound Meta Graph calls. Without it, a hung POST
 * rides all the way to the 300s function kill (a silent, undiagnosable drop);
 * with it the request aborts and `withRetry` can retry the transient stall.
 */
export const META_FETCH_TIMEOUT_MS = 60_000;

/**
 * Timeout to open the Drive download response, and the max gap between stream
 * reads once flowing. A stalled Drive read (Google throttling) trips this and
 * fails fast with a clear, retryable error instead of hanging to the 300s kill.
 */
export const DRIVE_FETCH_TIMEOUT_MS = 60_000;
export const DRIVE_READ_STALL_MS = 60_000;

/**
 * The aspect ratios every uploaded image is cropped into. `ratio` is width/height
 * (fed to react-easy-crop's `aspect`); `suffix` is appended to the crop's filename
 * (`photo-9x16.jpg`). The array order is also the column order in the results table.
 */
export const ASPECTS = [
  { key: "1:1", ratio: 1, suffix: "1x1" },
  { key: "9:16", ratio: 9 / 16, suffix: "9x16" },
  { key: "16:9", ratio: 16 / 9, suffix: "16x9" },
] as const;

export type Aspect = (typeof ASPECTS)[number]["key"];
