"use client";

import { useCallback, useMemo, useState } from "react";
import { signIn } from "next-auth/react";
import { upload } from "@vercel/blob/client";
import AccountSelector from "./AccountSelector";
import SourceToggle, { type UploadSource } from "./SourceToggle";
import DropZone from "./DropZone";
import DrivePicker from "./DrivePicker";
import FolderSelector, { type PickedFolder } from "./FolderSelector";
import FileList from "./FileList";
import ResultsPanel from "./ResultsPanel";
import ImageCropper from "./ImageCropper";
import {
  ASPECTS,
  MAX_CONCURRENT_UPLOADS,
  VIDEO_CHUNK_SIZE,
  isVideoMime,
  type Aspect,
} from "@/lib/constants";
import type {
  SelectedItem,
  UploadState,
  LocalItem,
  DriveItem,
  PendingCrop,
} from "@/lib/upload-types";

type Phase = "selecting" | "uploading" | "done";

async function readError(res: Response): Promise<string> {
  const body = await res.json().catch(() => ({}));
  return body.error || `Request failed (${res.status})`;
}

export default function UploadUI() {
  const [accountId, setAccountId] = useState<string | null>(null);
  const [source, setSource] = useState<UploadSource>("local");
  const [items, setItems] = useState<SelectedItem[]>([]);
  const [states, setStates] = useState<Record<string, UploadState>>({});
  const [phase, setPhase] = useState<Phase>("selecting");
  // Destination folder for the per-video transcript Docs. One per batch, not
  // persisted (no DB). Required to upload when the batch contains video(s).
  const [folder, setFolder] = useState<PickedFolder | null>(null);
  // Set when a Doc creation fails on a missing OAuth scope — prompts a one-time
  // Google re-consent (already-linked users predate the drive.file/documents scopes).
  const [needsReconnect, setNeedsReconnect] = useState(false);
  // Queue of source photos awaiting cropping. The cropper modal processes the
  // first one; each finished photo yields three crop items into the batch.
  const [pendingCrops, setPendingCrops] = useState<PendingCrop[]>([]);

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
  }, []);

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
  }, []);

  const newBatch = useCallback(() => {
    setItems([]);
    setStates({});
    setPhase("selecting");
  }, []);

  // Creates the transcript Doc for a video that just uploaded successfully.
  // Best-effort: a failure records `docError` but never downgrades the success.
  const createDocFor = useCallback(
    async (item: SelectedItem, videoId: string, acct: string) => {
      if (!folder) return;
      try {
        const res = await fetch("/api/drive/doc", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: item.name,
            folderId: folder.id,
            videoId,
            accountId: acct,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          if (body.needsReconnect) setNeedsReconnect(true);
          throw new Error(body.error || `Doc creation failed (${res.status})`);
        }
        const body = await res.json();
        update(item.id, { docUrl: body.url });
      } catch (err) {
        update(item.id, {
          docError:
            err instanceof Error ? err.message : "Doc creation failed",
        });
      }
    },
    [folder, update]
  );

  // ---- single-item upload workers -------------------------------------------

  const uploadImage = useCallback(
    async (item: SelectedItem, acct: string) => {
      update(item.id, { status: "uploading", progress: 0 });
      let res: Response;
      if (item.source === "local") {
        const file = (item as LocalItem).file;
        const blob = await upload(file.name, file, {
          access: "private",
          handleUploadUrl: "/api/blob/upload",
          onUploadProgress: ({ percentage }) => {
            update(item.id, { progress: (percentage / 100) * 0.9 });
          },
        });
        update(item.id, { progress: 0.9 });
        res = await fetch("/api/meta/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accountId: acct,
            blobUrl: blob.url,
            filename: file.name,
          }),
        });
      } else {
        res = await fetch("/api/meta/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountId: acct, fileId: (item as DriveItem).fileId }),
        });
      }
      if (!res.ok) throw new Error(await readError(res));
      const body = await res.json();
      update(item.id, {
        status: "success",
        progress: 1,
        assetId: body.assetId,
        imageUrl: body.imageUrl,
      });
    },
    [update]
  );

  const uploadLocalVideo = useCallback(
    async (item: LocalItem, acct: string) => {
      const size = item.sizeBytes;
      update(item.id, { status: "uploading", progress: 0 });

      // Start
      const startRes = await fetch("/api/meta/video/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: acct, fileSize: size }),
      });
      if (!startRes.ok) throw new Error(await readError(startRes));
      const { uploadSessionId, videoId } = await startRes.json();

      // Transfer in 10MB chunks, advancing by Meta's returned offset.
      let offset = 0;
      while (offset < size) {
        const end = Math.min(offset + VIDEO_CHUNK_SIZE, size);
        const chunk = item.file.slice(offset, end);
        const form = new FormData();
        form.append("accountId", acct);
        form.append("uploadSessionId", uploadSessionId);
        form.append("startOffset", String(offset));
        form.append("chunk", chunk, "chunk");
        const tRes = await fetch("/api/meta/video/transfer", {
          method: "POST",
          body: form,
        });
        if (!tRes.ok) throw new Error(await readError(tRes));
        const t = await tRes.json();
        offset = Number(t.startOffset);
        update(item.id, { progress: size ? offset / size : 1 });
        if (Number(t.startOffset) === Number(t.endOffset)) break;
      }

      // Finish
      const finishRes = await fetch("/api/meta/video/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: acct,
          uploadSessionId,
          filename: item.file.name,
        }),
      });
      if (!finishRes.ok) throw new Error(await readError(finishRes));

      // Poll processing status
      update(item.id, { status: "processing", progress: 0 });
      for (;;) {
        const sRes = await fetch(
          `/api/meta/video/status?videoId=${encodeURIComponent(videoId)}`
        );
        if (!sRes.ok) throw new Error(await readError(sRes));
        const s = await sRes.json();
        update(item.id, { progress: Math.min(s.processingProgress / 100, 1) });
        if (s.ready) break;
        await new Promise((r) => setTimeout(r, 2000));
      }

      update(item.id, { status: "success", progress: 1, assetId: videoId });
      await createDocFor(item, videoId, acct);
    },
    [update, createDocFor]
  );

  const uploadDriveVideo = useCallback(
    (item: DriveItem, acct: string) =>
      new Promise<void>((resolve, reject) => {
        update(item.id, { status: "uploading", progress: 0 });
        const url = `/api/meta/video/from-drive?accountId=${encodeURIComponent(
          acct
        )}&fileId=${encodeURIComponent(item.fileId)}`;
        const es = new EventSource(url);

        es.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            if (msg.type === "progress") {
              update(item.id, {
                status: msg.phase === "processing" ? "processing" : "uploading",
                progress: msg.progress ?? 0,
              });
            } else if (msg.type === "done") {
              update(item.id, {
                status: "success",
                progress: 1,
                assetId: msg.assetId,
              });
              es.close();
              // Create the transcript Doc, then resolve the worker (best-effort;
              // createDocFor never throws).
              createDocFor(item, msg.assetId, acct).finally(() => resolve());
            } else if (msg.type === "error") {
              es.close();
              reject(new Error(msg.error || "Drive video upload failed"));
            }
          } catch {
            // ignore malformed frame
          }
        };
        es.onerror = () => {
          es.close();
          reject(new Error("Connection to server lost during upload"));
        };
      }),
    [update, createDocFor]
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

  const startUpload = useCallback(async () => {
    if (!accountId || items.length === 0) return;
    setPhase("uploading");

    const queue = [...items];
    const worker = async () => {
      while (queue.length) {
        const item = queue.shift();
        if (item) await uploadOne(item, accountId);
      }
    };
    await Promise.allSettled(
      Array.from({ length: Math.min(MAX_CONCURRENT_UPLOADS, items.length) }, () =>
        worker()
      )
    );

    setPhase("done");
  }, [accountId, items, uploadOne]);

  const hasVideo = useMemo(
    () => items.some((i) => isVideoMime(i.mimeType)),
    [items]
  );

  const canUpload = useMemo(
    () =>
      Boolean(accountId) &&
      items.length > 0 &&
      phase === "selecting" &&
      // A destination folder is required whenever the batch contains video(s),
      // since each successful video gets a transcript Doc created there.
      (!hasVideo || Boolean(folder)),
    [accountId, items.length, phase, hasVideo, folder]
  );

  return (
    <div className="space-y-6">
      <AccountSelector value={accountId} onChange={setAccountId} />

      {phase === "selecting" && hasVideo && (
        <FolderSelector value={folder} onPick={setFolder} />
      )}

      {needsReconnect && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Google needs to be reconnected to create Docs (new permissions were
          added).{" "}
          <button
            onClick={() => signIn("google", { callbackUrl: "/" })}
            className="font-medium underline underline-offset-2 hover:text-amber-900"
          >
            Reconnect Google
          </button>
        </div>
      )}

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
        removable={phase === "selecting"}
      />

      {phase === "done" && (
        <ResultsPanel items={items} states={states} onNewBatch={newBatch} />
      )}

      {pendingCrops.length > 0 && (
        <ImageCropper
          key={pendingCrops[0].groupId}
          source={pendingCrops[0]}
          onDone={(crops) => onCropped(pendingCrops[0], crops)}
          onCancel={cancelCrop}
        />
      )}
    </div>
  );
}
