"use client";

import { useRef, useState } from "react";
import { ACCEPTED_MIME_TYPES, isAcceptedMimeType } from "@/lib/constants";
import type { LocalItem } from "@/lib/upload-types";

let counter = 0;
function nextId() {
  counter += 1;
  return `local-${counter}`;
}

export default function DropZone({
  onAdd,
}: {
  onAdd: (items: LocalItem[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [rejected, setRejected] = useState<string[]>([]);

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    const accepted: LocalItem[] = [];
    const bad: string[] = [];
    Array.from(files).forEach((file) => {
      if (isAcceptedMimeType(file.type)) {
        accepted.push({
          source: "local",
          id: nextId(),
          file,
          name: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
        });
      } else {
        bad.push(file.name);
      }
    });
    setRejected(bad);
    if (accepted.length) onAdd(accepted);
  };

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition ${
          dragging
            ? "border-blue-400 bg-blue-50"
            : "border-slate-300 bg-slate-50 hover:border-slate-400"
        }`}
      >
        <p className="text-sm font-medium text-slate-700">
          Drag &amp; drop files here
        </p>
        <p className="mt-1 text-xs text-slate-500">
          or click to browse — images and videos, multiple allowed
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED_MIME_TYPES.join(",")}
          className="hidden"
          onChange={(e) => {
            handleFiles(e.target.files);
            // reset so selecting the same file again re-triggers change
            e.target.value = "";
          }}
        />
      </div>
      {rejected.length > 0 && (
        <p className="mt-2 text-xs text-amber-700">
          Skipped unsupported files: {rejected.join(", ")}
        </p>
      )}
    </div>
  );
}
