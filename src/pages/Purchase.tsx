import { lazy, Suspense } from "react";
import { Head } from "../components/common";
import { useApp } from "../lib/app";

const PurchasePhoto = lazy(() => import("../components/PurchasePhoto"));

/* Owner, 22 Oct: printing stickers from a purchase bill has to be the easiest thing in the app to find.
   It used to sit folded inside Stock › Stock in. Now it has its own place in the menu (and F1, and a big
   button on Home): photo of the bill → check the lines → Approve & print. */
export default function Purchase() {
  const { me } = useApp();
  return <div style={{ paddingBottom: 80 }}>
    <Head title="Purchase bill → stickers" sub="1. Photo of the supplier's bill   2. Check the lines   3. Approve & print the stickers. Stock goes in by itself." />
    <Suspense fallback={<div role="status">Loading…</div>}><PurchasePhoto by={me?.id || ""} /></Suspense>
  </div>;
}
