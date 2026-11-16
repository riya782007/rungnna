import { useRef, type ButtonHTMLAttributes } from "react";
import { toast } from "../lib/app";
/** Pointer deletion requires a double click. Keyboard activation opens the same No-first confirmation. */
export function DeleteButton({ onDelete, title, children, ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "onDoubleClick"> & { onDelete: () => void | Promise<void> }) {
  const running = useRef(false);
  const run = async () => {
    if (running.current) return; running.current = true;
    try { await onDelete(); } catch (error: any) { toast(error.message || "Could not complete deletion", true); }
    finally { running.current = false; }
  };
  // one click did nothing and people thought deleting was broken (owner, 16 Nov): say what to do
  const single = useRef<any>(0);
  const hint = () => toast("Click twice quickly (double-click) to delete");
  return <button {...props} type="button" title={title || "Double-click to delete; confirmation starts on No"}
    onClick={event => { event.stopPropagation(); clearTimeout(single.current); if (event.detail === 0) void run(); else if (event.detail === 1) single.current = setTimeout(hint, 450); }}
    onDoubleClick={event => { event.preventDefault(); event.stopPropagation(); void run(); }}>{children}</button>;
}
