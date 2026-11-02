// Card interactions: rules-level things worth knowing when two cards meet. Two sources:
//
// - Detectors (below): patterns in the cards' mechanics, e.g. a card that replays others meeting
//   a Duration, or a cost reducer meeting a card that gains by cost. Each explains the rule.
// - Rulings (src/shared/mentions.ts): statements in one card's FAQ or rules that name the other.
//
// Detectors are deliberately general; the explanations say what happens, and link to the topic
// pages for the underlying rule.

import type { Card } from "./types";
import type { CardDb } from "./setup";
import { rulingsBetween, type MentionIndex, type Ruling } from "./mentions";

export interface Detected {
  /** Detector id, e.g. "replay-duration". */
  kind: string;
  /** Short label for the kind of interaction. */
  label: string;
  /** Explanation in the app's inline markup. */
  text: string;
  /** How notable it is, for ranking (higher first). */
  weight: number;
}

export interface Interaction {
  a: string;
  b: string;
  detected: Detected[];
  rulings: Ruling[];
  score: number;
}

// ---- Card groups (explicit lists where text patterns would be unreliable)

/** Cards that play another card more than once (or replay it). Value: what they can replay. */
const REPLAYERS: Record<string, { types: ("Action" | "Treasure")[]; durations: boolean }> = {
  "throne-room": { types: ["Action"], durations: true },
  "kings-court": { types: ["Action"], durations: true },
  "mastermind": { types: ["Action"], durations: true },
  "disciple": { types: ["Action"], durations: true },
  "citadel": { types: ["Action"], durations: true },
  "royal-carriage": { types: ["Action"], durations: true },
  "flagship": { types: ["Action"], durations: true },
  "daimyo": { types: ["Action"], durations: true },
  "practice": { types: ["Action"], durations: true },
  "ghost": { types: ["Action"], durations: true },
  "scepter": { types: ["Action"], durations: true },
  "procession": { types: ["Action"], durations: false },
  "royal-galley": { types: ["Action"], durations: false },
  "crown": { types: ["Action", "Treasure"], durations: true },
  "coronet": { types: ["Action", "Treasure"], durations: true },
  "specialist": { types: ["Action", "Treasure"], durations: true },
  "tiara": { types: ["Treasure"], durations: true },
  "kings-cache": { types: ["Treasure"], durations: true },
  "counterfeit": { types: ["Treasure"], durations: false },
};

/**
 * Cards that play another card while leaving it where it is (Supply, trash, set aside). Way of the
 * Mouse and Riverboat also do, but only ever with their one set-aside card, chosen in setup.
 */
const LEAVE_IN_PLACE = new Set(["band-of-misfits", "overlord", "captain", "prince", "necromancer", "inheritance"]);

/** Cards that make every card cheaper for a turn (or for the game). */
const COST_REDUCERS = new Set(["bridge", "bridge-troll", "canal", "highway", "inventor", "princess", "renown", "quarry", "ferry",
  "family-of-inventors", "flourishing-trade"]);

/** Cards with an ability when discarded other than in Clean-up. */
const ON_DISCARD = new Set(["tunnel", "weaver", "village-green", "faithful-hound", "trail"]);

/** Cards that reward trashing any of your cards. */
const TRASH_PAYOFF = new Set(["market-square", "sewers", "priest", "tomb"]);

/** Cards that let you play an Action (or Treasure) as soon as you gain it. */
const PLAY_ON_GAIN: Record<string, "Action" | "Treasure" | "Duration"> = {
  "innovation": "Action", "city-state": "Action", "rush": "Action", "continue": "Action", "sailor": "Duration", "mining-road": "Treasure",
};

/** Cards that care about buying a card (not Events). */
const ON_BUY = new Set(["goons", "haggler", "talisman", "hoard", "haunted-woods", "swamp-hag"]);

/** Cards that gain cards onto your deck, overriding where a card would normally be gained. */
const GAIN_TO_DECK = new Set(["armory", "artificer", "develop", "graverobber", "progress"]);

// ---- Text helpers

const main = (c: Card) => c.text.replace(/\n/g, " ");
const full = (c: Card) => `${c.text} ${c.text2 ?? ""}`.replace(/\n/g, " ");
const is = (c: Card, type: string) => c.types.includes(type);
const ref = (c: Card) => `{card:${c.name}}`;

/** Moves itself away when played (one-shots, Reserves, cards that set themselves aside ...). */
const movesItself = (c: Card) => (is(c, "Action") || is(c, "Treasure"))
  && (is(c, "Reserve") || /\b(Trash this|trash this|Return this to its pile|return this to its pile|Exile this|[Ss]et this aside|[Pp]ut this onto your deck|[Pp]ut this on the bottom)/.test(main(c)));
const triggersOnTrash = (c: Card) => /When you (gain or )?trash this/.test(full(c));
const trashesFromHand = (c: Card) => /[Tt]rash (a|an|up to|any number|from|\d|this or)[^.]*from your hand|[Tt]rash a card/.test(main(c));
const gainsByCost = (c: Card) => /costing (up to|exactly|less)|cheaper|costing \{cost/.test(main(c)) && /\b[Gg]ain/.test(main(c));
const makesDiscard = (c: Card) => /\b[Dd]iscard(s)?\b(?! pile)/.test(main(c));
const reactsToAttack = (c: Card) => /when another player plays an Attack/i.test(full(c)) || /it doesn.t affect you/.test(full(c));
const gainedToHand = (c: Card) => /gained to your hand/.test(full(c));
const playsFromHand = (c: Card) => /[Pp]lay an? [^.]*from your hand/.test(main(c));

type Detector = (a: Card, b: Card) => Omit<Detected, "kind"> | null;

const DETECTORS: Record<string, Detector> = {
  "replay-duration": (a, b) => {
    const r = REPLAYERS[a.id];
    if (!r || !r.durations || !is(b, "Duration") || !r.types.some((t) => is(b, t))) return null;
    // An Event is never in play, so there is nothing of it to stay there.
    const stays = is(a, "Event") ? "" : `, and ${ref(a)} stays in play as long as ${ref(b)} does`;
    return { label: "Replaying a Duration", weight: 6,
      text: `When ${ref(a)} plays ${ref(b)} more than once, ${ref(b)}'s next-turn effects happen once for each play${stays}. See {rule:durations}.` };
  },
  "replay-mover": (a, b) => {
    const r = REPLAYERS[a.id];
    if (!r || !movesItself(b) || !r.types.some((t) => is(b, t))) return null;
    return { label: "Replaying a card that moves itself", weight: 5,
      text: `If ${ref(a)} plays ${ref(b)} again after it has moved itself away, the second play still happens, but ${ref(b)} can't move itself again, and anything that depends on that move ("if you do") fails. See {rule:stop-moving-rule}.` };
  },
  "leave-in-place": (a, b) => {
    if (!LEAVE_IN_PLACE.has(a.id) || !is(b, "Action") || is(b, "Duration") || is(b, "Command")) return null;
    if (!movesItself(b) && !/while this is in play|[Tt]his turn, when/.test(full(b))) return null;
    return { label: "Played where it is", weight: 5,
      text: `${ref(a)} plays ${ref(b)} without moving it, so ${ref(b)} can't move itself (to the trash, its pile, a mat ...), and "while this is in play" text doesn't apply. See {rule:stop-moving-rule}.` };
  },
  "way-mover": (a, b) => {
    if (!is(a, "Way") || !is(b, "Action")) return null;
    if (is(b, "Duration")) {
      return { label: "A Way on a Duration", weight: 2,
        text: `Using ${ref(a)} for ${ref(b)} replaces all of ${ref(b)}'s instructions, including its next-turn ones, so ${ref(b)} is discarded in this turn's Clean-up. See {rule:events-and-landscapes}.` };
    }
    if (!movesItself(b)) return null;
    return { label: "A Way on a card that moves itself", weight: 3,
      text: `Using ${ref(a)} for ${ref(b)} replaces ${ref(b)}'s instructions, so it doesn't move itself and simply stays in play. See {rule:events-and-landscapes}.` };
  },
  "discard-trigger": (a, b) => {
    if (!ON_DISCARD.has(b.id) || a.id === b.id || !makesDiscard(a) || ON_DISCARD.has(a.id)) return null;
    const attack = is(a, "Attack") && /each other player/i.test(main(a));
    return { label: "Discarding triggers an ability", weight: attack ? 4 : 5,
      text: attack
        ? `When ${ref(a)} makes another player discard ${ref(b)}, ${ref(b)}'s "when you discard this" ability triggers for them.`
        : `Discarding ${ref(b)} to ${ref(a)} triggers ${ref(b)}'s "when you discard this" ability. Discarding in Clean-up doesn't.` };
  },
  "trash-trigger": (a, b) => {
    if (a.id === b.id || !trashesFromHand(a)) return null;
    if (triggersOnTrash(b)) {
      return { label: "Trashing triggers an ability", weight: 5,
        text: `Trashing ${ref(b)} with ${ref(a)} triggers ${ref(b)}'s "when you trash this" ability, and it still counts as trashed for ${ref(a)}.` };
    }
    if (TRASH_PAYOFF.has(b.id) && !TRASH_PAYOFF.has(a.id)) {
      return { label: "Rewards for trashing", weight: 3, text: `Each card ${ref(a)} trashes also counts for ${ref(b)}.` };
    }
    return null;
  },
  "gain-location": (a, b) => {
    if (!GAIN_TO_DECK.has(a.id) || !gainedToHand(b)) return null;
    return { label: "Where gained cards go", weight: 5,
      text: `A ${ref(b)} gained with ${ref(a)} goes onto your deck: ${ref(a)}'s instruction overrides "this is gained to your hand".` };
  },
  "cost-reduction": (a, b) => {
    if (!COST_REDUCERS.has(a.id) || a.id === b.id || !gainsByCost(b)) return null;
    return { label: "Lower costs", weight: 3,
      text: `While ${ref(a)} is lowering costs, ${ref(b)} compares against the lowered costs: "up to" reaches pricier cards, and "exactly" or "cheaper" may point at different ones. See {rule:costs-and-debt}.` };
  },
  "play-on-gain": (a, b) => {
    const what = PLAY_ON_GAIN[a.id];
    if (!what || a.id === b.id || !(is(b, "Action") || is(b, "Treasure")) || !/\b[Gg]ain (a|an|\d|two)\b/.test(main(b))) return null;
    return { label: "Play gained cards at once", weight: 3,
      text: `${ref(a)} lets you play a gained ${what} card right away, including ones ${ref(b)} gains.` };
  },
  "events-not-buys": (a, b) => {
    if (!ON_BUY.has(a.id) || !is(b, "Event")) return null;
    return { label: "Buying an Event isn't buying a card", weight: 3,
      text: `Buying ${ref(b)} doesn't trigger ${ref(a)}: an Event is bought, but it isn't a card, and nothing is gained from it unless it says so.` };
  },
  "attack-reaction": (a, b) => {
    if (!is(a, "Attack") || !reactsToAttack(b) || a.id === b.id) return null;
    return { label: "Answering an Attack", weight: 1,
      text: `Players can use ${ref(b)} against ${ref(a)}; Reactions are used when the Attack is played, before it does anything. See {rule:attacks-and-reactions}.` };
  },
  "patron-reveal": (a, b) => {
    if (b.id !== "patron" || a.id === "patron" || !/\b[Rr]eveal/.test(main(a))) return null;
    return { label: "Revealing Patron", weight: 3, text: `When ${ref(a)} makes you reveal {card:Patron} during an Action phase, you get +1 Coffers.` };
  },
  "shadow-play": (a, b) => {
    if (!is(b, "Shadow") || !playsFromHand(a) || !REPLAYERS[a.id] && !/Action/.test(main(a))) return null;
    return { label: "Shadows play from your deck", weight: 3,
      text: `When ${ref(a)} lets you play an Action from your hand, you may play ${ref(b)} from your deck instead. See {rule:shadows-and-omens}.` };
  },
  "capitalism": (a, b) => {
    if (a.id !== "capitalism" || !is(b, "Action") || !/\{coin:\+/.test(full(b))) return null;
    return { label: "Actions become Treasures", weight: 2,
      text: `With {card:Capitalism}, ${ref(b)} is also a Treasure on your turns: you can play it in your Buy phase, and Treasure effects apply to it.` };
  },
};

/** Detector results for a pair, in both directions. */
export function detect(db: CardDb, a: string, b: string): Detected[] {
  if (a === b) return [];
  const ca = db.get(a), cb = db.get(b);
  const out: Detected[] = [];
  for (const [kind, fn] of Object.entries(DETECTORS)) {
    for (const [x, y] of [[ca, cb], [cb, ca]] as const) {
      const d = fn(x, y);
      if (d) out.push({ kind, ...d });
    }
  }
  return out.sort((p, q) => q.weight - p.weight);
}

export function interactionBetween(db: CardDb, mentions: MentionIndex | null, a: string, b: string): Interaction {
  const detected = detect(db, a, b);
  const rulings = mentions ? rulingsBetween(mentions, a, b) : [];
  const score = detected.reduce((s, d) => s + d.weight, 0) + rulings.length * 4;
  return { a, b, detected, rulings, score };
}

/** Every interacting pair among the given cards, most notable first. */
export function interactionsAmong(db: CardDb, mentions: MentionIndex | null, ids: string[]): Interaction[] {
  const uniq = [...new Set(ids)].filter((id) => db.byId.has(id));
  const out: Interaction[] = [];
  for (let i = 0; i < uniq.length; i++) {
    for (let j = i + 1; j < uniq.length; j++) {
      const x = interactionBetween(db, mentions, uniq[i]!, uniq[j]!);
      if (x.score > 0) out.push(x);
    }
  }
  return out.sort((p, q) => q.score - p.score || p.a.localeCompare(q.a));
}

/** Cards that interact with one card, from a candidate list, most notable first. */
export function interactionsWith(db: CardDb, mentions: MentionIndex | null, id: string, candidates: Iterable<string>): Interaction[] {
  const out: Interaction[] = [];
  for (const other of candidates) {
    if (other === id || !db.byId.has(other)) continue;
    const x = interactionBetween(db, mentions, id, other);
    if (x.score > 0) out.push(x);
  }
  return out.sort((p, q) => q.score - p.score || p.b.localeCompare(q.b));
}
