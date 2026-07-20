# MEMORY.md — Ads Uploader status & progress

Living status log. Read this at session start; update it when work completes or a
decision is made. Keep it concise; prune stale entries. See `CLAUDE.md` for
architecture and conventions.

_Last updated: 2026-07-20_

## 2026-07-20 — Transcript workflow: select existing Doc (not create)

Switched the per-video transcript flow. Previously the user picked one Drive
**folder** per batch and the app **created** an empty Google Doc per video in it.
Now the transcript already exists, so the user **selects the existing Doc** per video
via the Google Picker (`pickDocFor` in `UploadUI`, `ViewId.DOCUMENTS`), and that
Doc's link goes straight into the output — captured client-side, no server call.

- Removed: `components/FolderSelector.tsx`, `app/api/drive/doc/route.ts`,
  `createDoc` in `lib/drive.ts`, the `needsReconnect` banner, and `UploadState.docError`.
- Reduced Google scopes to `drive.readonly` only (dropped `drive.file` + `documents`).
- Added: `PickedDoc` type, per-video `transcriptDocs` state + `videosNeedDoc` gate,
  and a "Set transcript" button per video in `FileList`.
- Build, lint, and typecheck all pass. Not yet exercised against live Google/Meta.

## Current status

**Initial scaffold complete and pushed to `main`** (`jake-movefwd/adsuploader`,
commit "Initial scaffold: Ads Uploader …"). Build, lint, and typecheck all pass.
Not yet run end-to-end against live Facebook/Google/Meta — needs real credentials.

## Done

- Project scaffolded: Next.js 14 App Router + TS + Tailwind + NextAuth v4.
- NextAuth: Facebook (primary) + Google (on-demand), JWT strategy, no DB. Tokens
  kept server-side, keyed by provider in the JWT.
- Route protection via `middleware.ts` (pages) + `requireToken()` per API route.
- API routes: `adaccounts`, `image` (local + Drive), video `start`/`transfer`/
  `finish`/`status`, and `from-drive` (SSE server-driven Drive video upload).
- UI (`components/`): account selector, Local/Drive toggle, drag-drop `DropZone`,
  `DrivePicker` (GIS token + Picker), per-file progress `FileList`, `ResultsPanel`
  with exact `filename - asset_id` output + Copy All. Concurrency capped at 3.
- `.env.example` (fully documented) + `README.md` (setup + Vercel notes).
- Bumped Next 14.2.5 → 14.2.35 to clear a flagged security advisory.

## Key decisions

- **Google Picker token tension** resolved the industry-standard way: short-lived
  `drive.readonly` token minted client-side *only* to render the Picker; real file
  downloads happen server-side with the session token. Long-lived tokens never hit
  the browser.
- **Google is on-demand** (only when the Drive tab is opened), not required at login.
  Both provider tokens live in the same encrypted JWT (no DB).
- **Local videos = client-driven chunks** (real progress); **Drive videos =
  server-driven SSE** (client can't chunk bytes it doesn't hold).

## Not done / needs attention

- **End-to-end untested** — requires a Facebook app (Marketing API approved), a
  Google Cloud project (Drive + Picker APIs), a Meta ad account, and a filled-in
  `.env.local`. Manual test checklist is in `README.md`.
- **Env values pending from user** — nothing is wired live until `.env.local` exists.
- `npm audit` still reports transitive dev-only vulnerabilities (non-blocking).
- Drive-video `maxDuration=300`: very large files may hit Vercel function limits.

## Next steps (when picked up)

1. Get env values from the user and create `.env.local`.
2. Run the `README.md` manual test checklist end-to-end; fix real-API surprises
   (esp. Meta video chunk offset behavior and Picker consent flow).
3. Configure Vercel project + env vars + domain, and OAuth redirect URIs.
