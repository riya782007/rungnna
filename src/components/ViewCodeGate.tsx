import { useState } from "react";
import { setViewOpen, viewCodeMatches } from "../lib/viewCode";
import { useApp } from "../lib/app";
import { roleName } from "../lib/roles";

/** The screen asks for the shop's view code (777 unless the owner changed it). */
export function ViewCodeGate() {
  const { me, setMe } = useApp();
  const [code, setCode] = useState(""), [bad, setBad] = useState(false);
  return <form className="card pad stack" style={{ maxWidth: 360, margin: "40px auto" }} onSubmit={async e => {
    e.preventDefault();
    if (await viewCodeMatches(code)) setViewOpen(true); else { setBad(true); setCode(""); }
  }}>
    <b>Screen access code</b>
    <div className="sm mut">Signed in as <b>{me?.name}</b> · {roleName(me)}.</div>
    <div className="sm">Enter the screen access code set by the owner. This is separate from the shop entry code and your personal PIN.</div>
    <input className="in mono" aria-label="Screen access code" type="password" inputMode="numeric" autoFocus autoComplete="off" value={code} onChange={e => { setCode(e.target.value.replace(/\D/g, "")); setBad(false); }} />
    {bad && <div className="sm bad-text" role="alert">Screen access code not recognised. Ask the owner to check or change it in Settings → People &amp; safety.</div>}
    <button className="btn p" disabled={!code}>Open</button>
    <div className="xs mut">The Owner role opens this screen without this code. A person or role named “Owner” still uses its assigned permissions.</div>
    <button type="button" className="btn" onClick={() => setMe(null)}>Switch person</button>
  </form>;
}
