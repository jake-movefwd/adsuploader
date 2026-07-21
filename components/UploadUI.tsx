"use client";

import { useCallback, useMemo, useState } from "react";
import { signIn, useSession } from "next-auth/react";
import { upload } from "@vercel/blob/client";
import AccountSelector from "./AccountSelector";
import SourceToggle, { type UploadSource } from "./SourceToggle";
import DropZone from "./DropZone";
import DrivePicker from "./DrivePicker";
import FileList from "./FileList";
import ResultsPanel from "./ResultsPanel";
import ImageCropper from "./ImageCropper";
import ThumbnailPicker from "./ThumbnailPicker";
import { launchPicker } from "@/lib/google-picker";
import {
  ASPECTS,
  MAX_CONCURRENT_UPLOADS,
  isVideoMime,
  type Aspect,
} from "@/lib/constants";
import type {
  SelectedItem,
  UploadState,
  LocalItem,
  DriveItem,
  PendingCrop,
  PickedDoc,
} from "@/lib/upload-types";

type Phase = "selecting" | "uploading" | "done";

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
const GOOGLE_APP_ID = process.env.NEXT_PUBLIC_GOOGLE_APP_ID;
// drive.readonly is enough to browse and select an existing Doc; the Picker
// returns its shareable link directly, so no server call or write scope is needed.
const DRIVE_READONLY_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";

async function readError(res: Response): Promise<string> {
  const body = await res.json().catch(() => ({}));
  return body.error || `Request failed (${res.status})`;
}

/**
 * The name Meta stores for a crop's ad image: the source filename with the aspect
 * ratio ("beach 9:16.jpg"). The blob/File name keeps a filesystem-safe suffix
 * (`beach-9x16.jpg`) since colons can't appear in a Vercel Blob pathname; only
 * the human-readable name sent to Meta uses the "9:16" form.
 */
function metaFilenameForCrop(sourceName: string, aspect: string): string {
  const dot = sourceName.lastIndexOf(".");
  const stem = dot > 0 ? sourceName.slice(0, dot) : sourceName;
  const ext = dot > 0 ? sourceName.slice(dot) : "";
  return `${stem} ${aspect}${ext}`;
}

export default function UploadUI() {
  const { data: session } = useSession();
  const [accountId, setAccountId] = useState<string | null>(null);
  const [source, setSource] = useState<UploadSource>("local");
  const [items, setItems] = useState<SelectedItem[]>([]);
  const [states, setStates] = useState<Record<string, UploadState>>({});
  const [phase, setPhase] = useState<Phase>("selecting");
  // The existing transcript Doc selected per video (keyed by video item id). Not
  // persisted (no DB). Required to upload for every video in the batch.
  const [transcriptDocs, setTranscriptDocs] = useState<Record<string, PickedDoc>>(
    {}
  );
  // Queue of source photos awaiting cropping. The cropper modal processes the
  // first one; each finished photo yields three crop items into the batch.
  const [pendingCrops, setPendingCrops] = useState<PendingCrop[]>([]);
  // Chosen thumbnail File per video item id. Required for every video before
  // upload; uploaded to Meta as an ad image alongside the video.
  const [thumbnails, setThumbnails] = useState<Record<string, File>>({});
  // Queue of videos awaiting thumbnail selection. The picker modal processes the
  // first one; videos are enqueued automatically as soon as they're selected.
  const [thumbnailQueue, setThumbnailQueue] = useState<SelectedItem[]>([]);

  const setThumbnail = useCallback((id: string, file: File) => {
    setThumbnails((prev) => ({ ...prev, [id]: file }));
  }, []);

  // Enqueue videos for thumbnail selection, skipping any already queued.
  const enqueueThumbnails = useCallback((videos: SelectedItem[]) => {
    setThumbnailQueue((prev) => {
      const queued = new Set(prev.map((v) => v.id));
      const fresh = videos.filter((v) => !queued.has(v.id));
      return fresh.length ? [...prev, ...fresh] : prev;
    });
  }, []);

  const advanceThumbnailQueue = useCallback(() => {
    setThumbnailQueue((prev) => prev.slice(1));
  }, []);

  const update = useCallback((id: string, patch: Partial<UploadState>) => {
    setStates((prev) => ({
      ...prev,
      [id]: { ...prev[id], ...patch } as UploadState,
    }));
  }, []);

  const addItems = useCallback((incoming: SelectedItem[]) => {
    setItems((prev) => {
      const existing = new Set(prev.map((p) => p.id));
      const merged = [...prev];
      incoming.forEach((i) => {
        if (!existing.has(i.id)) merged.push(i);
      });
      return merged;
    });
    setStates((prev) => {
      const next = { ...prev };
      incoming.forEach((i) => {
        if (!next[i.id]) next[i.id] = { status: "pending", progress: 0 };
      });
      return next;
    });
    // Videos need a thumbnail — prompt for it as soon as they're selected.
    enqueueThumbnails(incoming.filter((i) => isVideoMime(i.mimeType)));
  }, [enqueueThumbnails]);

  const queueCrops = useCallback((sources: PendingCrop[]) => {
    setPendingCrops((prev) => [...prev, ...sources]);
  }, []);

  // The cropper finished the current photo: turn its three crops into local
  // image items (each uploads independently) and advance the queue.
  const onCropped = useCallback(
    (source: PendingCrop, crops: { aspect: Aspect; file: File }[]) => {
      const items: LocalItem[] = crops.map((c) => {
        const suffix =
          ASPECTS.find((a) => a.key === c.aspect)?.suffix ?? c.aspect;
        return {
          source: "local",
          id: `${source.groupId}-${suffix}`,
          file: c.file,
          name: source.name,
          mimeType: c.file.type,
          sizeBytes: c.file.size,
          aspect: c.aspect,
          groupId: source.groupId,
        };
      });
      addItems(items);
      setPendingCrops((prev) => prev.slice(1));
    },
    [addItems]
  );

  const cancelCrop = useCallback(() => {
    setPendingCrops((prev) => prev.slice(1));
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    setStates((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setThumbnails((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setThumbnailQueue((prev) => prev.filter((v) => v.id !== id));
    setTranscriptDocs((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  // Removes a whole photo (all three aspect crops sharing a groupId) at once,
  // since the file list shows one photo's crops as a single ad. Crop ids are
  // `${groupId}-${suffix}`, so state entries are matched by that prefix.
  const removeGroup = useCallback((groupId: string) => {
    setItems((prev) =>
      prev.filter((i) => !(i.source === "local" && i.groupId === groupId))
    );
    setStates((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((id) => {
        if (id.startsWith(`${groupId}-`)) delete next[id];
      });
      return next;
    });
  }, []);

  const newBatch = useCallback(() => {
    setItems([]);
    setStates({});
    setThumbnails({});
    setThumbnailQueue([]);
    setTranscriptDocs({});
    setPhase("selecting");
  }, []);

  // Opens the Google Picker (filtered to Google Docs) so the user selects the
  // video's existing transcript Doc. The Picker returns the Doc's shareable link
  // directly — no server call — which we stash for output and set on the item now.
  const pickDocFor = useCallback(
    async (item: SelectedItem) => {
      if (!session?.hasGoogle) {
        signIn("google", { callbackUrl: "/" });
        return;
      }
      if (!GOOGLE_CLIENT_ID || !GOOGLE_APP_ID) return;
      await launchPicker({
        clientId: GOOGLE_CLIENT_ID,
        appId: GOOGLE_APP_ID,
        scope: DRIVE_READONLY_SCOPE,
        multiselect: false,
        buildView: (picker) =>
          new picker.DocsView(picker.ViewId.DOCUMENTS).setMimeTypes(
            GOOGLE_DOC_MIME
          ),
        onPicked: (docs) => {
          const doc = docs[0];
          if (!doc) return;
          const picked: PickedDoc = { id: doc.id, name: doc.name, url: doc.url };
          setTranscriptDocs((prev) => ({ ...prev, [item.id]: picked }));
          update(item.id, { docUrl: picked.url });
        },
      });
    },
    [session?.hasGoogle, update]
  );

  // ---- single-item upload workers -------------------------------------------

  // Uploads a local image `File` to Meta via Vercel Blob (bypassing the 4.5MB
  // Function body limit) and returns its Meta hash + hosted URL. Shared by the
  // image worker and the per-video thumbnail upload.
  const uploadImageFile = useCallback(
    async (
      file: File,
      acct: string,
      filename: string,
      onProgress?: (progress: number) => void
    ): Promise<{ assetId: string; imageUrl?: string }> => {
      const blob = await upload(file.name, file, {
        access: "private",
        handleUploadUrl: "/api/blob/upload",
        onUploadProgress: ({ percentage }) =>
          onProgress?.((percentage / 100) * 0.9),
      });
      onProgress?.(0.9);
      const res = await fetch("/api/meta/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: acct, blobUrl: blob.url, filename }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const body = await res.json();
      return { assetId: body.assetId, imageUrl: body.imageUrl };
    },
    []
  );

  const uploadImage = useCallback(
    async (item: SelectedItem, acct: string) => {
      update(item.id, { status: "uploading", progress: 0 });
      let assetId: string;
      let imageUrl: string | undefined;
      if (item.source === "local") {
        const local = item as LocalItem;
        // Crops carry the aspect ratio in the name Meta stores; plain local
        // uploads keep their original filename.
        const filename = local.aspect
          ? metaFilenameForCrop(local.name, local.aspect)
          : local.file.name;
        ({ assetId, imageUrl } = await uploadImageFile(
          local.file,
          acct,
          filename,
          (p) => update(item.id, { progress: p })
        ));
      } else {
        const res = await fetch("/api/meta/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountId: acct, fileId: (item as DriveItem).fileId }),
        });
        if (!res.ok) throw new Error(await readError(res));
        const body = await res.json();
        assetId = body.assetId;
        imageUrl = body.imageUrl;
      }
      update(item.id, { status: "success", progress: 1, assetId, imageUrl });
    },
    [update, uploadImageFile]
  );

  // Uploads a video's chosen thumbnail to Meta as an ad image after the video
  // itself has succeeded. Best-effort: a failure records `thumbnailError` but
  // never downgrades the already-succeeded video.
  const uploadThumbnailFor = useCallback(
    async (item: SelectedItem, acct: string) => {
      const file = thumbnails[item.id];
      if (!file) return;
      try {
        const dot = item.name.lastIndexOf(".");
        const stem = dot > 0 ? item.name.slice(0, dot) : item.name;
        const { assetId, imageUrl } = await uploadImageFile(
          file,
          acct,
          `${stem} thumbnail.jpg`
        );
        update(item.id, { thumbnailAssetId: assetId, thumbnailUrl: imageUrl });
      } catch (err) {
        update(item.id, {
          thumbnailError:
            err instanceof Error ? err.message : "Thumbnail upload failed",
        });
      }
    },
    [thumbnails, uploadImageFile, update]
  );

  // After the bytes are transferred, Meta transcodes the video asynchronously.
  // The upload routes return at that point (so a slow transcode can't time out
  // the function); we poll readiness here before treating the video as done.
  const pollVideoProcessing = useCallback(
    (videoId: string, itemId: string) =>
      new Promise<void>((resolve, reject) => {
        const poll = async () => {
          try {
            const res = await fetch(
              `/api/meta/video/status?videoId=${encodeURIComponent(videoId)}`
            );
            if (!res.ok) {
              const body = await res.json().catch(() => ({}));
              throw new Error(body.error || "Failed to check video processing");
            }
            const status = await res.json();
            update(itemId, {
              status: "processing",
              progress: Math.min((status.processingProgress ?? 0) / 100, 1),
            });
            if (status.ready) {
              resolve();
              return;
            }
          } catch (err) {
            reject(
              err instanceof Error ? err : new Error("Processing check failed")
            );
            return;
          }
          setTimeout(poll, 3000);
        };
        poll();
      }),
    [update]
  );

  // Shared SSE consumer for both the Drive and Blob video upload routes. The
  // routes stream upload progress, then emit a terminal `uploaded` event once
  // the bytes reach Meta; we then poll processing to ready. An `onerror` that
  // arrives WITHOUT a terminal event means the stream dropped mid-upload (e.g.
  // the function hit a limit) — surface a clear, retryable message rather than
  // a raw connection error.
  const runVideoUpload = useCallback(
    (url: string, item: SelectedItem, acct: string) =>
      new Promise<void>((resolve, reject) => {
        const es = new EventSource(url);
        let terminal = false;

        es.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            if (msg.type === "progress") {
              update(item.id, {
                status: msg.phase === "processing" ? "processing" : "uploading",
                progress: msg.progress ?? 0,
              });
            } else if (msg.type === "uploaded" || msg.type === "done") {
              terminal = true;
              es.close();
              update(item.id, { assetId: msg.assetId });
              // Legacy `done` means already processed; `uploaded` still needs a
              // processing wait before the video can be used in an ad.
              const ready =
                msg.type === "done"
                  ? Promise.resolve()
                  : pollVideoProcessing(msg.assetId, item.id);
              ready
                .then(() => {
                  update(item.id, { status: "success", progress: 1 });
                  // Best-effort thumbnail (never throws), then resolve.
                  uploadThumbnailFor(item, acct).finally(() => resolve());
                })
                .catch((err) => reject(err));
            } else if (msg.type === "error") {
              terminal = true;
              es.close();
              reject(new Error(msg.error || "Video upload failed"));
            }
          } catch {
            // ignore malformed frame
          }
        };
        es.onerror = () => {
          es.close();
          if (terminal) return;
          reject(
            new Error(
              "Upload interrupted before it finished — this can happen with very large files. Please try again."
            )
          );
        };
      }),
    [update, pollVideoProcessing, uploadThumbnailFor]
  );

  const uploadLocalVideo = useCallback(
    async (item: LocalItem, acct: string) => {
      update(item.id, { status: "uploading", progress: 0 });

      // Local videos are too large to chunk through a serverless Function
      // (Vercel's ~4.5MB body limit). Upload the whole file straight to Vercel
      // Blob (bypassing that limit), then let the server stream it back into
      // Meta's start/transfer/finish flow — the same pattern the Drive path uses.
      // `multipart` splits the file into parallel parts with automatic retries,
      // so a large upload doesn't ride one long-lived TLS stream (which was
      // failing mid-transfer with ERR_SSL_BAD_RECORD_MAC on big videos).
      const blob = await upload(item.file.name, item.file, {
        access: "private",
        handleUploadUrl: "/api/blob/upload",
        multipart: true,
        onUploadProgress: ({ percentage }) =>
          update(item.id, { progress: (percentage / 100) * 0.5 }),
      });

      const url =
        `/api/meta/video/from-blob?accountId=${encodeURIComponent(acct)}` +
        `&blobUrl=${encodeURIComponent(blob.url)}` +
        `&filename=${encodeURIComponent(item.file.name)}` +
        `&size=${encodeURIComponent(item.file.size)}`;
      await runVideoUpload(url, item, acct);
    },
    [update, runVideoUpload]
  );

  const uploadDriveVideo = useCallback(
    (item: DriveItem, acct: string) => {
      update(item.id, { status: "uploading", progress: 0 });
      const url = `/api/meta/video/from-drive?accountId=${encodeURIComponent(
        acct
      )}&fileId=${encodeURIComponent(item.fileId)}`;
      return runVideoUpload(url, item, acct);
    },
    [update, runVideoUpload]
  );

  const uploadOne = useCallback(
    async (item: SelectedItem, acct: string) => {
      try {
        if (!isVideoMime(item.mimeType)) {
          await uploadImage(item, acct);
        } else if (item.source === "local") {
          await uploadLocalVideo(item as LocalItem, acct);
        } else {
          await uploadDriveVideo(item as DriveItem, acct);
        }
      } catch (err) {
        update(item.id, {
          status: "error",
          progress: 0,
          error: err instanceof Error ? err.message : "Upload failed",
        });
      }
    },
    [uploadImage, uploadLocalVideo, uploadDriveVideo, update]
  );

  // ---- batch runner (concurrency capped at MAX_CONCURRENT_UPLOADS) ----------

  // Runs a set of items through the concurrency-capped worker pool.
  const runBatch = useCallback(
    async (list: SelectedItem[], acct: string) => {
      const queue = [...list];
      const worker = async () => {
        while (queue.length) {
          const item = queue.shift();
          if (item) await uploadOne(item, acct);
        }
      };
      await Promise.allSettled(
        Array.from({ length: Math.min(MAX_CONCURRENT_UPLOADS, list.length) }, () =>
          worker()
        )
      );
    },
    [uploadOne]
  );

  const startUpload = useCallback(async () => {
    if (!accountId || items.length === 0) return;
    setPhase("uploading");
    await runBatch(items, accountId);
    setPhase("done");
  }, [accountId, items, runBatch]);

  // Re-run only the items that errored, without rebuilding the batch. Thumbnails
  // and transcript Docs are still in state, so nothing needs re-selecting.
  const retryFailed = useCallback(async () => {
    if (!accountId) return;
    const failed = items.filter((i) => states[i.id]?.status === "error");
    if (failed.length === 0) return;
    setPhase("uploading");
    failed.forEach((i) =>
      update(i.id, { status: "pending", progress: 0, error: undefined })
    );
    await runBatch(failed, accountId);
    setPhase("done");
  }, [accountId, items, states, update, runBatch]);

  // Every video must have a thumbnail chosen before the batch can upload.
  const videosNeedThumbnails = useMemo(
    () => items.some((i) => isVideoMime(i.mimeType) && !thumbnails[i.id]),
    [items, thumbnails]
  );

  // And every video must have an existing transcript Doc selected.
  const videosNeedDoc = useMemo(
    () => items.some((i) => isVideoMime(i.mimeType) && !transcriptDocs[i.id]),
    [items, transcriptDocs]
  );

  const canUpload = useMemo(
    () =>
      Boolean(accountId) &&
      items.length > 0 &&
      phase === "selecting" &&
      // Every video needs both a thumbnail and a transcript Doc selected.
      !videosNeedThumbnails &&
      !videosNeedDoc,
    [accountId, items.length, phase, videosNeedThumbnails, videosNeedDoc]
  );

  return (
    <div className="space-y-6">
      <AccountSelector value={accountId} onChange={setAccountId} />

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <SourceToggle
            value={source}
            onChange={(s) => {
              if (phase !== "selecting") return;
              setSource(s);
            }}
          />
          {phase === "selecting" && (
            <button
              onClick={startUpload}
              disabled={!canUpload}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-40"
            >
              Upload {items.length > 0 ? `(${items.length})` : ""}
            </button>
          )}
        </div>

        {phase === "selecting" &&
          (source === "local" ? (
            <DropZone onAdd={addItems} onCropImages={queueCrops} />
          ) : (
            <DrivePicker onAdd={addItems} onCropImages={queueCrops} />
          ))}
      </div>

      <FileList
        items={items}
        states={states}
        onRemove={removeItem}
        onRemoveGroup={removeGroup}
        removable={phase === "selecting"}
        thumbnails={thumbnails}
        onPickThumbnail={(item) => enqueueThumbnails([item])}
        transcriptDocs={transcriptDocs}
        onPickDoc={pickDocFor}
      />

      {phase === "done" && (
        <ResultsPanel
          items={items}
          states={states}
          onNewBatch={newBatch}
          onRetryFailed={retryFailed}
        />
      )}

      {pendingCrops.length > 0 && (
        <ImageCropper
          key={pendingCrops[0].groupId}
          source={pendingCrops[0]}
          onDone={(crops) => onCropped(pendingCrops[0], crops)}
          onCancel={cancelCrop}
        />
      )}

      {thumbnailQueue.length > 0 && (
        <ThumbnailPicker
          key={thumbnailQueue[0].id}
          item={thumbnailQueue[0]}
          onDone={(file) => {
            setThumbnail(thumbnailQueue[0].id, file);
            advanceThumbnailQueue();
          }}
          onCancel={advanceThumbnailQueue}
        />
      )}
    </div>
  );
}
