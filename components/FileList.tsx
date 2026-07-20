"use client";

import { useMemo } from "react";
import type {
  SelectedItem,
  UploadState,
  UploadStatus,
  Aspect,
  PickedDoc,
} from "@/lib/upload-types";
import { ASPECTS, isVideoMime } from "@/lib/constants";

function formatSize(bytes: number): string {
  if (!bytes) return "";
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
}

const STATUS_LABEL: Record<UploadStatus, string> = {
  pending: "Pending",
  uploading: "Uploading",
  processing: "Processing",
  success: "Done",
  error: "Failed",
};

const STATUS_STYLE: Record<UploadStatus, string> = {
  pending: "bg-slate-100 text-slate-600",
  uploading: "bg-blue-100 text-blue-700",
  processing: "bg-amber-100 text-amber-700",
  success: "bg-green-100 text-green-700",
  error: "bg-red-100 text-red-700",
};

function StatusBadge({ status }: { status: UploadStatus }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Colors for the small per-aspect pills inside a grouped photo row. */
const PILL_STYLE: Record<UploadStatus, string> = {
  pending: "bg-slate-100 text-slate-500",
  uploading: "bg-blue-100 text-blue-700",
  processing: "bg-amber-100 text-amber-700",
  success: "bg-green-100 text-green-700",
  error: "bg-red-100 text-red-700",
};

function ProgressBar({ status, progress }: { status: UploadStatus; progress: number }) {
  return (
    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
      <div
        className={`h-full rounded-full transition-all ${
          status === "processing" ? "bg-amber-400" : "bg-blue-500"
        }`}
        style={{ width: `${Math.round(progress * 100)}%` }}
      />
    </div>
  );
}

/** A photo's three aspect crops, grouped by their shared groupId. */
interface CropGroup {
  kind: "group";
  id: string;
  name: string;
  crops: { aspect: Aspect; id: string; state?: UploadState }[];
}

/** A video, Drive item, or any local item without crops — rendered standalone. */
interface SingleRow {
  kind: "single";
  item: SelectedItem;
  state?: UploadState;
}

type Row = CropGroup | SingleRow;

/**
 * Aggregate the crops' statuses into one badge status: any error → error, else
 * any processing → processing, else any uploading → uploading, else all success
 * → success, else pending.
 */
function aggregateStatus(states: (UploadState | undefined)[]): UploadStatus {
  const s = states.map((x) => x?.status ?? "pending");
  if (s.some((x) => x === "error")) return "error";
  if (s.some((x) => x === "processing")) return "processing";
  if (s.some((x) => x === "uploading")) return "uploading";
  if (s.length > 0 && s.every((x) => x === "success")) return "success";
  return "pending";
}

export default function FileList({
  items,
  states,
  onRemove,
  onRemoveGroup,
  removable,
  thumbnails,
  onPickThumbnail,
  transcriptDocs,
  onPickDoc,
}: {
  items: SelectedItem[];
  states: Record<string, UploadState>;
  onRemove?: (id: string) => void;
  onRemoveGroup?: (groupId: string) => void;
  removable: boolean;
  /** Chosen thumbnail File per video item id (selecting phase only). */
  thumbnails?: Record<string, File>;
  /** Opens the thumbnail picker for a video item. */
  onPickThumbnail?: (item: SelectedItem) => void;
  /** Selected transcript Doc per video item id (selecting phase only). */
  transcriptDocs?: Record<string, PickedDoc>;
  /** Opens the Google Doc picker for a video item. */
  onPickDoc?: (item: SelectedItem) => void;
}) {
  // Collapse each photo's three crops (shared groupId) into one row; everything
  // else stays standalone. Preserves first-seen order.
  const rows = useMemo<Row[]>(() => {
    const result: Row[] = [];
    const groupIndex = new Map<string, number>();

    items.forEach((item) => {
      if (item.source === "local" && item.groupId) {
        let idx = groupIndex.get(item.groupId);
        if (idx === undefined) {
          idx = result.length;
          groupIndex.set(item.groupId, idx);
          result.push({
            kind: "group",
            id: item.groupId,
            name: item.name,
            crops: [],
          });
        }
        (result[idx] as CropGroup).crops.push({
          aspect: item.aspect ?? ("" as Aspect),
          id: item.id,
          state: states[item.id],
        });
      } else {
        result.push({ kind: "single", item, state: states[item.id] });
      }
    });

    return result;
  }, [items, states]);

  if (items.length === 0) {
    return (
      <p className="mt-4 text-sm text-slate-400">No files selected yet.</p>
    );
  }

  return (
    <ul className="mt-4 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
      {rows.map((row) => {
        if (row.kind === "group") {
          const status = aggregateStatus(row.crops.map((c) => c.state));
          const showBar = status === "uploading" || status === "processing";
          const progress =
            row.crops.reduce((sum, c) => sum + (c.state?.progress ?? 0), 0) /
            (row.crops.length || 1);
          // Order pills by ASPECTS for stability, matching the crops present.
          const byAspect = new Map(row.crops.map((c) => [c.aspect, c]));
          const orderedCrops = ASPECTS.map((a) => byAspect.get(a.key)).filter(
            (c): c is CropGroup["crops"][number] => Boolean(c)
          );

          return (
            <li key={row.id} className="px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">
                    {row.name}
                  </p>
                  <p className="text-xs text-slate-400">
                    Image · {row.crops.length} crop
                    {row.crops.length === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-3">
                  <StatusBadge status={status} />
                  {removable && onRemoveGroup && (
                    <button
                      onClick={() => onRemoveGroup(row.id)}
                      className="text-xs text-slate-400 hover:text-red-600"
                      aria-label={`Remove ${row.name}`}
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {orderedCrops.map((c) => {
                  const cs = c.state?.status ?? "pending";
                  const mark =
                    cs === "success" ? " ✓" : cs === "error" ? " ✕" : "";
                  return (
                    <span
                      key={c.id}
                      title={c.state?.error || STATUS_LABEL[cs]}
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${PILL_STYLE[cs]}`}
                    >
                      {c.aspect}
                      {mark}
                    </span>
                  );
                })}
              </div>

              {showBar && <ProgressBar status={status} progress={progress} />}
            </li>
          );
        }

        const { item, state } = row;
        const status = state?.status ?? "pending";
        const showBar = status === "uploading" || status === "processing";
        const isVideo = isVideoMime(item.mimeType);
        const hasThumb = Boolean(thumbnails?.[item.id]);
        const hasDoc = Boolean(transcriptDocs?.[item.id]);
        return (
          <li key={item.id} className="px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-800">
                  {item.name}
                </p>
                <p className="text-xs text-slate-400">
                  {isVideo ? "Video" : "Image"}
                  {item.source === "local" && item.aspect
                    ? ` · ${item.aspect}`
                    : ""}
                  {item.sizeBytes ? ` · ${formatSize(item.sizeBytes)}` : ""}
                  {item.source === "drive" ? " · Drive" : ""}
                </p>
              </div>
              <div className="flex flex-shrink-0 items-center gap-3">
                {isVideo && removable && onPickThumbnail && (
                  <button
                    onClick={() => onPickThumbnail(item)}
                    className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                      hasThumb
                        ? "border-green-300 bg-green-50 text-green-700 hover:bg-green-100"
                        : "border-slate-300 text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {hasThumb ? "Thumbnail ✓ · Change" : "Set thumbnail"}
                  </button>
                )}
                {isVideo && removable && onPickDoc && (
                  <button
                    onClick={() => onPickDoc(item)}
                    title={transcriptDocs?.[item.id]?.name}
                    className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                      hasDoc
                        ? "border-green-300 bg-green-50 text-green-700 hover:bg-green-100"
                        : "border-slate-300 text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {hasDoc ? "Transcript ✓ · Change" : "Set transcript"}
                  </button>
                )}
                <StatusBadge status={status} />
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
              <ProgressBar status={status} progress={state?.progress ?? 0} />
            )}

            {status === "error" && state?.error && (
              <p className="mt-1 text-xs text-red-600">{state.error}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
