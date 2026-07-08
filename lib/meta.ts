/**
 * Meta Graph API helpers. All functions run SERVER-SIDE only and take the
 * Facebook access token explicitly — tokens must never reach the browser.
 */

const API_VERSION = process.env.META_GRAPH_API_VERSION || "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${API_VERSION}`;
// Video uploads use the dedicated graph-video host.
const GRAPH_VIDEO_BASE = `https://graph-video.facebook.com/${API_VERSION}`;

export class MetaApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "MetaApiError";
  }
}

/** Extracts a human-readable message from a Meta error response body. */
async function readError(res: Response): Promise<never> {
  let message = `Meta API request failed (${res.status})`;
  try {
    const body = await res.json();
    if (body?.error?.message) {
      message = body.error.message;
    }
  } catch {
    // non-JSON error body; keep the generic message
  }
  throw new MetaApiError(message, res.status);
}

export interface AdAccount {
  name: string;
  account_id: string;
  /** Full "act_<account_id>" id used in edge URLs. */
  id: string;
}

/** GET /me/adaccounts?fields=name,account_id (paginated, follows `next`). */
export async function fetchAdAccounts(token: string): Promise<AdAccount[]> {
  const accounts: AdAccount[] = [];
  let url:
    | string
    | null = `${GRAPH_BASE}/me/adaccounts?fields=name,account_id&limit=200&access_token=${encodeURIComponent(
    token
  )}`;

  while (url) {
    const res: Response = await fetch(url);
    if (!res.ok) await readError(res);
    const body: any = await res.json();
    for (const a of body.data ?? []) {
      accounts.push({
        name: a.name,
        account_id: a.account_id,
        id: a.id ?? `act_${a.account_id}`,
      });
    }
    url = body.paging?.next ?? null;
  }
  return accounts;
}

/**
 * Uploads an image to /{ad_account_id}/adimages via multipart and returns the
 * Meta-assigned hash (the image "asset_id").
 */
export async function uploadImage(
  accountId: string,
  token: string,
  filename: string,
  bytes: Blob
): Promise<string> {
  const form = new FormData();
  form.append("access_token", token);
  // The multipart field name becomes the key in the response `images` map.
  form.append("source", bytes, filename);

  const res = await fetch(`${GRAPH_BASE}/${accountId}/adimages`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) await readError(res);

  const body = await res.json();
  const images = body.images ?? {};
  const first = Object.values(images)[0] as { hash?: string } | undefined;
  if (!first?.hash) {
    throw new MetaApiError("Meta did not return an image hash", 502);
  }
  return first.hash;
}

export interface VideoStartResult {
  videoId: string;
  uploadSessionId: string;
  startOffset: number;
  endOffset: number;
}

/** Start phase: reserves a video id + upload session for a file of `fileSize` bytes. */
export async function startVideoUpload(
  accountId: string,
  token: string,
  fileSize: number
): Promise<VideoStartResult> {
  const form = new FormData();
  form.append("access_token", token);
  form.append("upload_phase", "start");
  form.append("file_size", String(fileSize));

  const res = await fetch(`${GRAPH_VIDEO_BASE}/${accountId}/advideos`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) await readError(res);

  const body = await res.json();
  return {
    videoId: body.video_id,
    uploadSessionId: body.upload_session_id,
    startOffset: Number(body.start_offset),
    endOffset: Number(body.end_offset),
  };
}

export interface VideoTransferResult {
  startOffset: number;
  endOffset: number;
}

/**
 * Transfer phase: uploads one chunk at `startOffset` and returns the next
 * offsets Meta expects. When startOffset === endOffset, transfer is complete.
 */
export async function transferVideoChunk(
  accountId: string,
  token: string,
  uploadSessionId: string,
  startOffset: number,
  chunk: Blob
): Promise<VideoTransferResult> {
  const form = new FormData();
  form.append("access_token", token);
  form.append("upload_phase", "transfer");
  form.append("upload_session_id", uploadSessionId);
  form.append("start_offset", String(startOffset));
  form.append("video_file_chunk", chunk, "chunk");

  const res = await fetch(`${GRAPH_VIDEO_BASE}/${accountId}/advideos`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) await readError(res);

  const body = await res.json();
  return {
    startOffset: Number(body.start_offset),
    endOffset: Number(body.end_offset),
  };
}

/**
 * Finish phase: commits the upload session. `title` sets the video's display
 * name in the Meta Ads media library (otherwise it shows as "Untitled").
 */
export async function finishVideoUpload(
  accountId: string,
  token: string,
  uploadSessionId: string,
  title?: string
): Promise<void> {
  const form = new FormData();
  form.append("access_token", token);
  form.append("upload_phase", "finish");
  form.append("upload_session_id", uploadSessionId);
  if (title) {
    form.append("title", title);
  }

  const res = await fetch(`${GRAPH_VIDEO_BASE}/${accountId}/advideos`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) await readError(res);
}

export interface VideoStatus {
  processingProgress: number;
  videoStatus: string;
  ready: boolean;
}

/** GET /{video_id}?fields=status — used to poll post-upload processing. */
export async function getVideoStatus(
  token: string,
  videoId: string
): Promise<VideoStatus> {
  const url = `${GRAPH_BASE}/${videoId}?fields=status&access_token=${encodeURIComponent(
    token
  )}`;
  const res = await fetch(url);
  if (!res.ok) await readError(res);

  const body = await res.json();
  const status = body.status ?? {};
  const processingProgress = Number(status.processing_progress ?? 0);
  const videoStatus = String(status.video_status ?? "processing");
  return {
    processingProgress,
    videoStatus,
    ready: videoStatus === "ready" || processingProgress >= 100,
  };
}
