// Card weights and bans: the control shown on the card sheet and in the Cards list.

import { h, icon, type Child } from "../dom";
import { BANNED, DEFAULT_WEIGHT, isBanned, isTuned, MAX_WEIGHT, MIN_WEIGHT, weightOf, WEIGHT_LABELS } from "../../shared/cardPrefs";
import type { App } from "../main";

const WEIGHTS = Array.from({ length: MAX_WEIGHT - MIN_WEIGHT + 1 }, (_, i) => MIN_WEIGHT + i);

/** What a card's setting means, in a few words ("Never dealt", "Normal", "Weight 4 of 5 · More often"). */
export function prefSummary(app: App, id: string): string {
  const prefs = app.store.state.settings.cardPrefs;
  if (isBanned(prefs, id)) return "Never dealt";
  const w = weightOf(prefs, id);
  return w === DEFAULT_WEIGHT ? "Normal" : `Weight ${w} of ${MAX_WEIGHT} · ${WEIGHT_LABELS[w - 1]}`;
}

/** Five weight pips (3 is the default) and a Ban toggle for one card. */
export function prefControl(app: App, id: string): HTMLElement {
  const prefs = app.store.state.settings.cardPrefs;
  const banned = isBanned(prefs, id);
  const w = weightOf(prefs, id);
  const set = (value: number | null) => app.store.dispatch({ type: "cardPref", id, value });
  return h("div.pref", { class: [banned ? "banned" : "", isTuned(prefs, id) ? "tuned" : ""].join(" ") },
    h("div.pref-pips", { role: "radiogroup", "aria-label": "How often it is dealt" }, WEIGHTS.map((v) => h("button", {
      type: "button", role: "radio", "aria-checked": String(!banned && v === w), class: !banned && v <= w ? "on" : "",
      title: `${v} — ${WEIGHT_LABELS[v - 1]}${v === DEFAULT_WEIGHT ? " (default)" : ""}`, onclick: () => set(v),
    }))),
    h("button.btn.ghost.pref-ban", { type: "button", "aria-pressed": String(banned), class: banned ? "on" : "",
      title: banned ? "Allow this card again" : "Never deal or pick this card", onclick: () => set(banned ? null : BANNED) },
      icon("ban"), banned ? "Banned" : "Ban"),
    h("span.pref-note.muted", null, prefSummary(app, id)),
    isTuned(prefs, id) && h("button.link", { type: "button", onclick: () => set(null) }, "Reset"));
}

/** A small marker for a card tile when it isn't at the default. */
export function prefBadge(app: App, id: string): Child {
  const prefs = app.store.state.settings.cardPrefs;
  if (!isTuned(prefs, id)) return null;
  const banned = isBanned(prefs, id);
  const w = weightOf(prefs, id);
  return h("span", { class: ["pref-badge", banned ? "banned" : w > DEFAULT_WEIGHT ? "high" : "low"], title: prefSummary(app, id) },
    banned ? icon("ban") : String(w));
}
