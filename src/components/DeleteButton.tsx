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
  return <button {...props} type="button" title={title || "Double-click to delete; confirmation starts on No"}
    onClick={event => { event.stopPropagation(); if (event.detail === 0) void run(); }}
    onDoubleClick={event => { event.preventDefault(); event.stopPropagation(); void run(); }}>{children}</button>;
}
