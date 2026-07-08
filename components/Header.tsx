"use client";

import { signOut } from "next-auth/react";

export default function Header({ userName }: { userName: string | null }) {
  return (
    <header className="mb-8 flex items-center justify-between">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Ads Uploader</h1>
        <p className="text-sm text-slate-500">
          Upload creative to a Meta ad account
        </p>
      </div>
      <div className="flex items-center gap-3">
        {userName && (
          <span className="text-sm text-slate-600">{userName}</span>
        )}
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 transition hover:bg-slate-50"
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
