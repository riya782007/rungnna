import { useState } from "react";
import { setViewOpen, viewCodeMatches } from "../lib/viewCode";
import { useApp } from "../lib/app";

/** The screen asks for the shop's view code (777 unless the owner changed it). */
export function ViewCodeGate() {
  const { setMe } = useApp();
  const [code, setCode] = useState(""), [bad, setBad] = useState(false);
  return <form className="card pad stack" style={{ maxWidth: 360, margin: "40px auto" }} onSubmit={async e => {
    e.preventDefault();
    if (await viewCodeMatches(code)) setViewOpen(true); else { setBad(true); setCode(""); }
  }}>
    <b>Screen access code</b>
    {/* owner, 26 Oct: no explanations of who else can open it or where it is set — just the code */}
    <input className="in mono" aria-label="Screen access code" type="password" inputMode="numeric" autoFocus autoComplete="off" value={code} onChange={e => { setCode(e.target.value.replace(/\D/g, "")); setBad(false); }} />
    {bad && <div className="sm bad-text" role="alert">Code not recognised.</div>}
    <button className="btn p" disabled={!code}>Open</button>
    <button type="button" className="btn" onClick={() => setMe(null)}>Switch person</button>
  </form>;
}
