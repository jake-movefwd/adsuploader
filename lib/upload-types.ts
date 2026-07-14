/** Client-side types shared by the upload UI components. */

import type { Aspect } from "./constants";

export type { Aspect };

export interface LocalItem {
  source: "local";
  /** Stable client-side id for React keys + state maps. */
  id: string;
  file: File;
  name: string;
  mimeType: string;
  sizeBytes: number;
  /** Set on crop items: which aspect ratio this crop is (1:1 / 9:16 / 16:9). */
  aspect?: Aspect;
  /** Set on crop items: id of the source photo; the 3 crops of one photo share it. */
  groupId?: string;
}

/**
 * A source photo selected for upload but not yet cropped. The cropper turns each
 * of these into three `LocalItem` crops (one per {@link Aspect}). Local sources
 * carry the picked `File`; Drive sources carry a `fileId` whose bytes are fetched
 * from `/api/drive/file` when the cropper opens.
 */
export interface PendingCrop {
  groupId: string;
  name: string;
  mimeType: string;
  source: "local" | "drive";
  file?: File;
  fileId?: string;
}

export interface DriveItem {
  source: "drive";
  id: string;
  fileId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
}

export type SelectedItem = LocalItem | DriveItem;

export type UploadStatus =
  | "pending"
  | "uploading"
  | "processing"
  | "success"
  | "error";

export interface UploadState {
  status: UploadStatus;
  /** 0..1 for the progress bar. */
  progress: number;
  assetId?: string;
  error?: string;
  /** Videos: link to the transcript Google Doc created on success. */
  docUrl?: string;
  /** Images: the Meta-hosted image URL (for caption writers to view the image). */
  imageUrl?: string;
  /**
   * Set when the video uploaded fine but its Doc couldn't be created (best-effort).
   * The item still counts as a success; only the Doc Link is missing.
   */
  docError?: string;
}
