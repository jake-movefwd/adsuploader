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
 * Chunk size for the OUTBOUND server→Meta leg of the resumable video upload.
 * The 4.5MB Vercel body limit is inbound-only and does not apply here, so we
 * use a much larger chunk: fewer sequential POSTs to graph-video means far less
 * wall-clock on big files (a 2GB video is ~64 POSTs at 32MB instead of ~512 at
 * 4MB), which keeps large uploads inside the function's time budget.
 */
export const META_TRANSFER_CHUNK_SIZE = 32 * 1024 * 1024;

/** Max simultaneous uploads (avoid Meta rate limiting). */
export const MAX_CONCURRENT_UPLOADS = 3;

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
