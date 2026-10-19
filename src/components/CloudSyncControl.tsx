import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { cloudSyncEnabled, setCloudSyncEnabled } from "../lib/cloudMode";
import { syncNow } from "../lib/sync";
import { toast, useApp } from "../lib/app";

export function CloudSyncControl() {
  const { me } = useApp();
  const enabled = useLiveQuery(cloudSyncEnabled, [], true);
  const [busy, setBusy] = useState(false);
  return <div className="stack">
    <label className="row sm"><input type="checkbox" checked={enabled} disabled={me?.role !== "owner" || busy} onChange={async e => {
      const next = e.target.checked;
      setBusy(true);
      try { await setCloudSyncEnabled(next); await syncNow(); }
      catch (error: any) { toast(error.message || "Could not change cloud mode", true); }
      finally { setBusy(false); }
    }} /> Cloud sync enabled on this computer, including GST bills</label>
    <div className="xs mut">Billing and stock save on this computer with or without internet. When connected, waiting changes sync automatically and updates arrive from other counters. The owner can untick this box to pause cloud sync deliberately. Government submission needs its own approval on the bill. Pausing stops subsequent sync requests; it does not remove data already sent.</div>
  </div>;
}
