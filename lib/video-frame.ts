/**
 * Client-side video frame capture. Draws the currently-displayed frame of a
 * `<video>` element onto a canvas and returns it as a `File` ready to feed through
 * the normal image upload path — the same idea as `crop-image.ts`, but the source
 * is a live video element rather than a static image. No server round-trip.
 */

/**
 * Captures the video's current frame and returns a JPEG `File` named
 * `${baseName-stem}-thumb.jpg`. The video's object URL is same-origin, so the
 * canvas is untainted and `toBlob()` can read it (same note as `crop-image.ts`).
 */
export async function captureVideoFrame(
  video: HTMLVideoElement,
  baseName: string
): Promise<File> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) {
    throw new Error("Video frame not ready yet — try again in a moment");
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  ctx.drawImage(video, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.92)
  );
  if (!blob) throw new Error("Failed to encode video frame");

  const dot = baseName.lastIndexOf(".");
  const stem = dot > 0 ? baseName.slice(0, dot) : baseName;
  return new File([blob], `${stem}-thumb.jpg`, { type: "image/jpeg" });
}
