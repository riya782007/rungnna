import { useState } from "react";
import { setViewOpen, viewCodeMatches } from "../lib/viewCode";

/** The screen asks for the shop's view code (777 unless the owner changed it). */
export function ViewCodeGate() {
  const [code, setCode] = useState(""), [bad, setBad] = useState(false);
  return <form className="card pad stack" style={{ maxWidth: 360, margin: "40px auto" }} onSubmit={async e => {
    e.preventDefault();
    if (await viewCodeMatches(code)) setViewOpen(true); else { setBad(true); setCode(""); }
  }}>
    <b>Enter the code to open this screen</b>
    <input className="in mono" type="password" inputMode="numeric" autoFocus autoComplete="off" value={code} onChange={e => { setCode(e.target.value.replace(/\D/g, "")); setBad(false); }} />
    {bad && <div className="sm bad-text" role="alert">That code is not right.</div>}
    <button className="btn p" disabled={!code}>Open</button>
  </form>;
}
