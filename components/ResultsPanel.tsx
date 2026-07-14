"use client";

import { useMemo, useState } from "react";
import { ASPECTS, isVideoMime } from "@/lib/constants";
import type { SelectedItem, UploadState } from "@/lib/upload-types";

interface ImageGroup {
  id: string;
  name: string;
  byAspect: Record<string, UploadState | undefined>;
}

interface VideoRow {
  id: string;
  name: string;
  state?: UploadState;
}

export default function ResultsPanel({
  items,
  states,
  onNewBatch,
}: {
  items: SelectedItem[];
  states: Record<string, UploadState>;
  onNewBatch: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const successCount = items.filter(
    (i) => states[i.id]?.status === "success"
  ).length;

  const hasVideo = useMemo(
    () => items.some((i) => isVideoMime(i.mimeType)),
    [items]
  );

  // Group each photo's three crops (shared groupId) into one row; videos stand
  // alone. Preserves first-seen order for stable output.
  const { imageGroups, videoRows } = useMemo(() => {
    const groups: ImageGroup[] = [];
    const indexById = new Map<string, number>();
    const videos: VideoRow[] = [];

    items.forEach((i) => {
      if (i.source === "local" && i.groupId) {
        let idx = indexById.get(i.groupId);
        if (idx === undefined) {
          idx = groups.length;
          indexById.set(i.groupId, idx);
          groups.push({ id: i.groupId, name: i.name, byAspect: {} });
        }
        if (i.aspect) groups[idx].byAspect[i.aspect] = states[i.id];
      } else {
        videos.push({ id: i.id, name: i.name, state: states[i.id] });
      }
    });

    return { imageGroups: groups, videoRows: videos };
  }, [items, states]);

  // Tab-separated rows (with header), successes only — pastes directly into
  // spreadsheet columns. One row per source photo with a Hash + URL column per
  // aspect; if the batch has any video, two trailing columns (Video ID, Doc
  // Link) are appended (blank on image rows, and the aspect cells blank on
  // video rows).
  const output = useMemo(() => {
    if (successCount === 0) return "";

    const header = [
      "Filename",
      ...ASPECTS.flatMap((a) => [`${a.key} Hash`, `${a.key} URL`]),
      ...(hasVideo
        ? ["Video ID", "Thumbnail Hash", "Thumbnail URL", "Doc Link"]
        : []),
    ].join("\t");

    const imageLines = imageGroups
      .filter((g) => ASPECTS.some((a) => g.byAspect[a.key]?.status === "success"))
      .map((g) => {
        const cells: string[] = [g.name];
        ASPECTS.forEach((a) => {
          const s = g.byAspect[a.key];
          const ok = s?.status === "success";
          cells.push(ok ? s?.assetId ?? "" : "", ok ? s?.imageUrl ?? "" : "");
        });
        // Video ID, Thumbnail Hash, Thumbnail URL, Doc Link (blank on image rows).
        if (hasVideo) cells.push("", "", "", "");
        return cells.join("\t");
      });

    const videoLines = videoRows
      .filter((v) => v.state?.status === "success")
      .map((v) => {
        const cells: string[] = [v.name];
        ASPECTS.forEach(() => cells.push("", ""));
        cells.push(
          v.state?.assetId ?? "",
          v.state?.thumbnailAssetId ?? "",
          v.state?.thumbnailUrl ?? "",
          v.state?.docUrl ?? ""
        );
        return cells.join("\t");
      });

    return [header, ...imageLines, ...videoLines].join("\n");
  }, [successCount, hasVideo, imageGroups, videoRows]);

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const lineCount = output ? output.split("\n").length : 0;

  return (
    <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Results</h2>
        <button
          onClick={onNewBatch}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 transition hover:bg-slate-50"
        >
          New batch
        </button>
      </div>

      <p className="mt-2 text-sm text-slate-600">
        {successCount} of {items.length} uploaded successfully
      </p>

      <div className="mt-4 max-h-56 overflow-y-auto rounded-lg border border-slate-200">
        <ul className="divide-y divide-slate-100 text-sm">
          {imageGroups.map((g) => (
            <li key={g.id} className="flex items-center justify-between px-3 py-2">
              <span className="truncate text-slate-700">{g.name}</span>
              <span className="ml-3 flex flex-shrink-0 items-center gap-2 text-xs">
                {ASPECTS.map((a) => {
                  const s = g.byAspect[a.key];
                  if (s?.status === "success") {
                    return s.imageUrl ? (
                      <a
                        key={a.key}
                        href={s.imageUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 underline underline-offset-2 hover:text-blue-500"
                      >
                        {a.key}
                      </a>
                    ) : (
                      <span key={a.key} className="text-green-700">
                        {a.key}
                      </span>
                    );
                  }
                  return (
                    <span
                      key={a.key}
                      className="text-red-500"
                      title={s?.error || "Failed"}
                    >
                      {a.key} ✕
                    </span>
                  );
                })}
              </span>
            </li>
          ))}

          {videoRows.map((v) => {
            const ok = v.state?.status === "success";
            return (
              <li key={v.id} className="flex items-center justify-between px-3 py-2">
                <span className="truncate text-slate-700">{v.name}</span>
                <span className="ml-3 flex flex-shrink-0 items-center gap-2 text-xs">
                  {ok ? (
                    <>
                      <span className="text-green-700">{v.state?.assetId}</span>
                      {v.state?.thumbnailUrl && (
                        <a
                          href={v.state.thumbnailUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-600 underline underline-offset-2 hover:text-blue-500"
                        >
                          Thumb
                        </a>
                      )}
                      {v.state?.thumbnailError && (
                        <span
                          className="text-amber-700"
                          title={v.state.thumbnailError}
                        >
                          thumbnail failed
                        </span>
                      )}
                      {v.state?.docUrl && (
                        <a
                          href={v.state.docUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-600 underline underline-offset-2 hover:text-blue-500"
                        >
                          Doc
                        </a>
                      )}
                      {v.state?.docError && (
                        <span className="text-amber-700" title={v.state.docError}>
                          doc failed — reconnect Google
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-red-600">
                      {v.state?.error || "Failed"}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="mt-4">
        <div className="mb-1 flex items-center justify-between">
          <label className="text-sm font-medium text-slate-700">
            Copy-pasteable output
          </label>
          <button
            onClick={copyAll}
            disabled={!output}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-slate-700 disabled:opacity-40"
          >
            {copied ? "Copied!" : "Copy All"}
          </button>
        </div>
        <textarea
          readOnly
          value={output}
          rows={Math.min(Math.max(lineCount, 3), 12)}
          className="w-full rounded-lg border border-slate-300 bg-slate-50 p-3 font-mono text-sm text-slate-800 focus:outline-none"
          placeholder={
            "Successful uploads will appear here as tab-separated rows:\nFilename\t1:1 Hash\t1:1 URL\t9:16 Hash\t9:16 URL\t16:9 Hash\t16:9 URL"
          }
        />
      </div>
    </section>
  );
}
