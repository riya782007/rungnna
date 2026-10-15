import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/* Nothing in the cloud works until the shop login exists — sync, photo upload and the
   AI bill reader all check this one session. Making it from the app is the step that
   unblocks everything, so each answer the auth server can give has to land correctly. */

const auth = vi.hoisted(() => ({
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  getSession: vi.fn(async () => ({ data: { session: null } })),
  signOut: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth, from: () => ({}) }) }));

const { db, setSetting } = await import("../src/lib/db");
const { createShopLogin, resetClient } = await import("../src/lib/sync");

beforeEach(async () => {
  await Promise.all(db.tables.map(t => t.clear()));
  await setSetting("cloud", { url: "https://x.supabase.co", key: "anon" });
  resetClient();
  auth.signUp.mockReset(); auth.signInWithPassword.mockReset().mockResolvedValue({ error: null });
});

describe("making the shop login from the app", () => {
  it("connects straight away when the project does not ask for e-mail confirmation", async () => {
    auth.signUp.mockResolvedValue({ data: { user: { id: "u" }, session: { access_token: "t" } }, error: null });
    await expect(createShopLogin("shop@rungnna.in", "rungnna-2026")).resolves.toBe("ready");
    expect(auth.signUp).toHaveBeenCalledWith({ email: "shop@rungnna.in", password: "rungnna-2026" });
  });

  it("says a confirmation e-mail is needed rather than claiming it is connected", async () => {
    auth.signUp.mockResolvedValue({ data: { user: { id: "u" }, session: null }, error: null });
    await expect(createShopLogin("shop@rungnna.in", "rungnna-2026")).resolves.toBe("confirm");
  });

  it("treats an existing login as a sign-in, so a second device never gets stuck", async () => {
    auth.signUp.mockResolvedValue({ data: {}, error: { message: "User already registered" } });
    await expect(createShopLogin("shop@rungnna.in", "rungnna-2026")).resolves.toBe("ready");
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: "shop@rungnna.in", password: "rungnna-2026" });
  });

  it("names the Supabase switch when sign-ups are turned off", async () => {
    auth.signUp.mockResolvedValue({ data: {}, error: { message: "Signups not allowed for this instance" } });
    await expect(createShopLogin("shop@rungnna.in", "rungnna-2026")).rejects.toThrow(/Authentication/);
  });

  it("refuses a short password before anything is sent", async () => {
    await expect(createShopLogin("shop@rungnna.in", "1234")).rejects.toThrow(/8 characters/);
    expect(auth.signUp).not.toHaveBeenCalled();
  });
});
