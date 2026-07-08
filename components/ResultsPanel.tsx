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

  // Tab-separated "Filename\tAsset ID" rows (with header), successes only —
  // pastes directly into spreadsheet columns.
  const output = useMemo(() => {
    if (successCount === 0) return "";
    return [
      "Filename\tAsset ID",
      ...items
        .filter((i) => states[i.id]?.status === "success")
        .map((i) => `${i.name}\t${states[i.id].assetId}`),
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
            return (
              <li
                key={i.id}
                className="flex items-center justify-between px-3 py-2"
              >
                <span className="truncate text-slate-700">{i.name}</span>
                <span
                  className={`ml-3 flex-shrink-0 text-xs ${
                    ok ? "text-green-700" : "text-red-600"
                  }`}
                >
                  {ok ? s.assetId : s?.error || "Failed"}
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
          placeholder={"Successful uploads will appear here as tab-separated rows:\nFilename\tAsset ID"}
        />
      </div>
    </section>
  );
}
