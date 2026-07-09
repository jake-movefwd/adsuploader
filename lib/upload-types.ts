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
