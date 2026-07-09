"use client";

import { useCallback, useState } from "react";
import { signIn, useSession } from "next-auth/react";
import { ACCEPTED_MIME_TYPES } from "@/lib/constants";
import { launchPicker } from "@/lib/google-picker";
import type { DriveItem } from "@/lib/upload-types";

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
const APP_ID = process.env.NEXT_PUBLIC_GOOGLE_APP_ID;
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";

export default function DrivePicker({
  onAdd,
}: {
  onAdd: (items: DriveItem[]) => void;
}) {
  const { data: session } = useSession();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const launch = useCallback(async () => {
    // The Picker needs a Google account linked; connect on-demand.
    if (!session?.hasGoogle) {
      signIn("google", { callbackUrl: "/" });
      return;
    }
    if (!CLIENT_ID || !APP_ID) {
      setError(
        "Google Picker is not configured. Set NEXT_PUBLIC_GOOGLE_CLIENT_ID and NEXT_PUBLIC_GOOGLE_APP_ID."
      );
      return;
    }

    setError(null);
    setLoading(true);
    try {
      await launchPicker({
        clientId: CLIENT_ID,
        appId: APP_ID,
        scope: DRIVE_SCOPE,
        multiselect: true,
        buildView: (picker) =>
          new picker.DocsView(picker.ViewId.DOCS)
            .setIncludeFolders(true)
            .setSelectFolderEnabled(false)
            .setMimeTypes(ACCEPTED_MIME_TYPES.join(",")),
        onPicked: (docs) => {
          const items: DriveItem[] = docs.map((doc: any) => ({
            source: "drive" as const,
            id: `drive-${doc.id}`,
            fileId: doc.id,
            name: doc.name,
            mimeType: doc.mimeType,
            sizeBytes: Number(doc.sizeBytes ?? 0),
          }));
          if (items.length) onAdd(items);
        },
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to open Drive picker"
      );
    } finally {
      setLoading(false);
    }
  }, [session?.hasGoogle, onAdd]);

  return (
    <div className="rounded-xl border border-slate-300 bg-slate-50 px-6 py-10 text-center">
      {session?.hasGoogle ? (
        <p className="text-sm text-slate-600">
          Browse your Google Drive and select image or video files.
        </p>
      ) : (
        <p className="text-sm text-slate-600">
          Connect your Google account to browse Drive.
        </p>
      )}
      <button
        onClick={launch}
        disabled={loading}
        className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:opacity-60"
      >
        {loading
          ? "Opening…"
          : session?.hasGoogle
            ? "Open Google Drive Picker"
            : "Connect Google Drive"}
      </button>
      {error && <p className="mt-3 text-xs text-red-700">{error}</p>}
    </div>
  );
}
