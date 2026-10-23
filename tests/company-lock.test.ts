import { describe, expect, it, vi } from "vitest";
import { exitCompany, watchIdle } from "../src/lib/companyLock";

const two = [{ id: "main", kind: "gst" as const }, { id: "est", kind: "estimate" as const }];
describe("estimate company times out and locks (owner, 23 Oct)", () => {
  it("goes back to the tax-invoice company only from the estimate company", () => {
    expect(exitCompany(two, "est")).toBe("main");
    expect(exitCompany(two, "main")).toBe("");
    expect(exitCompany([{ id: "est", kind: "estimate" }], "est")).toBe("");   // only estimates allowed: nowhere to go
  });
  it("fires after the idle minutes, and any tap or key keeps it open", () => {
    vi.useFakeTimers();
    const t = new EventTarget(), doc = Object.assign(new EventTarget(), { hidden: false }) as any, idle = vi.fn();
    const stop = watchIdle(10, idle, t, doc);
    vi.advanceTimersByTime(9 * 60_000); t.dispatchEvent(new Event("keydown"));
    vi.advanceTimersByTime(9 * 60_000); expect(idle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_001); expect(idle).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30 * 60_000); expect(idle).toHaveBeenCalledTimes(1);
    stop(); vi.useRealTimers();
  });
  it("leaving the app for over a minute locks; a quick look away does not", () => {
    vi.useFakeTimers();
    const t = new EventTarget(), doc = Object.assign(new EventTarget(), { hidden: false }) as any, idle = vi.fn();
    const stop = watchIdle(10, idle, t, doc);
    doc.hidden = true; doc.dispatchEvent(new Event("visibilitychange")); vi.advanceTimersByTime(20_000);
    doc.hidden = false; doc.dispatchEvent(new Event("visibilitychange")); expect(idle).not.toHaveBeenCalled();
    doc.hidden = true; doc.dispatchEvent(new Event("visibilitychange")); vi.setSystemTime(Date.now() + 90_000);
    doc.hidden = false; doc.dispatchEvent(new Event("visibilitychange")); expect(idle).toHaveBeenCalledTimes(1);
    stop(); vi.useRealTimers();
  });
});
