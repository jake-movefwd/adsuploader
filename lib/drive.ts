/**
 * Server-side Google Drive helpers. Downloads happen here (never in the
 * browser) using the Google access token from the encrypted JWT.
 */

export class DriveApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "DriveApiError";
  }
}

export interface DriveFileMeta {
  id: string;
  name: string;
  mimeType: string;
  size: number;
}

const DRIVE_BASE = "https://www.googleapis.com/drive/v3";

/** Fetches a file's metadata (name, mimeType, size). */
export async function getDriveFileMeta(
  token: string,
  fileId: string
): Promise<DriveFileMeta> {
  const url = `${DRIVE_BASE}/files/${encodeURIComponent(
    fileId
  )}?fields=id,name,mimeType,size&supportsAllDrives=true`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new DriveApiError(
      `Failed to read Drive file metadata (${res.status})`,
      res.status
    );
  }
  const body = await res.json();
  return {
    id: body.id,
    name: body.name,
    mimeType: body.mimeType,
    size: Number(body.size ?? 0),
  };
}

/**
 * Downloads file content as a Blob (files.get?alt=media). Held in memory only;
 * nothing is written to disk.
 */
export async function downloadDriveFile(
  token: string,
  fileId: string
): Promise<Blob> {
  const url = `${DRIVE_BASE}/files/${encodeURIComponent(
    fileId
  )}?alt=media&supportsAllDrives=true`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new DriveApiError(
      `Failed to download Drive file (${res.status})`,
      res.status
    );
  }
  return res.blob();
}
