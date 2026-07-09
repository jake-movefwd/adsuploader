"use client";

import { useMemo, useState } from "react";
import type { SelectedItem, UploadState } from "@/lib/upload-types";

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

  // Tab-separated rows (with header), successes only — pastes directly into
  // spreadsheet columns. Doc Link is the video transcript Doc; Image URL is the
  // Meta-hosted image (each populated only for its file type, blank otherwise).
  const output = useMemo(() => {
    if (successCount === 0) return "";
    return [
      "Filename\tAsset ID\tDoc Link\tImage URL",
      ...items
        .filter((i) => states[i.id]?.status === "success")
        .map((i) => {
          const s = states[i.id];
          return `${i.name}\t${s.assetId}\t${s.docUrl ?? ""}\t${
            s.imageUrl ?? ""
          }`;
        }),
    ].join("\n");
  }, [items, states, successCount]);

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

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

      <div className="mt-4 max-h-48 overflow-y-auto rounded-lg border border-slate-200">
        <ul className="divide-y divide-slate-100 text-sm">
          {items.map((i) => {
            const s = states[i.id];
            const ok = s?.status === "success";
            const link = s?.docUrl ?? s?.imageUrl;
            return (
              <li
                key={i.id}
                className="flex items-center justify-between px-3 py-2"
              >
                <span className="truncate text-slate-700">{i.name}</span>
                <span className="ml-3 flex flex-shrink-0 items-center gap-2 text-xs">
                  {ok ? (
                    <>
                      <span className="text-green-700">{s.assetId}</span>
                      {link && (
                        <a
                          href={link}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-600 underline underline-offset-2 hover:text-blue-500"
                        >
                          {s.docUrl ? "Doc" : "Image"}
                        </a>
                      )}
                      {s.docError && (
                        <span
                          className="text-amber-700"
                          title={s.docError}
                        >
                          doc failed — reconnect Google
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-red-600">
                      {s?.error || "Failed"}
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
          rows={Math.min(Math.max(successCount, 3), 12)}
          className="w-full rounded-lg border border-slate-300 bg-slate-50 p-3 font-mono text-sm text-slate-800 focus:outline-none"
          placeholder={"Successful uploads will appear here as tab-separated rows:\nFilename\tAsset ID\tDoc Link\tImage URL"}
        />
      </div>
    </section>
  );
}
