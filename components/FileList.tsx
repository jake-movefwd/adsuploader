"use client";

import type { SelectedItem, UploadState } from "@/lib/upload-types";
import { isVideoMime } from "@/lib/constants";

function formatSize(bytes: number): string {
  if (!bytes) return "";
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
}

function StatusBadge({ state }: { state?: UploadState }) {
  const status = state?.status ?? "pending";
  const map: Record<string, string> = {
    pending: "bg-slate-100 text-slate-600",
    uploading: "bg-blue-100 text-blue-700",
    processing: "bg-amber-100 text-amber-700",
    success: "bg-green-100 text-green-700",
    error: "bg-red-100 text-red-700",
  };
  const label: Record<string, string> = {
    pending: "Pending",
    uploading: "Uploading",
    processing: "Processing",
    success: "Done",
    error: "Failed",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${map[status]}`}>
      {label[status]}
    </span>
  );
}

export default function FileList({
  items,
  states,
  onRemove,
  removable,
}: {
  items: SelectedItem[];
  states: Record<string, UploadState>;
  onRemove?: (id: string) => void;
  removable: boolean;
}) {
  if (items.length === 0) {
    return (
      <p className="mt-4 text-sm text-slate-400">No files selected yet.</p>
    );
  }

  return (
    <ul className="mt-4 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
      {items.map((item) => {
        const state = states[item.id];
        const showBar =
          state &&
          (state.status === "uploading" || state.status === "processing");
        return (
          <li key={item.id} className="px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-800">
                  {item.name}
                </p>
                <p className="text-xs text-slate-400">
                  {isVideoMime(item.mimeType) ? "Video" : "Image"}
                  {item.sizeBytes ? ` · ${formatSize(item.sizeBytes)}` : ""}
                  {item.source === "drive" ? " · Drive" : ""}
                </p>
              </div>
              <div className="flex flex-shrink-0 items-center gap-3">
                <StatusBadge state={state} />
                {removable && onRemove && (
                  <button
                    onClick={() => onRemove(item.id)}
                    className="text-xs text-slate-400 hover:text-red-600"
                    aria-label={`Remove ${item.name}`}
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            {showBar && (
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                <div
                  className={`h-full rounded-full transition-all ${
                    state.status === "processing" ? "bg-amber-400" : "bg-blue-500"
                  }`}
                  style={{ width: `${Math.round((state.progress ?? 0) * 100)}%` }}
                />
              </div>
            )}

            {state?.status === "error" && state.error && (
              <p className="mt-1 text-xs text-red-600">{state.error}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
