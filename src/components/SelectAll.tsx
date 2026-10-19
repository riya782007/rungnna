import { useEffect, useRef } from "react";
export function SelectAll({ ids, selected, onChange, label = "Select all" }: { ids: string[]; selected: Set<string>; onChange: (value: Set<string>) => void; label?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const count = ids.filter(id => selected.has(id)).length;
  useEffect(() => { if (ref.current) ref.current.indeterminate = count > 0 && count < ids.length; }, [count, ids.length]);
  return <label className="row sm"><input ref={ref} type="checkbox" checked={!!ids.length && count === ids.length} disabled={!ids.length} onChange={e => onChange(e.target.checked ? new Set(ids) : new Set())} />{label}</label>;
}
