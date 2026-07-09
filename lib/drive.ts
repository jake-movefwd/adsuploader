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
const DOCS_BASE = "https://docs.googleapis.com/v1";
const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";

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

/**
 * Creates a Google Doc named `name` inside `folderId` and seeds it with the name
 * as a heading plus `seedText` as a body line. Returns the Doc's shareable
 * `webViewLink`. Requires the `drive.file` and `documents` scopes on `token`.
 *
 * `drive.file` grants write access to the picked folder only because the user
 * selected it through the Google Picker under the same OAuth client; a 403 here
 * means the linked Google session predates those scopes and must re-consent.
 */
export async function createDoc(
  token: string,
  name: string,
  folderId: string,
  seedText: string
): Promise<string> {
  // 1. Create the (empty) Doc directly in the destination folder.
  const createRes = await fetch(
    `${DRIVE_BASE}/files?fields=id,webViewLink&supportsAllDrives=true`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name,
        mimeType: GOOGLE_DOC_MIME,
        parents: [folderId],
      }),
    }
  );
  if (!createRes.ok) await driveError(createRes, "Failed to create Google Doc");
  const created = await createRes.json();
  const docId: string = created.id;
  const webViewLink: string = created.webViewLink;

  // 2. Seed the body: heading (the filename) + a reference line. The first
  //    insertable index in a Doc body is 1.
  const heading = name;
  const requests = [
    {
      insertText: {
        location: { index: 1 },
        text: `${heading}\n${seedText}\n`,
      },
    },
    {
      updateParagraphStyle: {
        range: { startIndex: 1, endIndex: 1 + heading.length },
        paragraphStyle: { namedStyleType: "HEADING_1" },
        fields: "namedStyleType",
      },
    },
  ];
  const seedRes = await fetch(`${DOCS_BASE}/documents/${docId}:batchUpdate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ requests }),
  });
  // The Doc already exists at this point; if seeding fails, still return the
  // link rather than losing the Doc — but a 403 scope error is worth surfacing.
  if (!seedRes.ok && seedRes.status === 403) {
    await driveError(seedRes, "Failed to write Google Doc content");
  }
  return webViewLink;
}
