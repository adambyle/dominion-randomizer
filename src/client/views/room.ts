// Multiplayer rooms (#/room, #/room/<code>): create or join a room, see who's there, pick the
// room's sets, and the games the room has played.

import { h, icon, type Child } from "../dom";
import { byCost, data, db, name } from "../data";
import { normalizeCode } from "../../shared/room";
import { joinLink, qrSvg } from "./qr";
import type { App } from "../main";

let joinCode = "";
let busy = false;
let copied = false;

const timeFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function roomView(app: App, path: string | null): Child {
  const room = app.room;
  // "ABC" or "ABC/rules" (the QR link, which opens the rules of a locked table).
  const [codeFromUrl = null, extra] = (path ?? "").split("/");
  if (extra === "rules" && room.code && normalizeCode(codeFromUrl ?? "") === room.code && room.status === "open") {
    queueMicrotask(() => app.goToReference());
  }
  const rerender = () => app.render();

  // Following a room link joins it.
  if (codeFromUrl && normalizeCode(codeFromUrl) !== room.code && !room.error) queueMicrotask(() => room.join(codeFromUrl));

  const nameField = h("label.room-name", null, h("span.muted", null, "Your name in rooms"),
    h("input#room-name", { value: room.name, maxlength: 24, autocomplete: "nickname",
      onchange: (e: Event) => { room.name = (e.target as HTMLInputElement).value.trim() || "Player"; } }));

  if (!room.code) {
    return h("div.page.room-page", null,
      h("h1", null, "Play together"),
      h("p.lede", null, "Start a room and share its code. Everyone in the room sees the same table and setup, can deal, swap and lock cards, and the games you mark as played go into everyone's history."),
      room.error && h("p.form-error", { role: "alert" }, room.error),
      nameField,
      h("div.room-start", null,
        h("section", null,
          h("h2", null, "Start a room"),
          h("p.muted", null, "It starts with your table and your sets."),
          h("button.deal", { type: "button", disabled: busy, onclick: async () => {
            busy = true; rerender();
            try { const code = await room.create(); location.hash = `#/room/${code}`; } catch (err) { room.error = err instanceof Error ? err.message : "Couldn't create a room."; }
            busy = false; rerender();
          } }, "Start a room")),
        h("section", null,
          h("h2", null, "Join a room"),
          h("form.room-join", { onsubmit: (e: Event) => { e.preventDefault(); room.error = null; location.hash = `#/room/${normalizeCode(joinCode)}`; } },
            h("input#room-code", { value: joinCode, placeholder: "ABC", maxlength: 3, autocapitalize: "characters", autocomplete: "off", spellcheck: "false",
              oninput: (e: Event) => { joinCode = (e.target as HTMLInputElement).value; } }),
            h("button.btn", { type: "submit" }, "Join")))));
  }

  const link = `${location.origin}${location.pathname}#/room/${room.code}`;
  const locked = app.store.state.game.setupLocked;
  const union = [...new Set([...room.myBoxes, ...room.members.flatMap((m) => m.boxes)])];
  const setBoxes = (boxes: string[]) => app.store.dispatch({ type: "options", patch: { enabledBoxes: boxes.filter((b) => data.boxes.some((x) => x.id === b)) } });
  const roomBoxes = app.store.state.settings.options.enabledBoxes;
  const setNames = data.sets.filter((s) => s.boxes.some((b) => roomBoxes.includes(b)) && s.id !== "promo").map((s) => s.name);

  return h("div.page.room-page", null,
    h("h1", null, "Room ", h("span.room-code", null, room.code)),
    h("p.lede", null, room.status === "open" ? "Everyone here sees the same table." : room.status === "reconnecting" ? "Reconnecting…" : "Connecting…"),
    room.error && h("p.form-error", { role: "alert" }, room.error),
    h("div.row", null,
      h("button.btn", { type: "button", onclick: async () => {
        try { await navigator.clipboard.writeText(link); copied = true; rerender(); setTimeout(() => { copied = false; rerender(); }, 2000); } catch { prompt("Copy this link", link); }
      } }, icon("check"), copied ? "Copied" : "Copy invite link"),
      h("a.deal", { href: "#/" }, "Go to the table"),
      h("button.btn.ghost", { type: "button", onclick: () => { room.leave(); location.hash = "#/room"; } }, "Leave room")),
    nameField,
    locked && h("section.room-section.room-qr", null,
      h("div", null,
        h("h2", null, "The table is locked"),
        h("p.muted", null, "Anyone who scans this joins the room and lands on the cards’ rules."),
        h("button.btn", { type: "button", onclick: () => app.openReference() }, icon("info"), "Open the rules")),
      h("div.qr-code", null, qrSvg(joinLink(room.code)))),
    h("section.room-section", null,
      h("h2", null, `Here now (${room.members.length})`),
      h("ul.room-members", null, room.members.map((m) => h("li", null, icon("user"), h("span", null, m.name), m.id === room.you && h("span.muted", null, " (you)"))))),
    h("section.room-section", null,
      h("h2", null, "The room's sets"),
      h("p.muted", null, setNames.length ? setNames.join(", ") : "None chosen yet."),
      h("div.row", null,
        h("button.btn", { type: "button", onclick: () => setBoxes(room.myBoxes) }, "Use my sets"),
        h("button.btn", { type: "button", onclick: () => setBoxes(union) }, "Combine everyone's sets"),
        h("a.btn.ghost", { href: "#/sets" }, "Choose sets…"))),
    room.history.length > 0 && h("section.room-section", null,
      h("h2", null, "Played in this room"),
      h("ul.room-history", null, room.history.map((p) => h("li", null,
        h("span.muted", null, `${timeFmt.format(p.playedAt)} · ${p.by}`), h("br"),
        p.game.kingdom.filter((id) => db.byId.has(id)).map((id) => db.get(id)).sort(byCost).map((c) => c.name).join(", "),
        p.game.landscapes.length > 0 && h("span.muted", null, ` · ${p.game.landscapes.map(name).join(", ")}`))))));
}
