let active = false;
/** Destructive confirmations always start on No; a second request never reuses another decision. */
export function confirmDelete(message: string): Promise<boolean> {
  if (active || typeof document === "undefined") return Promise.resolve(false);
  active = true;
  return new Promise(resolve => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.createElement("dialog"); dialog.className = "delete-confirm";
    dialog.setAttribute("aria-label", "Confirm deletion");
    const title = document.createElement("h3"); title.textContent = "Confirm deletion";
    const text = document.createElement("p"); text.textContent = message;
    const actions = document.createElement("div"); actions.className = "row";
    const no = document.createElement("button"); no.type = "button"; no.className = "btn"; no.textContent = "No"; no.autofocus = true;
    const yes = document.createElement("button"); yes.type = "button"; yes.className = "btn bad"; yes.textContent = "Yes";
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return; settled = true;
      window.removeEventListener("hashchange", cancel);
      dialog.remove(); active = false;
      if (previous?.isConnected) previous.focus();
      resolve(value);
    };
    const cancel = () => finish(false);
    no.onclick = cancel; yes.onclick = () => finish(true);
    dialog.addEventListener("cancel", e => { e.preventDefault(); cancel(); });
    dialog.addEventListener("close", cancel);
    dialog.addEventListener("click", e => { if (e.target === dialog) cancel(); });
    dialog.addEventListener("keydown", e => {
      e.stopPropagation();
      if (e.key === "Escape") { e.preventDefault(); cancel(); }
      else if (e.key === "Enter") { e.preventDefault(); if (!e.repeat) finish(document.activeElement === yes); }
    });
    actions.append(no, yes); dialog.append(title, text, actions); document.body.append(dialog);
    window.addEventListener("hashchange", cancel);
    try { dialog.showModal(); no.focus(); } catch { finish(false); }
  });
}
