# Ads Uploader

Internal tool for the Move team: log in with Facebook, pick a Meta ad account,
upload image/video creative (from Google Drive or your local machine), and get a
copy‑pasteable list of `filename - asset_id` lines to paste into the ad builder.

- **Stack:** Next.js 14 (App Router) · TypeScript · Tailwind CSS · NextAuth v4
- **Deploy target:** Vercel → `adsuploader.movefwd.co`
- **No persistence:** files stream browser → API route → Meta (or Drive → route →
  Meta). Nothing is written to disk or a database. Access tokens live only in the
  encrypted JWT session, server-side.

## How it works

| Step | Where | Notes |
| --- | --- | --- |
| Login | `/login` | Single "Continue with Facebook" button. FB scopes: `ads_management, ads_read, business_management`. |
| Ad accounts | `GET /api/meta/adaccounts` | `GET /me/adaccounts?fields=name,account_id`. Populated dynamically — no hardcoded IDs. |
| Source | UI toggle | **Local** (drag-drop / browse) or **Google Drive** (Picker). One source per batch. |
| Google connect | on-demand | Google is only requested when you open the Drive tab; its token is merged into the same session (`drive.readonly`). |
| Image upload | `POST /api/meta/image` | Multipart → `/{account}/adimages`; returns the image `hash` (the asset id). |
| Video upload (local) | `start` → `transfer` → `finish` → `status` routes | Client drives 10 MB chunks for a real progress bar; token stays server-side. |
| Video upload (Drive) | `GET /api/meta/video/from-drive` (SSE) | Server downloads from Drive and runs the chunked upload, streaming progress back. |
| Output | Results panel | `X of Y uploaded successfully`, per-file status, and a textarea of `filename - asset_id` with **Copy All**. |

Uploads run concurrently, **capped at 3** (`Promise.allSettled`). A failed file
shows its error inline and does not halt the batch.

> **Google Picker & the "no client-side token" rule.** The Picker must run in the
> browser and needs an OAuth token to render. Following Google's own guidance, we
> mint a short-lived, `drive.readonly`-scoped token via Google Identity Services
> **solely to display the Picker**. The actual file download happens server-side
> with the session token — long-lived credentials never touch the browser.

## Local setup

1. **Install** (Node 18.17+):

   ```bash
   npm install
   ```

2. **Configure env.** Copy the example and fill in every value:

   ```bash
   cp .env.example .env.local
   ```

   See `.env.example` for exactly what each variable is and where to find it. At a
   minimum you need a Facebook app (Marketing API enabled) and — only if you want
   the Drive source — a Google Cloud project with the Drive API + Picker API
   enabled. Generate `NEXTAUTH_SECRET` with `openssl rand -base64 32`.

3. **OAuth redirect URIs** (add these in the FB app and Google Cloud console):
   - `http://localhost:3000/api/auth/callback/facebook`
   - `http://localhost:3000/api/auth/callback/google`
   - Add `http://localhost:3000` as an authorized JS origin for the Google client.

4. **Run:**

   ```bash
   npm run dev
   ```

   Open http://localhost:3000 → you'll be redirected to `/login`.

## Scripts

```bash
npm run dev        # local dev server
npm run build      # production build
npm run start      # serve the production build
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
```

## Vercel deployment

1. Import the repo (`jake-movefwd/adsuploader`) into Vercel.
2. Add all variables from `.env.example` under **Project → Settings → Environment
   Variables** (Production + Preview). Set `NEXTAUTH_URL` to the deployment URL
   (`https://adsuploader.movefwd.co` in Production).
3. Add the production + preview callback URLs to the Facebook app and Google OAuth
   client:
   - `https://adsuploader.movefwd.co/api/auth/callback/facebook`
   - `https://adsuploader.movefwd.co/api/auth/callback/google`
   - and the Vercel preview domains you use.
4. Point the `adsuploader.movefwd.co` domain at the project (Vercel → Domains).

> **Note on Drive videos & function limits.** `/api/meta/video/from-drive` downloads
> the file and streams the chunked upload server-side; it declares
> `maxDuration = 300`. Very large Drive videos may need a Vercel plan that allows a
> longer function duration. Local videos are chunked from the browser and are not
> subject to this.

## Manual test checklist

End-to-end needs real credentials + a Meta ad account (can't be automated here):

1. Visit the app unauthenticated → redirected to `/login`.
2. Continue with Facebook → land on the uploader; the ad-account dropdown
   populates from your accounts.
3. **Local image:** drop a `.jpg`/`.png` → Upload → row shows Done + a hash in the
   output textarea.
4. **Local video:** drop an `.mp4` → progress bar advances through upload then
   processing → Done with a video id.
5. **Drive image & video:** switch to the Drive tab → connect Google if prompted →
   pick files in the Picker → Upload.
6. Click **Copy All** and confirm the clipboard holds `filename - asset_id` lines.
7. Kill one upload (e.g. bad file) and confirm the rest of the batch still finish
   and the error shows inline.
```
