import { expect, it } from "vitest";
import { planTour, mapsLinks, km } from "../src/lib/tour";
import { rankCustomers } from "../src/lib/customerRank";
import { jobKind, pageSizeOf } from "../src/lib/printing";

it("plans a tour that visits every stop once and is not longer than the order given", () => {
  const start = { id: "s", lat: 28.65, lng: 77.21 };
  const stops = [{ id: "a", lat: 28.9, lng: 77.2 }, { id: "b", lat: 28.4, lng: 77.3 }, { id: "c", lat: 28.91, lng: 77.22 }, { id: "d", lat: 28.41, lng: 77.31 }];
  const { order, km: d } = planTour(stops, start);
  expect(order.map(x => x.id).sort()).toEqual(["a", "b", "c", "d"]);
  const naive = [start, ...stops, start].reduce((a, p, i, all) => i ? a + km(all[i - 1], p) : 0, 0);
  expect(d).toBeLessThanOrEqual(naive);
  // a and c are next to each other, so are b and d
  const ids = order.map(x => x.id).join("");
  expect(/ac|ca/.test(ids) && /bd|db/.test(ids)).toBe(true);
  expect(mapsLinks(order, start)[0]).toContain("waypoints=");
});

it("ranks customers and flags one who stopped coming", () => {
  const day = (n: number) => new Date(Date.UTC(2026, 10, 14) - n * 86400000).toISOString();
  const bill = (party: string, n: number, net: number) => ({ id: party + n, party_id: party, status: "final", bill_type: "estimate", at: day(n), net, items: [{ item: "BRACELET", qty: 5 }], discount_pct: 50 }) as any;
  const bills = [bill("big", 100, 5e6), bill("big", 90, 5e6), bill("big", 80, 5e6), bill("small", 3, 1e5), bill("small", 10, 1e5)];
  const parties = [{ id: "big", name: "BIG", kind: "customer", phone: "", city: "" }, { id: "small", name: "SMALL", kind: "customer", phone: "", city: "" }] as any;
  const r = rankCustomers(bills, parties, new Map([["big", 20000_00]]), new Map(), Date.UTC(2026, 10, 14));
  expect(r[0].party_id).toBe("big"); expect(r[0].grade).toBe("A"); expect(r[0].points).toBe(150);
  expect(r[0].notReturning).toBe(true); expect(r[0].why[0]).toContain("due");
  expect(r[1].notReturning).toBe(false); expect(r[0].top).toEqual(["BRACELET"]);
});

it("knows a sticker page from a bill page for direct printing", () => {
  const el = (css: string, thermal = false) => ({ querySelector: (q: string) => thermal && q.includes("thermal") ? {} : null, querySelectorAll: () => [{ textContent: css }] }) as any;
  expect(jobKind(el("@page{size:50mm 25mm}"))).toBe("label");
  expect(jobKind(el("@page{size:148mm 210mm}"))).toBe("a4");
  expect(jobKind(el("", true))).toBe("bill");
  expect(pageSizeOf(el("@page{size:80mm 412mm;margin:2mm}"))).toEqual([80, 412]);
});
