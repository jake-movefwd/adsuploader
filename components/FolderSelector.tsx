"use client";

import { useCallback, useState } from "react";
import { signIn, useSession } from "next-auth/react";
import { launchPicker } from "@/lib/google-picker";

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
const APP_ID = process.env.NEXT_PUBLIC_GOOGLE_APP_ID;
// drive.file (write-capable) so selecting the folder here grants the app access
// to create Docs inside it; the server session token (same OAuth client +
// drive.file) then writes the Doc. drive.readonly would NOT allow the create.
const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const FOLDER_MIME = "application/vnd.google-apps.folder";

export interface PickedFolder {
  id: string;
  name: string;
}

export default function FolderSelector({
  value,
  onPick,
}: {
  value: PickedFolder | null;
  onPick: (folder: PickedFolder) => void;
}) {
  const { data: session } = useSession();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const launch = useCallback(async () => {
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
        scope: DRIVE_FILE_SCOPE,
        multiselect: false,
        buildView: (picker) =>
          new picker.DocsView(picker.ViewId.FOLDERS)
            .setIncludeFolders(true)
            .setSelectFolderEnabled(true)
            .setMimeTypes(FOLDER_MIME),
        onPicked: (docs) => {
          const folder = docs[0];
          if (folder) onPick({ id: folder.id, name: folder.name });
        },
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to open folder picker"
      );
    } finally {
      setLoading(false);
    }
  }, [session?.hasGoogle, onPick]);

  return (
    <div>
      <label className="block text-sm font-medium text-slate-700">
        Transcript Doc folder
      </label>
      <p className="mt-0.5 text-xs text-slate-500">
        Required for videos — each uploaded video gets a Google Doc created here.
      </p>
      <div className="mt-2 flex items-center gap-3">
        <button
          onClick={launch}
          disabled={loading}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
        >
          {loading
            ? "Opening…"
            : session?.hasGoogle
              ? value
                ? "Change folder"
                : "Choose folder"
              : "Connect Google Drive"}
        </button>
        <span className="truncate text-sm text-slate-600">
          {value ? value.name : "No folder selected"}
        </span>
      </div>
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
    </div>
  );
}
