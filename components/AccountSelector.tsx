"use client";

import { useEffect, useState } from "react";

interface AdAccount {
  name: string;
  account_id: string;
  id: string;
}

export default function AccountSelector({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (accountId: string | null) => void;
}) {
  const [accounts, setAccounts] = useState<AdAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/meta/adaccounts");
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || "Failed to load ad accounts");
        }
        const body = await res.json();
        if (cancelled) return;
        const list: AdAccount[] = body.accounts ?? [];
        setAccounts(list);
        // Auto-select the first account if none chosen yet.
        if (!value && list.length > 0) {
          onChange(list[0].id);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load accounts");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-slate-700">
        Ad account
      </label>
      {loading ? (
        <div className="h-10 animate-pulse rounded-lg bg-slate-200" />
      ) : error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : accounts.length === 0 ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
          No ad accounts found for this user.
        </p>
      ) : (
        <select
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value || null)}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-400 focus:outline-none"
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.account_id})
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
