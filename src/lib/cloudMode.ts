import { getSetting, setSetting } from "./db";
import { ownerOnly } from "./scope";

// Billing always saves locally first. Online counters sync automatically unless the owner deliberately pauses this device.
export const cloudSyncEnabled = () => getSetting<boolean>("cloud_sync_enabled", true);
export async function setCloudSyncEnabled(enabled: boolean) {
  ownerOnly();
  await setSetting("cloud_sync_enabled", enabled === true);
}
export async function assertCloudSyncEnabled() {
  if (!await cloudSyncEnabled()) throw new Error("Offline mode is active. The owner can allow cloud sync in Settings → Cloud backup.");
}
