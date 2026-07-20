"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isAcceptedMimeType } from "@/lib/constants";
import { captureVideoFrame } from "@/lib/video-frame";
import type { DriveItem, LocalItem } from "@/lib/upload-types";

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Modal that picks a thumbnail for a video. The user either scrubs the video to a
 * frame and captures it ({@link captureVideoFrame}), or uploads a custom image.
 * Either way it hands a single image `File` back through {@link onDone}, which the
 * batch runner uploads to Meta as an ad image alongside the video.
 *
 * Modeled on {@link ImageCropper}: local sources use the picked `File` directly;
 * Drive sources are fetched as bytes from `/api/drive/file` and turned into an
 * object URL for the `<video>` element.
 */
export default function ThumbnailPicker({
  item,
  onDone,
  onCancel,
}: {
  item: LocalItem | DriveItem;
  onDone: (file: File) => void;
  onCancel: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [chosen, setChosen] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Resolve the <video> src. Local files become an object URL from the picked
  // File. Drive files point straight at the same-origin byte-range endpoint:
  // the browser then fetches only the ranges it needs to scrub (never the whole
  // file, which used to 500 the server on large videos), and same-origin keeps
  // the canvas untainted so frame capture works.
  useEffect(() => {
    let objectUrl: string | null = null;
    if (item.source === "local") {
      objectUrl = URL.createObjectURL(item.file);
      setVideoSrc(objectUrl);
    } else {
      setVideoSrc(`/api/drive/file?fileId=${encodeURIComponent(item.fileId)}`);
    }
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [item]);

  // Revoke the capture preview URL when it changes / on unmount.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const setPreviewFrom = useCallback((file: File) => {
    setChosen(file);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
  }, []);

  const scrub = useCallback((value: number) => {
    const v = videoRef.current;
    if (v) v.currentTime = value;
    setCurrent(value);
  }, []);

  const captureFrame = useCallback(async () => {
    const v = videoRef.current;
    if (!v) return;
    try {
      const file = await captureVideoFrame(v, item.name);
      setPreviewFrom(file);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to capture frame");
    }
  }, [item.name, setPreviewFrom]);

  const onUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      if (!isAcceptedMimeType(file.type) || !file.type.startsWith("image/")) {
        setError("Please choose an image (JPEG, PNG, or GIF).");
        return;
      }
      setPreviewFrom(file);
      setError(null);
    },
    [setPreviewFrom]
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="truncate text-sm font-semibold text-slate-900">
            Thumbnail for “{item.name}”
          </h2>
          <button
            onClick={onCancel}
            className="text-slate-400 hover:text-slate-700"
            aria-label="Cancel thumbnail"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </p>
          )}
          {!videoSrc && !error && (
            <p className="py-10 text-center text-sm text-slate-500">
              Loading video…
            </p>
          )}

          {videoSrc && (
            <>
              <div className="overflow-hidden rounded-lg bg-slate-900">
                <video
                  ref={videoRef}
                  src={videoSrc}
                  muted
                  playsInline
                  preload="auto"
                  className="max-h-64 w-full object-contain"
                  onLoadedMetadata={(e) =>
                    setDuration(e.currentTarget.duration || 0)
                  }
                  onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
                  onError={() =>
                    setError("Failed to load video — try reopening the picker")
                  }
                />
              </div>

              <div>
                <input
                  type="range"
                  min={0}
                  max={duration || 0}
                  step={0.05}
                  value={current}
                  onChange={(e) => scrub(Number(e.target.value))}
                  className="w-full"
                  aria-label="Scrub video"
                />
                <div className="mt-1 flex justify-between text-xs text-slate-500">
                  <span>{formatTime(current)}</span>
                  <span>{formatTime(duration)}</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={captureFrame}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-blue-500"
                >
                  Capture frame
                </button>
                <label className="cursor-pointer rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 transition hover:bg-slate-50">
                  Upload image instead
                  <input
                    type="file"
                    accept="image/*"
                    onChange={onUpload}
                    className="hidden"
                  />
                </label>
              </div>

              {previewUrl && (
                <div>
                  <p className="mb-1 text-xs font-semibold text-slate-700">
                    Selected thumbnail
                  </p>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={previewUrl}
                    alt="Selected thumbnail preview"
                    className="max-h-40 rounded-lg border border-slate-200"
                  />
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button
            onClick={onCancel}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 transition hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={() => chosen && onDone(chosen)}
            disabled={!chosen}
            className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-40"
          >
            Use thumbnail
          </button>
        </div>
      </div>
    </div>
  );
}
