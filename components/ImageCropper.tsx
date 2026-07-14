"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Cropper from "react-easy-crop";
import { ASPECTS, type Aspect } from "@/lib/constants";
import { cropToFile, type PixelCrop } from "@/lib/crop-image";
import type { PendingCrop } from "@/lib/upload-types";

type AspectDef = (typeof ASPECTS)[number];

/** One aspect's crop pane: full image with a fixed-aspect frame, pan + zoom. */
function CropPane({
  imageSrc,
  aspect,
  onPixels,
}: {
  imageSrc: string;
  aspect: AspectDef;
  onPixels: (key: Aspect, pixels: PixelCrop) => void;
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-700">{aspect.key}</span>
        <input
          type="range"
          min={1}
          max={3}
          step={0.01}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          className="w-32"
          aria-label={`Zoom ${aspect.key}`}
        />
      </div>
      <div className="relative h-56 w-full overflow-hidden rounded-lg bg-slate-900">
        <Cropper
          image={imageSrc}
          crop={crop}
          zoom={zoom}
          aspect={aspect.ratio}
          objectFit="contain"
          showGrid
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={(_area, pixels) => onPixels(aspect.key, pixels)}
        />
      </div>
    </div>
  );
}

/**
 * Modal that turns one source photo (local File or a Drive fileId) into three
 * crops — one per {@link ASPECTS} entry. The user pans/zooms each frame (all
 * start centered showing the full image), then "Add crops" exports each region
 * as a File via {@link cropToFile}.
 */
export default function ImageCropper({
  source,
  onDone,
  onCancel,
}: {
  source: PendingCrop;
  onDone: (crops: { aspect: Aspect; file: File }[]) => void;
  onCancel: () => void;
}) {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pixels = useRef<Partial<Record<Aspect, PixelCrop>>>({});

  const setPixels = useCallback((key: Aspect, p: PixelCrop) => {
    pixels.current[key] = p;
  }, []);

  // Resolve an object URL for the image: local files directly, Drive files via
  // the server byte-stream. Revoke it on unmount.
  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;

    async function load() {
      try {
        let blob: Blob;
        if (source.source === "local") {
          if (!source.file) throw new Error("Missing local file");
          blob = source.file;
        } else {
          const res = await fetch(
            `/api/drive/file?fileId=${encodeURIComponent(source.fileId ?? "")}`
          );
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error || `Failed to load image (${res.status})`);
          }
          blob = await res.blob();
        }
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setImageSrc(url);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load image");
        }
      }
    }
    load();

    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [source]);

  const handleAdd = useCallback(async () => {
    if (!imageSrc) return;
    setBusy(true);
    try {
      const crops = await Promise.all(
        ASPECTS.map(async (a) => {
          const p = pixels.current[a.key];
          if (!p) throw new Error(`No crop set for ${a.key}`);
          const file = await cropToFile(
            imageSrc,
            p,
            source.name,
            source.mimeType,
            a.suffix
          );
          return { aspect: a.key, file };
        })
      );
      onDone(crops);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create crops");
      setBusy(false);
    }
  }, [imageSrc, source, onDone]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="truncate text-sm font-semibold text-slate-900">
            Crop “{source.name}”
          </h2>
          <button
            onClick={onCancel}
            className="text-slate-400 hover:text-slate-700"
            aria-label="Cancel cropping"
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
          {!imageSrc && !error && (
            <p className="py-10 text-center text-sm text-slate-500">
              Loading image…
            </p>
          )}
          {imageSrc &&
            ASPECTS.map((a) => (
              <CropPane
                key={a.key}
                imageSrc={imageSrc}
                aspect={a}
                onPixels={setPixels}
              />
            ))}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button
            onClick={onCancel}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 transition hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={handleAdd}
            disabled={!imageSrc || busy}
            className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-40"
          >
            {busy ? "Adding…" : "Add crops"}
          </button>
        </div>
      </div>
    </div>
  );
}
