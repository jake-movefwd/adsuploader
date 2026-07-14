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
 * Chunk size for Meta's resumable video upload protocol. Kept under Vercel's
 * 4.5MB hard request-body limit for serverless Functions (with headroom for
 * multipart overhead) — larger chunks 413 before the route handler even runs.
 */
export const VIDEO_CHUNK_SIZE = 4 * 1024 * 1024;

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
