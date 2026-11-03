// Minimal DOM building helpers. Views are functions that return elements; the app re-renders a
// region when the state it depends on changes. `morph` applies a freshly built tree onto the live
// one, touching only what differs, so unchanged elements keep their identity, focus, scroll position
// and running CSS animations instead of being replaced (which replays every animation on them).

export type Child = Node | string | number | null | undefined | false | Child[];

type Handler<E extends Event = Event> = (e: E) => void;
export interface Props {
  class?: string | (string | false | null | undefined)[];
  style?: string;
  onclick?: Handler<MouseEvent>;
  oninput?: Handler<Event>;
  onchange?: Handler<Event>;
  onkeydown?: Handler<KeyboardEvent>;
  onmouseenter?: Handler<MouseEvent>;
  onmouseleave?: Handler<MouseEvent>;
  onfocus?: Handler<FocusEvent>;
  onblur?: Handler<FocusEvent>;
  [attr: string]: unknown;
}

/** h("button.btn.primary", { onclick }, "Deal") */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K | `${K}.${string}` | `${K}#${string}`, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const [name, ...classes] = tag.split(".");
  const [tagName, id] = name!.split("#");
  const el = document.createElement(tagName as K);
  if (id) el.id = id;
  if (classes.length) el.className = classes.join(" ");
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === "class") {
        const extra = Array.isArray(value) ? value.filter(Boolean).join(" ") : String(value);
        if (extra) el.className = el.className ? `${el.className} ${extra}` : extra;
      } else if (key.startsWith("on") && typeof value === "function") {
        setListener(el, key.slice(2), value as EventListener);
      } else if (key === "style") {
        el.setAttribute("style", String(value));
      } else if (value === true) {
        el.setAttribute(key, "");
      } else {
        el.setAttribute(key, String(value));
      }
    }
  }
  append(el, children);
  return el;
}

// Handlers live in a table the element's single listener per event type reads, so a morph can swap in
// the new tree's handlers (and their fresh closures) without re-binding anything.
const listeners = new WeakMap<Element, { fns: Map<string, EventListener>; attached: Set<string> }>();

function setListener(el: Element, type: string, fn: EventListener) {
  let entry = listeners.get(el);
  if (!entry) listeners.set(el, (entry = { fns: new Map(), attached: new Set() }));
  entry.fns.set(type, fn);
  if (!entry.attached.has(type)) {
    entry.attached.add(type);
    el.addEventListener(type, (e) => listeners.get(el)?.fns.get(type)?.(e));
  }
}

export function append(parent: Node, children: Child[]) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(parent, child);
    else parent.appendChild(typeof child === "object" ? child : document.createTextNode(String(child)));
  }
}

const keyOf = (n: Node): string | null => {
  if (!(n instanceof HTMLElement)) return null;
  const key = n.dataset.key ?? n.dataset.id ?? n.dataset.setKey ?? (n.id || null);
  return key === null ? null : `${n.tagName}:${key}`;
};
/** Two nodes are the same kind of thing when they have the same tag and static (first) class. */
const kindOf = (n: Node) => (n instanceof Element ? `${n.tagName}.${n.classList[0] ?? ""}` : "#text");

function patchChildren(parent: Node, next: Node[]) {
  const byKey = new Map<string, Node>();
  const loose: Node[] = [];
  for (const o of Array.from(parent.childNodes)) {
    const k = keyOf(o);
    if (k) byKey.set(k, o); else loose.push(o);
  }
  const result: Node[] = [];
  for (const n of next) {
    let match: Node | undefined;
    if (n.parentNode === parent) match = n; // already lives here (a persistent element handed back in)
    else {
      const k = keyOf(n);
      const candidate = k ? byKey.get(k) : loose.find((o) => kindOf(o) === kindOf(n));
      if (candidate && kindOf(candidate) === kindOf(n)) match = candidate;
    }
    if (match) {
      const k = keyOf(match);
      if (k && byKey.get(k) === match) byKey.delete(k);
      else if (loose.includes(match)) loose.splice(loose.indexOf(match), 1);
      if (match !== n) patchNode(match, n);
    }
    result.push(match ?? n);
  }
  for (const o of [...byKey.values(), ...loose]) parent.removeChild(o);
  let ref: Node | null = parent.firstChild;
  for (const node of result) {
    if (node === ref) ref = ref.nextSibling;
    else parent.insertBefore(node, ref);
  }
}

function patchNode(old: Node, next: Node) {
  if (!(old instanceof Element) || !(next instanceof Element)) {
    if (old.nodeValue !== next.nodeValue) old.nodeValue = next.nodeValue;
    return;
  }
  for (const attr of Array.from(old.attributes)) if (!next.hasAttribute(attr.name)) old.removeAttribute(attr.name);
  for (const attr of Array.from(next.attributes)) if (old.getAttribute(attr.name) !== attr.value) old.setAttribute(attr.name, attr.value);
  const mine = listeners.get(old);
  const theirs = listeners.get(next);
  for (const type of mine?.fns.keys() ?? []) if (!theirs?.fns.has(type)) mine!.fns.delete(type);
  for (const [type, fn] of theirs?.fns ?? []) setListener(old, type, fn);
  // Form state lives in properties, not attributes.
  if (old instanceof HTMLInputElement && next instanceof HTMLInputElement) {
    if (old.checked !== next.checked) old.checked = next.checked;
    if (old.value !== next.value && old !== document.activeElement) old.value = next.value;
  }
  patchChildren(old, Array.from(next.childNodes));
}

/** Like `replace`, but patches the live children into the new ones instead of swapping them out. */
export function morph(container: Element, ...children: Child[]) {
  const nodes: Node[] = [];
  const collect = (c: Child) => {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) c.forEach(collect);
    else nodes.push(typeof c === "object" ? c : document.createTextNode(String(c)));
  };
  children.forEach(collect);
  patchChildren(container, nodes);
}

/** Replaces a container's content, keeping the scroll position of marked scrollers. */
export function replace(container: Element, ...children: Child[]) {
  const scrolls = new Map<string, number>();
  for (const el of container.querySelectorAll<HTMLElement>("[data-scroll]")) scrolls.set(el.dataset.scroll!, el.scrollTop);
  container.replaceChildren();
  append(container, children);
  for (const el of container.querySelectorAll<HTMLElement>("[data-scroll]")) {
    const top = scrolls.get(el.dataset.scroll!);
    if (top) el.scrollTop = top;
  }
}

const ICONS: Record<string, string> = {
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-1.9"/>',
  swap: '<path d="M20 11a8 8 0 0 0-14.9-4M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.9 4M20 20v-4h-4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  tune: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>',
  deal: '<rect x="3" y="6" width="10" height="14" rx="1.5"/><path d="M15 4.5l4.6 1.6-4 11.9"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  qr: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h3v3M20 14v.01M14 20h3M20 17v3"/>',
  layers: '<path d="M12 4l9 5-9 5-9-5z"/><path d="M3 14l9 5 9-5"/>',
  triangle: '<path d="M8 5l10 7-10 7z" fill="currentColor"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
};

export function icon(name: keyof typeof ICONS | string, cls = ""): SVGSVGElement {
  const wrap = document.createElement("span");
  wrap.innerHTML = `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ""}</svg>`;
  return wrap.firstChild as SVGSVGElement;
}

/** A − value + control. */
export function stepper(opts: { value: number; min: number; max: number; label: string; format?: (n: number) => string; onChange: (n: number) => void }) {
  const { value, min, max, label, format = String, onChange } = opts;
  return h("div.stepper", { role: "group", "aria-label": label },
    h("button", { type: "button", "aria-label": `Fewer ${label}`, disabled: value <= min, onclick: () => onChange(Math.max(min, value - 1)) }, icon("minus")),
    h("output", { "aria-live": "polite" }, format(value)),
    h("button", { type: "button", "aria-label": `More ${label}`, disabled: value >= max, onclick: () => onChange(Math.min(max, value + 1)) }, icon("plus")));
}

/** Segmented single-choice control. */
export function segmented<T extends string | number | boolean>(opts: { value: T; options: { value: T; label: string; title?: string }[]; label: string; onChange: (v: T) => void; small?: boolean }) {
  return h("div.segmented", { role: "radiogroup", "aria-label": opts.label, class: opts.small ? "small" : "" },
    opts.options.map((o) => h("button", {
      type: "button", role: "radio", "aria-checked": String(o.value === opts.value), title: o.title,
      class: o.value === opts.value ? "on" : "", onclick: () => opts.onChange(o.value),
    }, o.label)));
}
