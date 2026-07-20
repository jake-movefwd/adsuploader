/**
 * Server-side Google Drive helpers. Downloads happen here (never in the
 * browser) using the Google access token from the encrypted JWT.
 */

export class DriveApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** True when the failure is a missing OAuth scope (needs Google re-consent). */
    readonly needsReconnect = false
  ) {
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

/**
 * Turns a failed Google API response into a DriveApiError, flagging 403s that
 * are caused by a missing OAuth scope (which need a Google re-consent) so the
 * caller can prompt the user to reconnect rather than treating it as a hard error.
 */
async function driveError(res: Response, fallback: string): Promise<never> {
  let message = `${fallback} (${res.status})`;
  let needsReconnect = false;
  try {
    const body = await res.json();
    const reason: string | undefined = body?.error?.errors?.[0]?.reason;
    if (body?.error?.message) message = body.error.message;
    if (
      res.status === 403 &&
      (reason === "insufficientPermissions" ||
        /insufficient (authentication|permission|scope)/i.test(message))
    ) {
      needsReconnect = true;
    }
  } catch {
    // non-JSON error body; keep the generic message
  }
  throw new DriveApiError(message, res.status, needsReconnect);
}
