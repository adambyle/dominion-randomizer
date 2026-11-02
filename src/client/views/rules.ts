// Rules reference: the app's own topic pages (data/rules/topics), and the renderer for guide
// documents shared with the card sheet.

import { h, icon, type Child } from "../dom";
import { markup } from "../markup";
import { topic, topics } from "../guide";
import type { GuideDoc, GuideItem } from "../../shared/guide";
import type { App } from "../main";

/** Renders a guide document. Sections get `headingTag` headings (h2 on pages, h4 in the card sheet). */
export function guideBody(app: App, doc: GuideDoc, open?: (id: string) => void, headingTag: "h2" | "h4" = "h2", prose = false): Child[] {
  return doc.sections.map((s) => h("div.guide-section", null,
    s.heading && h(headingTag, null, ...app.markup(s.heading, open)),
    s.blocks.map((b) => b.kind === "p" ? h("p", null, ...app.markup(b.text, open))
      : prose ? guideProse(app, b.items, open) : guideList(app, b.items, open))));
}

/** A list as running paragraphs (one per top-level item, its sub-points following in the same paragraph), without the "Official" tags. */
function guideProse(app: App, items: GuideItem[], open?: (id: string) => void): Child[] {
  const flat = (it: GuideItem): string[] => [it.text, ...(it.children ?? []).flatMap(flat)];
  return items.map((it) => h("p", null, ...app.markup(flat(it).join(" "), open)));
}

function guideList(app: App, items: GuideItem[], open?: (id: string) => void): HTMLElement {
  return h("ul.faq.guide", null, items.map((it) => h("li", { class: it.official ? "official" : "" },
    ...app.markup(it.text, open),
    it.official && h("span.official-tag", { title: "Restates an official ruling (rulebook or official FAQ)" }, "Official"),
    it.children && guideList(app, it.children, open))));
}

export function officialNote(): Child {
  return h("p.guide-legend", null, h("span.official-tag", null, "Official"),
    " restates a ruling from the rulebooks or official FAQ. Everything else is this app's own explanation.");
}

export function rulesView(app: App, id: string | null): Child {
  const t = id ? topic(id) : null;
  if (t) {
    const related = (t.doc.meta.related ?? "").split(",").map((s) => topic(s.trim())).filter((x) => !!x);
    return h("div.page.rules-page", null,
      h("p.crumbs", null, h("a", { href: "#/rules" }, icon("back"), "Rules reference")),
      h("h1", null, t.title),
      t.summary && h("p.lede", null, ...app.markup(t.summary)),
      officialNote(),
      h("article.guide-doc", null, guideBody(app, t.doc)),
      related.length > 0 && h("section.related", null, h("h2", null, "See also"),
        h("ul.topic-links", null, related.map((r) => h("li", null, h("a", { href: `#/rules/${r.id}` }, r.title))))));
  }

  const groups = new Map<string, typeof topics>();
  for (const tp of topics) groups.set(tp.group, [...(groups.get(tp.group) ?? []), tp]);
  return h("div.page.rules-page", null,
    h("h1", null, "Rules reference"),
    h("p.lede", null, "General rules, written for this app. Each card's own rulings are in its card sheet — open any card from the ",
      h("a", { href: "#/cards" }, "Cards"), " page."),
    id && h("p.notice", null, `There's no rules page called “${id}”.`),
    [...groups].map(([group, list]) => h("section.topic-group", null,
      h("h2", null, group),
      h("ul.topic-index", null, list.map((tp) => h("li", null,
        h("a", { href: `#/rules/${tp.id}` }, h("b", null, tp.title), tp.summary && h("span.muted", null, ...markup(tp.summary)))))))));
}
