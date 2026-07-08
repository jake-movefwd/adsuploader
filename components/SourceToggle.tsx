"use client";

export type UploadSource = "local" | "drive";

export default function SourceToggle({
  value,
  onChange,
}: {
  value: UploadSource;
  onChange: (source: UploadSource) => void;
}) {
  const options: { key: UploadSource; label: string }[] = [
    { key: "local", label: "Local" },
    { key: "drive", label: "Google Drive" },
  ];

  return (
    <div className="inline-flex rounded-lg border border-slate-300 bg-slate-100 p-1">
      {options.map((o) => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
            value === o.key
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
