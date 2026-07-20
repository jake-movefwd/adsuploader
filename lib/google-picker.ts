/**
 * Client-side Google Picker bootstrap, shared by DrivePicker (creative file
 * selection) and UploadUI's transcript-Doc picker (selecting the existing Google
 * Doc to link per video). Loads the gapi + GIS scripts once, mints a short-lived
 * OAuth token via Google Identity Services (used ONLY to render the Picker UI —
 * server operations use the session token), builds a Picker with the
 * caller-supplied view, and returns the picked docs.
 *
 * No developer key is set — see CLAUDE.md / DrivePicker for why.
 */

declare global {
  interface Window {
    gapi: any;
    google: any;
  }
}

/** Injects an external script once, resolving when it has loaded. */
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const el = document.createElement("script");
    el.src = src;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(el);
  });
}

export interface PickerLaunchOptions {
  clientId: string;
  appId: string;
  /** OAuth scope for the Picker token, e.g. drive.readonly or drive.file. */
  scope: string;
  /** Allow selecting multiple items. */
  multiselect?: boolean;
  /** Builds the view to add, given the `google.picker` namespace. */
  buildView: (picker: any) => any;
  /** Receives the raw picked docs (`data.docs`) when the user confirms. */
  onPicked: (docs: any[]) => void;
}

/**
 * Loads the Picker, mints a Picker-only OAuth token, and opens it. Resolves once
 * the Picker is shown; rejects if scripts fail to load or the token is denied.
 */
export async function launchPicker(opts: PickerLaunchOptions): Promise<void> {
  await Promise.all([
    loadScript("https://apis.google.com/js/api.js"),
    loadScript("https://accounts.google.com/gsi/client"),
  ]);
  await new Promise<void>((resolve) =>
    window.gapi.load("picker", () => resolve())
  );

  const accessToken = await new Promise<string>((resolve, reject) => {
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: opts.clientId,
      scope: opts.scope,
      callback: (resp: any) => {
        if (resp.error || !resp.access_token) {
          reject(new Error("Could not obtain Google Drive access."));
          return;
        }
        resolve(resp.access_token);
      },
    });
    tokenClient.requestAccessToken({ prompt: "" });
  });

  const google = window.google;
  const builder = new google.picker.PickerBuilder();
  if (opts.multiselect) {
    builder.enableFeature(google.picker.Feature.MULTISELECT_ENABLED);
  }
  builder
    .setAppId(opts.appId)
    .setOAuthToken(accessToken)
    .addView(opts.buildView(google.picker))
    .setCallback((data: any) => {
      if (data.action === google.picker.Action.PICKED) {
        opts.onPicked(data.docs ?? []);
      }
    });
  builder.build().setVisible(true);
}
