import { db, getSetting, setSetting, now, type Staff } from "./db";
import { sb } from "./sync";
import { ownerOnly } from "./scope";
export async function ownerVerified(me: Staff) {
  if (me.role !== "owner") return true;
  const cfg = (await db.config.get("owner_security"))?.value;
  if (!cfg?.enabled) return true;
  const trusted = await getSetting<string>("owner_trust_" + me.id, "");
  return trusted === cfg.version;
}
export async function trustOwner(me: Staff) {
  const c = await sb(); if (!c) throw new Error("Connect the owner account first");
  const { data, error } = await c.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || data?.currentLevel !== "aal2") throw new Error("Verify the authenticator code first");
  const cfg = (await db.config.get("owner_security"))?.value;
  await setSetting("owner_trust_" + me.id, cfg?.version || "");
}
export async function ownerFactor() {
  const c = await sb(); if (!c) throw new Error("Connect the owner account first");
  const { data, error } = await c.auth.mfa.listFactors(); if (error) throw error;
  const factor = data?.totp.find(f => f.status === "verified"); if (!factor) throw new Error("Sign in using the account with the owner's authenticator");
  return factor.id;
}
export async function verifyOwner(code: string, me: Staff, factorId?: string) {
  if (!/^\d{6}$/.test(code)) throw new Error("Enter the six-digit authenticator code");
  const c = await sb(); if (!c) throw new Error("Connect the owner account first");
  const { error } = await c.auth.mfa.challengeAndVerify({ factorId: factorId || await ownerFactor(), code }); if (error) throw error;
  await trustOwner(me);
}
export async function enableOwnerSecurity(me: Staff) {
  ownerOnly(); const c = await sb(); if (!c) throw new Error("Connect the owner account first");
  const { data } = await c.auth.mfa.getAuthenticatorAssuranceLevel(); if (data?.currentLevel !== "aal2") throw new Error("Verify your authenticator before enabling");
  const cfg = { enabled: true, version: now() };
  await db.transaction("rw", [db.config, db.outbox, db.settings], async () => {
    await db.config.put({ id: "owner_security", value: cfg, updated_at: cfg.version });
    await db.outbox.add({ table: "config", row_id: "owner_security", at: cfg.version, tries: 0 });
    await setSetting("owner_trust_" + me.id, cfg.version);
  });
}
