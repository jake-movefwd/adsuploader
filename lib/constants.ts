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

/** Chunk size for Meta's resumable video upload protocol (10 MB). */
export const VIDEO_CHUNK_SIZE = 10 * 1024 * 1024;

/** Max simultaneous uploads (avoid Meta rate limiting). */
export const MAX_CONCURRENT_UPLOADS = 3;
