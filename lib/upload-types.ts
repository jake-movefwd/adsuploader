/** Client-side types shared by the upload UI components. */

export interface LocalItem {
  source: "local";
  /** Stable client-side id for React keys + state maps. */
  id: string;
  file: File;
  name: string;
  mimeType: string;
  sizeBytes: number;
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
}
