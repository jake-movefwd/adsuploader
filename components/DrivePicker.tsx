"use client";

import { useCallback, useState } from "react";
import { signIn, useSession } from "next-auth/react";
import { ACCEPTED_MIME_TYPES } from "@/lib/constants";
import type { DriveItem } from "@/lib/upload-types";

declare global {
  interface Window {
    gapi: any;
    google: any;
  }
}

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
const PICKER_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY;
const APP_ID = process.env.NEXT_PUBLIC_GOOGLE_APP_ID;
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";

/** Injects an external script once, resolving when it has loaded. */
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const el = document.createElement("script");
    el.src = src;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(el);
  });
}

export default function DrivePicker({
  onAdd,
}: {
  onAdd: (items: DriveItem[]) => void;
}) {
  const { data: session } = useSession();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openPicker = useCallback(
    (accessToken: string) => {
      const google = window.google;
      const view = new google.picker.DocsView(google.picker.ViewId.DOCS)
        .setIncludeFolders(true)
        .setSelectFolderEnabled(false)
        .setMimeTypes(ACCEPTED_MIME_TYPES.join(","));

      const picker = new google.picker.PickerBuilder()
        .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
        .setAppId(APP_ID)
        .setOAuthToken(accessToken)
        .setDeveloperKey(PICKER_API_KEY)
        .addView(view)
        .setCallback((data: any) => {
          if (data.action === google.picker.Action.PICKED) {
            const items: DriveItem[] = (data.docs ?? []).map((doc: any) => ({
              source: "drive" as const,
              id: `drive-${doc.id}`,
              fileId: doc.id,
              name: doc.name,
              mimeType: doc.mimeType,
              sizeBytes: Number(doc.sizeBytes ?? 0),
            }));
            if (items.length) onAdd(items);
          }
        })
        .build();
      picker.setVisible(true);
    },
    [onAdd]
  );

  const launch = useCallback(async () => {
    // The Picker needs a Google account linked; connect on-demand.
    if (!session?.hasGoogle) {
      signIn("google", { callbackUrl: "/" });
      return;
    }
    if (!CLIENT_ID || !PICKER_API_KEY || !APP_ID) {
      setError(
        "Google Picker is not configured. Set NEXT_PUBLIC_GOOGLE_CLIENT_ID, NEXT_PUBLIC_GOOGLE_PICKER_API_KEY and NEXT_PUBLIC_GOOGLE_APP_ID."
      );
      return;
    }

    setError(null);
    setLoading(true);
    try {
      await Promise.all([
        loadScript("https://apis.google.com/js/api.js"),
        loadScript("https://accounts.google.com/gsi/client"),
      ]);

      await new Promise<void>((resolve) =>
        window.gapi.load("picker", () => resolve())
      );

      // Mint a short-lived, drive.readonly-only token used ONLY to render the
      // Picker. File downloads still happen server-side with the session token.
      const tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: DRIVE_SCOPE,
        callback: (resp: any) => {
          setLoading(false);
          if (resp.error || !resp.access_token) {
            setError("Could not obtain Google Drive access.");
            return;
          }
          openPicker(resp.access_token);
        },
      });
      tokenClient.requestAccessToken({ prompt: "" });
    } catch (err) {
      setLoading(false);
      setError(err instanceof Error ? err.message : "Failed to open Drive picker");
    }
  }, [session?.hasGoogle, openPicker]);

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
