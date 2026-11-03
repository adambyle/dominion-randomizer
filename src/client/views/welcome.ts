// First visit (and "your sets" later): tap the boxes you have.

import { h, icon, type Child } from "../dom";
import { boxImage, data } from "../data";
import { normalizeCode, ROOM_CODE } from "../../shared/room";
import type { App } from "../main";

/** Kept across re-renders so changing a set doesn't snap the promos list shut. */
let promosOpen = false;
let joinCode = "";

export function welcomeView(app: App): Child {
  const { settings } = app.store.state;
  const enabled = new Set(settings.options.enabledBoxes);
  const setBoxes = (boxes: string[]) => app.store.dispatch({ type: "options", patch: { enabledBoxes: boxes } });
  const toggle = (ids: string[], on: boolean) =>
    setBoxes(on ? [...new Set([...settings.options.enabledBoxes, ...ids])] : settings.options.enabledBoxes.filter((b) => !ids.includes(b)));
  const promos = data.boxes.filter((b) => b.set === "promo");
  const promoIds = promos.map((b) => b.id);

  const tile = (setId: string) => {
    const s = data.sets.find((x) => x.id === setId)!;
    const boxes = data.boxes.filter((b) => b.set === s.id);
    const on = boxes.some((b) => enabled.has(b.id));
    const img = boxImage(s.id);
    // Tapping the box toggles the set (its current printing by default).
    const current = boxes.filter((b) => b.edition !== 1).map((b) => b.id);
    return h("div", { class: ["box", on ? "" : "off"] },
      h("button.box-art", { type: "button", "aria-pressed": String(on), "aria-label": s.name, onclick: () => toggle(on ? boxes.map((b) => b.id) : current, !on) },
        img ? h("img", { src: img.src, alt: "", loading: "lazy" }) : h("span.box-fallback", null, s.name),
        h("span.tick", null, icon("check"))),
      h("span.box-name", null, s.name),
      boxes.length > 1 && h("div.editions", { role: "group", "aria-label": `${s.name} editions` }, boxes.map((b) => h("button", {
        type: "button", class: enabled.has(b.id) ? "on" : "", "aria-pressed": String(enabled.has(b.id)), title: b.name,
        onclick: () => toggle([b.id], !enabled.has(b.id)),
      }, editionLabel(b.id, b.edition)))));
  };

  const expansions = data.sets.filter((s) => s.id !== "promo" && s.id !== "dominion").map((s) => s.id);
  const chosen = data.sets.filter((s) => s.id !== "promo" && s.boxes.some((b) => enabled.has(b))).length;
  const promoCount = promos.filter((b) => enabled.has(b.id)).length;
  const ready = settings.options.enabledBoxes.length > 0;
  const first = !settings.onboarded;

  // Some visitors only want to join a friend's room: skip the sets (the room has its own).
  const joinRoom = () => {
    const code = normalizeCode(joinCode);
    if (!ROOM_CODE.test(code)) return;
    if (!ready) setBoxes(["dominion-2"]);
    app.store.dispatch({ type: "settings", patch: { onboarded: true } });
    location.hash = `#/room/${code}`;
  };
  const joinForm = first && !app.store.roomMode && h("form.welcome-join", { onsubmit: (e: Event) => { e.preventDefault(); joinRoom(); } },
    h("label", { for: "welcome-code" }, "Just joining a room?"),
    h("input#welcome-code", { value: joinCode, placeholder: "ABC", maxlength: 3, autocapitalize: "characters", autocomplete: "off", spellcheck: "false",
      "aria-label": "Room code", oninput: (e: Event) => {
        joinCode = (e.target as HTMLInputElement).value;
        (document.getElementById("welcome-join-go") as HTMLButtonElement).disabled = !ROOM_CODE.test(normalizeCode(joinCode));
      } }),
    h("button#welcome-join-go.btn", { type: "submit", disabled: !ROOM_CODE.test(normalizeCode(joinCode)) }, "Join"));

  return h("div.welcome", null,
    joinForm,
    h("header.welcome-head", null,
      h("div", null,
        h("h1", null, app.store.roomMode ? "The room's sets" : first ? "Which sets do you have?" : "Your sets"),
        h("p.lede", null, ready
          ? `${chosen} ${chosen === 1 ? "set" : "sets"}${promoCount ? ` and ${promoCount} ${promoCount === 1 ? "promo" : "promos"}` : ""} chosen`
          : "Tap the boxes you own")),
      h("div.welcome-actions", null,
        h("button.btn.ghost", { type: "button", onclick: () => setBoxes(ready ? [] : data.boxes.filter((b) => b.edition !== 1 && b.set !== "promo").map((b) => b.id)) },
          ready ? "Clear all" : "Select all"),
        h("button.deal", { type: "button", disabled: !ready, onclick: () => app.finishWelcome(true) }, first ? "Deal a kingdom" : "Done"))),

    h("section.box-section", null,
      h("h2.label", null, "Base game"),
      h("div.boxes", null, tile("dominion"))),
    h("section.box-section", null,
      h("h2.label", null, "Expansions"),
      h("p.section-hint", null, "For sets with two editions, choose the ones you have — owning both adds the cards the 2nd edition removed."),
      h("div.boxes", null, expansions.map(tile))),
    h("section.box-section", null,
      h("details.promos", { open: promosOpen, ontoggle: (e: Event) => { promosOpen = (e.target as HTMLDetailsElement).open; } },
        h("summary", null, h("span.label", null, "Promos"), h("span.muted", null, ` ${promoCount} of ${promos.length}`)),
        h("div.promo-actions", null,
          h("button.btn.ghost", { type: "button", onclick: () => toggle(promoIds, true) }, "Select all"),
          h("button.btn.ghost", { type: "button", onclick: () => toggle(promoIds, false) }, "Clear")),
        h("div.promo-list", null, promos.map((b) => h("button", {
          type: "button", class: enabled.has(b.id) ? "on" : "", "aria-pressed": String(enabled.has(b.id)), onclick: () => toggle([b.id], !enabled.has(b.id)),
        }, b.name.replace(" (Promo)", "")))))));
}

function editionLabel(id: string, edition: 1 | 2 | null) {
  if (id === "cornucopia-1") return "Corn. 1st";
  if (id === "guilds-1") return "Guilds 1st";
  return edition === 1 ? "1st" : "2nd";
}
