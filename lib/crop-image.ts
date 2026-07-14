/**
 * Client-side image cropping. Given an image source URL and a pixel crop region
 * (as reported by react-easy-crop's `croppedAreaPixels`), draws that region onto
 * a canvas and returns it as a `File` ready to feed through the normal image
 * upload path. No server round-trip — cropping happens entirely in the browser.
 */

export interface PixelCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Object URLs are same-origin, but set this so a future remote src still
    // produces a non-tainted canvas that toBlob() can read.
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image for cropping"));
    img.src = src;
  });
}

/**
 * Crops `src` to `crop` and returns a `File` named `${baseName}-${suffix}.<ext>`.
 * PNG sources keep their alpha (output PNG); everything else outputs JPEG. Note:
 * animated GIFs are flattened to their first frame (canvas has no animation) —
 * acceptable for ad creative.
 */
export async function cropToFile(
  src: string,
  crop: PixelCrop,
  baseName: string,
  sourceMime: string,
  suffix: string
): Promise<File> {
  const img = await loadImage(src);

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(crop.width);
  canvas.height = Math.round(crop.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  ctx.drawImage(
    img,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    canvas.width,
    canvas.height
  );

  const isPng = sourceMime === "image/png";
  const outMime = isPng ? "image/png" : "image/jpeg";
  const ext = isPng ? "png" : "jpg";

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, outMime, 0.92)
  );
  if (!blob) throw new Error("Failed to encode cropped image");

  const dot = baseName.lastIndexOf(".");
  const stem = dot > 0 ? baseName.slice(0, dot) : baseName;
  return new File([blob], `${stem}-${suffix}.${ext}`, { type: outMime });
}
