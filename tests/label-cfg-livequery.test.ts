import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { liveQuery } from "dexie";
import { db, getSetting, setSetting } from "../src/lib/db";
import { loadLabelCfg, readLabelCfg } from "../src/pages/Labels";

/* 21 Oct: on a counter whose saved label settings were older, the bill reader's live query upgraded and
   SAVED them, which Dexie refuses inside a live query: Stock in, Labels and the AI strip crashed with
   "Readwrite transaction in liveQuery context". The live query now only reads. */
const first = <T,>(q: () => Promise<T>) => new Promise<T>((resolve, reject) => {
  const sub = liveQuery(q).subscribe({ next: v => { sub.unsubscribe(); resolve(v); }, error: e => { sub.unsubscribe(); reject(e); } });
});
describe("label settings in a live query", () => {
  it("reads old saved settings without writing, then saves the upgrade outside it", async () => {
    await db.settings.clear();
    await setSetting("label_cfg", { preset: "rjrow", w: 33, h: 15, cols: 3 });   // older settings: no textVersion
    await expect(first(() => loadLabelCfg())).rejects.toThrow(/liveQuery/i);       // what crashed the screen
    const cfg = await first(() => readLabelCfg());
    expect(cfg).toMatchObject({ w: 33, h: 15, cols: 3, textVersion: 1 });
    expect((await getSetting<any>("label_cfg", null)).textVersion).toBeUndefined();   // nothing saved by the live query
    await loadLabelCfg();
    expect((await getSetting<any>("label_cfg", null)).textVersion).toBe(1);
  });
});
