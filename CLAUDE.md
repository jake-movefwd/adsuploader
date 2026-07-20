# CLAUDE.md

Guidance for Claude Code when working in this repository.

> **Read `MEMORY.md` at the start of every session.** It holds the current status,
> decisions, and known gaps. When you finish a unit of work — or make a decision
> that future sessions need — **update `MEMORY.md`** so it stays the source of
> truth for progress. Keep it concise and current; prune stale entries.

## What this is

**Ads Uploader** — an internal tool for the Move team. Log in with Facebook, pick a
Meta ad account, upload image/video creative (from Google Drive or local), and get
back a copy-pasteable table (`Filename ⇥ Asset ID ⇥ Doc Link ⇥ Image URL`). For each
uploaded **video** the user selects its **existing** transcript Google Doc via the
Picker and that Doc's link goes in the Doc Link column; for each **image** the
Meta-hosted image URL goes in the Image URL column. Deploys to Vercel at
`adsuploader.movefwd.co`. Internal only — the only unauthenticated page is `/login`.

## Stack

Next.js 14 (App Router) · TypeScript · Tailwind CSS · NextAuth v4. Node 18.17+.

## Commands

```bash
npm run dev        # local dev (localhost:3000)
npm run build      # production build (also lints + typechecks)
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
```

Before committing non-trivial changes, run `npm run typecheck` and `npm run build`.

## Architecture & conventions

- **Auth (`lib/auth.ts`, `types/next-auth.d.ts`):** NextAuth v4, **JWT session
  strategy — no database** (nothing persists server-side). Facebook is the primary
  login; Google is linked **on-demand** when the user opens the Drive tab. Provider
  access tokens are stored in the encrypted JWT **keyed by provider**
  (`token.facebook`, `token.google`) so both coexist. Gotcha: NextAuth v4 rebuilds
  the `jwt()` callback's `token` param from scratch (just `name`/`email`/`picture`/
  `sub`) on every OAuth sign-in — it does not decode the existing session cookie
  first. So linking a second provider would silently drop the first provider's
  token unless `jwt()` explicitly recovers it, which it does by decoding the
  current session cookie via `next-auth/jwt`'s `decode()` before applying the
  provider that was just used. Don't "simplify" this away.
- **Google scopes (`lib/auth.ts` `GOOGLE_SCOPES`):** `drive.readonly` only — it
  covers both browsing Drive to select creative files AND selecting an existing
  transcript Doc (the Picker returns that Doc's link client-side, so no write
  access is needed). We used to also request `drive.file`/`documents` to *create*
  a per-video Doc; that flow is gone, so those scopes were removed. There is still
  **no token refresh** — `expiresAt` is stored but unused; an expired Google token
  401s (same as Drive reads today).
- **Google Picker developer key:** `components/DrivePicker.tsx` never calls
  `setDeveloperKey()` — `NEXT_PUBLIC_GOOGLE_PICKER_API_KEY` isn't used at all.
  A developer key is only needed for quota tracking on unauthenticated Picker
  views (e.g. public search); the `DocsView` here is fully OAuth-scoped via
  `setOAuthToken()`, so it doesn't need one — and a misconfigured key actively
  breaks the picker (`The API developer key is invalid`). Don't re-add it
  without confirming the key is correctly scoped to the same GCP project as
  `GOOGLE_CLIENT_ID`/`NEXT_PUBLIC_GOOGLE_APP_ID` first.
- **Picker bootstrap is shared (`lib/google-picker.ts`):** `launchPicker()` loads
  gapi/GIS, mints a Picker-only client token, and opens a Picker with a
  caller-supplied view. `DrivePicker.tsx` uses it for creative file selection
  (`drive.readonly`, multiselect, `ViewId.DOCS`). `UploadUI.tsx`'s `pickDocFor`
  uses it for the per-video **transcript Doc** picker (`drive.readonly`,
  single-select, `ViewId.DOCUMENTS` filtered to the Google Doc MIME). Both run
  under `drive.readonly` — selecting an existing Doc only needs read access, and
  the picked Doc's shareable `url` comes straight back from the Picker (no server
  call). A transcript Doc must be chosen for every video before Upload is enabled;
  the selection is kept per video in `transcriptDocs` (not persisted).
- **Tokens never reach the browser.** The `session` callback exposes only display
  fields + `hasFacebook`/`hasGoogle` booleans. The one exception is the Google
  Picker, which mints a short-lived `drive.readonly` token client-side *only* to
  render the Picker (Google's standard pattern); actual downloads happen server-side.
- **Route protection:** `middleware.ts` protects all pages (redirect to `/login`).
  It excludes `/api/*` so fetch callers get JSON 401s, not HTML redirects — every
  API route independently calls `requireToken()` (`lib/session.ts`) before any
  external call. Keep this defense-in-depth pattern when adding routes.
- **No persistence:** files stream browser → API route → Meta (or Drive → route →
  Meta). Never write uploaded files to disk or a DB; hold bytes in memory only.
- **Server-only helpers:** `lib/meta.ts` (Graph API — images + video phases,
  `MetaApiError`; `uploadImage` returns `{hash, url}` — the Meta-hosted image URL),
  `lib/drive.ts` (Drive metadata + download, `DriveApiError` with a `needsReconnect`
  flag on scope-403s). These take tokens explicitly and must only be imported by API
  routes.
- **Shared constants (`lib/constants.ts`):** accepted MIME types, `VIDEO_CHUNK_SIZE`
  (10MB), `MAX_CONCURRENT_UPLOADS` (3). Client types live in `lib/upload-types.ts`.

## Upload flows (know these before touching upload code)

- **Images** → `POST /api/meta/image`. Local files upload straight from the
  browser to Vercel Blob (`upload()` via `@vercel/blob/client`, token minted by
  `/api/blob/upload`), then the route is called with JSON `{accountId, blobUrl,
  filename}` — it fetches the bytes back server-to-server, forwards to Meta, and
  deletes the blob in a `finally`. This exists because Vercel Functions hard-cap
  request bodies at ~4.5MB (enforced at the edge, before the function runs) and
  Meta's image endpoint has no chunked/resumable upload like video does. Drive =
  JSON `{fileId}` (downloaded server-side, unaffected by the body limit). Legacy
  multipart `{accountId, file}` is still accepted for callers that don't go
  through Blob. Returns the image `hash` as the asset id.
- **Local videos** — client-driven: `start` → loop `transfer` (`VIDEO_CHUNK_SIZE`,
  currently 4MB — must stay under Vercel's ~4.5MB Function body limit) → `finish`
  → poll `status`. Client drives chunks so the progress bar is real; token
  stays server-side. asset id = `video_id`.
- **Drive videos** — server-driven SSE: `GET /api/meta/video/from-drive`. Server
  downloads from Drive and runs the chunk loop, streaming `progress`/`done`/`error`
  events. Declares `maxDuration = 300` (watch Vercel function limits for big files).
- Batch runner in `components/UploadUI.tsx`: concurrency capped at 3 via
  `Promise.allSettled`; a failed file shows inline and never halts the batch.
- **Transcript Docs (`pickDocFor` in `UploadUI`):** the user selects each video's
  **existing** transcript Doc through the Google Picker (before upload); the picked
  Doc's `url` is stored in `transcriptDocs[itemId]` and set on `UploadState.docUrl`
  at selection time. No Doc is created and there is no server route — the link is
  captured entirely client-side. A Doc is **required** per video (gated by
  `videosNeedDoc`, alongside the thumbnail gate). Images carry the Meta URL in
  `UploadState.imageUrl` instead. `ResultsPanel` renders both as the Doc Link /
  Image URL output columns.

## Environment

All config is via env vars — see `.env.example` for the full documented list
(Facebook app, Google OAuth client + Picker API key + GCP project number, NextAuth
secret/url, Graph API version). **Never hardcode or commit credentials.** `.env*`
(except `.env.example`) is gitignored. Ask the user for values rather than inventing.

## Git

Repo remote: `jake-movefwd/adsuploader`. Work on `main` unless told otherwise.
Commit/push only when the user asks.
