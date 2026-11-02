// The setup engine: given the chosen Kingdom piles and landscapes, works out everything else the
// game needs (extra piles, decks, tokens, starting-deck changes) and records *why* each is needed.
//
// Rules follow the wiki's Setup page: setup instructions apply to every card used in the game,
// including ones outside the Supply (Black Market deck, Ferryman's pile, Riverboat's card ...), and
// selections that depend on the final Supply (Obelisk, Traits) happen last.

import type { Card, CardData } from "./types";
import { pick, shuffle, type Rng } from "./random";

export interface Choices {
  bane?: string;
  ferryman?: string;
  riverboat?: string;
  wayOfTheMouse?: string;
  approachingArmy?: string;
  obelisk?: string;
  /** Trait id -> Kingdom pile id. */
  traits?: Record<string, string>;
  druidBoons?: string[];
  ally?: string;
  prophecy?: string;
  blackMarket?: string[];
}

export type AutoBool = boolean | "auto";

export interface SetupInput {
  /** Kingdom piles in the order they were picked (the order matters for Colony/Shelters "auto"). */
  kingdom: string[];
  landscapes: string[];
  players: number;
  platinumColony: AutoBool;
  shelters: AutoBool;
  /** Choices already made (by a recommended kingdom, the user, or an earlier roll). Missing ones are rolled. */
  choices?: Choices;
  /**
   * The choices come from an official source (a recommended kingdom), so use them as printed even
   * where they break a card's usual requirement (e.g. Farrier as Ferryman's pile in Bounty of the Hunt).
   */
  acceptChoices?: boolean;
  blackMarketSize?: number;
}

export interface Reason {
  /** The card that causes this, or null for a general rule. */
  by: string | null;
  text: string;
}

export interface PileMember { id: string; count: number }

export interface Pile {
  id: string;
  count: number;
  reasons: Reason[];
  /** For split piles: composition in order, top first. */
  members?: PileMember[];
  shuffled?: boolean;
}

export interface Component {
  /** Card id, or a token/mat name for tokens. */
  id: string;
  label?: string;
  reasons: Reason[];
}

export interface SetupResult {
  kingdom: Pile[];
  /** Extra Supply piles that are Kingdom piles but weren't picked (Bane, Approaching Army's pile). */
  extraKingdom: Pile[];
  basic: Pile[];
  nonSupply: Pile[];
  landscapes: Component[];
  /** Boons/Hexes decks, with the cards they contain. */
  decks: { id: "boons" | "hexes"; cards: string[]; reasons: Reason[] }[];
  /** States and Artifacts. */
  statuses: Component[];
  /** Cards set aside for a card's ability (Druid's Boons, Riverboat's card, Ferryman's pile, Black Market deck). */
  setAside: { id: string; cards: string[]; reasons: Reason[] }[];
  /** Trait/Obelisk targets: landscape id -> pile id. */
  targets: Record<string, string>;
  tokens: Component[];
  startingDeck: { cards: PileMember[]; reasons: Reason[] };
  playerStart: { coffers: number; favors: number; reasons: Reason[] };
  trash: PileMember[];
  platinumColony: { used: boolean; reason: Reason };
  shelters: { used: boolean; reason: Reason };
  /** Setup notes for cards in the game (the wiki's wording). */
  notes: Reason[];
  /** The complete set of choices, so the same setup can be rebuilt without re-rolling. */
  choices: Choices;
  warnings: string[];
}

export interface CardDb {
  data: CardData;
  byId: Map<string, Card>;
  get(id: string): Card;
}

export function createDb(data: CardData): CardDb {
  const byId = new Map(data.cards.map((c) => [c.id, c]));
  return {
    data,
    byId,
    get(id) {
      const c = byId.get(id);
      if (!c) throw new Error(`Unknown card: ${id}`);
      return c;
    },
  };
}

// ---------------------------------------------------------------------------
// Static rule tables

const HEIRLOOMS: Record<string, string> = {
  cemetery: "haunted-mirror",
  fool: "lucky-coin",
  pixie: "goat",
  pooka: "cursed-gold",
  "secret-cave": "magic-lamp",
  shepherd: "pasture",
  tracker: "pouch",
};

/** Non-Supply cards, States and Artifacts found by name in card text. Groups are handled separately. */
const NAMED_COMPONENTS: { id: string; pattern: RegExp }[] = [
  { id: "spoils", pattern: /\bSpoils\b/ },
  { id: "madman", pattern: /\bMadman\b/ },
  { id: "mercenary", pattern: /\bMercenary\b/ },
  { id: "horse", pattern: /\bHorses?\b/ },
  { id: "wish", pattern: /\bWish(es)?\b/ },
  { id: "bat", pattern: /\bBats?\b/ },
  { id: "imp", pattern: /\bImps?\b/ },
  { id: "ghost", pattern: /\bGhosts?\b(?! Town)/ },
  { id: "will-o-wisp", pattern: /\bWill-o['’]-Wisps?\b/ },
  { id: "treasure-hunter", pattern: /\bTreasure Hunter\b/ },
  { id: "warrior", pattern: /\bWarrior\b/ },
  { id: "hero", pattern: /\bHero\b/ },
  { id: "champion", pattern: /\bChampion\b/ },
  { id: "soldier", pattern: /\bSoldier\b/ },
  { id: "fugitive", pattern: /\bFugitive\b/ },
  { id: "disciple", pattern: /\bDisciple\b/ },
  { id: "teacher", pattern: /\bTeacher\b/ },
  { id: "deluded", pattern: /\bDeluded\b/ },
  { id: "envious", pattern: /\bEnvious\b/ },
  { id: "miserable", pattern: /\bMiserable\b/ },
  { id: "twice-miserable", pattern: /\bTwice Miserable\b/ },
  { id: "lost-in-the-woods", pattern: /\bLost in the Woods\b/ },
  { id: "flag", pattern: /\bthe Flag\b/ },
  { id: "horn", pattern: /\bthe Horn\b/ },
  { id: "key", pattern: /\bthe Key\b/ },
  { id: "lantern", pattern: /\bthe Lantern\b/ },
  { id: "treasure-chest", pattern: /\bTreasure Chest\b/ },
];

/** Tokens and mats found from card text. */
const TOKEN_RULES: { id: string; label: string; pattern: RegExp; types?: string[] }[] = [
  { id: "coffers", label: "Coffers (coin tokens + Coffers mat)", pattern: /\bCoffers\b/ },
  { id: "villagers", label: "Villagers (coin tokens + Villagers mat)", pattern: /\bVillagers?\b/ },
  { id: "favors", label: "Favor tokens", pattern: /\bFavors?\b/ },
  { id: "debt", label: "Debt tokens", pattern: /\{debt:/ },
  { id: "vp", label: "Victory tokens", pattern: /\{vp:\+|\b(?:take|move|put|add)s? \{vp:/i, types: ["Gathering"] },
  { id: "exile", label: "Exile mat", pattern: /\bExile/ },
  { id: "tavern", label: "Tavern mat", pattern: /\bTavern mat\b/, types: ["Reserve"] },
  { id: "native-village-mat", label: "Native Village mat", pattern: /\bNative Village mat\b/ },
  { id: "island-mat", label: "Island mat", pattern: /\bIsland mat\b/ },
  { id: "pirate-ship-mat", label: "Pirate Ship mat + coin tokens", pattern: /\bPirate Ship mat\b/ },
  { id: "trade-route-mat", label: "Trade Route mat + coin tokens", pattern: /\bTrade Route mat\b/ },
  { id: "embargo", label: "Embargo tokens", pattern: /\bEmbargo token/ },
  { id: "coin-tokens", label: "Coin tokens (as markers)", pattern: /\badd a token here\b|\bCoin token\b/ },
  { id: "plus-card-token", label: "+1 Card token", pattern: /\+1 Card(?:, \+1 Action, \+1 Buy, or \{coin:\+1\})? token/ },
  { id: "plus-action-token", label: "+1 Action token", pattern: /\+1 Action(?:, \+1 Buy, or \{coin:\+1\})? token/ },
  { id: "plus-buy-token", label: "+1 Buy token", pattern: /\+1 Buy(?:, or \{coin:\+1\})? token/ },
  { id: "plus-coin-token", label: "+$1 token", pattern: /\{coin:\+1\} token/ },
  { id: "minus-card-token", label: "−1 Card token", pattern: /[–−-]1 Card token/ },
  { id: "minus-coin-token", label: "−$1 token", pattern: /[–−-]\{cost:1\} token/ },
  { id: "minus-cost-token", label: "−$2 cost token", pattern: /[–−-]\{cost:2\} cost token/ },
  { id: "trashing-token", label: "Trashing token", pattern: /\bTrashing token/ },
  { id: "estate-token", label: "Estate token", pattern: /\bEstate token/ },
  { id: "journey-token", label: "Journey token", pattern: /\bJourney token/ },
];

const SUN_TOKENS: Record<number, number> = { 2: 5, 3: 8, 4: 10, 5: 12, 6: 13 };

// ---------------------------------------------------------------------------

const costIs = (c: Card, ...coins: number[]) =>
  !!c.cost && coins.includes(c.cost.coin) && !c.cost.debt && !c.cost.potion;
const isAction = (c: Card) => c.types.includes("Action");

export function resolveSetup(input: SetupInput, db: CardDb, pool: ReadonlySet<string>, rng: Rng): SetupResult {
  const players = Math.min(6, Math.max(2, input.players));
  const given = input.choices ?? {};
  const choices: Choices = {};
  const warnings: string[] = [];
  const card = (id: string) => db.get(id);
  const name = (id: string) => db.byId.get(id)?.name ?? id;

  const result: SetupResult = {
    kingdom: [], extraKingdom: [], basic: [], nonSupply: [], landscapes: [], decks: [], statuses: [],
    setAside: [], targets: {}, tokens: [], startingDeck: { cards: [], reasons: [] },
    playerStart: { coffers: 0, favors: 0, reasons: [] }, trash: [],
    platinumColony: { used: false, reason: { by: null, text: "" } },
    shelters: { used: false, reason: { by: null, text: "" } },
    notes: [], choices, warnings,
  };

  // Every card whose rules are "in use" this game, with the reason it is.
  const inUse = new Map<string, Reason[]>();
  const queue: string[] = [];
  const use = (id: string, reason: Reason) => {
    const existing = inUse.get(id);
    if (existing) {
      if (!existing.some((r) => r.by === reason.by && r.text === reason.text)) existing.push(reason);
      return;
    }
    inUse.set(id, [reason]);
    queue.push(id);
  };

  const supplyKingdom = new Set<string>(input.kingdom);
  const usedPiles = new Set<string>([...input.kingdom]); // piles that are not "unused"
  const unusedKingdom = (filter: (c: Card) => boolean) =>
    [...pool].filter((id) => {
      const c = db.byId.get(id);
      return !!c && c.kind === "kingdom" && !usedPiles.has(id) && filter(c);
    });
  /** Single cards (not piles) for Riverboat / Way of the Mouse: pile members count individually. */
  const unusedCards = (filter: (c: Card) => boolean) =>
    db.data.cards.filter((c) => {
      const pileId = c.kind === "pileMember" ? c.pileId! : c.id;
      if (c.kind !== "kingdom" && c.kind !== "pileMember") return false;
      if (c.pile) return false;
      return pool.has(pileId) && !usedPiles.has(pileId) && filter(c);
    }).map((c) => c.id);

  /**
   * Uses the given choice if it's still eligible (or the choices are official), otherwise picks
   * randomly. Choices carry over between edits, so one that stopped fitting — say, the Bane was
   * added to the Kingdom — is quietly re-picked.
   */
  const choose = (key: string, givenId: string | undefined, candidates: string[]): string | undefined => {
    if (givenId && (candidates.includes(givenId) || (input.acceptChoices && db.byId.has(givenId)))) return givenId;
    const chosen = pick(rng, candidates);
    if (!chosen) warnings.push(`No eligible card for ${key}.`);
    return chosen;
  };

  for (const id of input.kingdom) use(id, { by: null, text: "Kingdom pile" });
  for (const id of input.landscapes) use(id, { by: null, text: "Landscape" });

  const triggered = new Set<string>();
  const once = (key: string) => (triggered.has(key) ? false : (triggered.add(key), true));
  const fateCards: string[] = [];

  const addNonSupply = (id: string, reason: Reason, extra?: Partial<Pile>) => {
    const existing = result.nonSupply.find((p) => p.id === id);
    if (existing) { existing.reasons.push(reason); return; }
    const c = card(id);
    result.nonSupply.push({ id, count: c.quantity ?? 1, reasons: [reason], ...extra });
    use(id, reason);
  };
  const addToken = (id: string, label: string, reason: Reason) => {
    const existing = result.tokens.find((t) => t.id === id);
    if (existing) { if (!existing.reasons.some((r) => r.by === reason.by)) existing.reasons.push(reason); return; }
    result.tokens.push({ id, label, reasons: [reason] });
  };
  const addStatus = (id: string, reason: Reason) => {
    const existing = result.statuses.find((s) => s.id === id);
    if (existing) { if (!existing.reasons.some((r) => r.by === reason.by)) existing.reasons.push(reason); return; }
    result.statuses.push({ id, reasons: [reason] });
    use(id, reason);
  };
  const addExtraKingdom = (id: string, reason: Reason) => {
    usedPiles.add(id);
    supplyKingdom.add(id);
    result.extraKingdom.push({ id, count: 0, reasons: [reason] });
    use(id, reason);
  };

  while (queue.length) {
    const id = queue.shift()!;
    const c = card(id);
    const by = id;
    const texts = [c.text, c.text2 ?? "", ...(c.pile?.members ?? []).flatMap((m) => [card(m).text, card(m).text2 ?? ""])].join("\n");
    const types = new Set([c.types, ...(c.pile?.members ?? []).map((m) => card(m).types)].flat());

    const note = db.data.setupNotes[id];
    if (note) result.notes.push({ by, text: note });

    // Components named in the text.
    for (const comp of NAMED_COMPONENTS) {
      if (comp.id === id || !comp.pattern.test(texts)) continue;
      const target = db.byId.get(comp.id);
      if (!target) continue;
      const reason = { by, text: `refers to ${target.name}` };
      if (target.kind === "status") addStatus(comp.id, reason);
      else addNonSupply(comp.id, reason);
    }
    for (const t of TOKEN_RULES) {
      if (t.pattern.test(texts) || t.types?.some((ty) => types.has(ty))) addToken(t.id, t.label, { by, text: `uses these` });
    }
    if (c.cost?.debt) addToken("debt", "Debt tokens", { by, text: `costs Debt` });
    if (c.types.includes("Project")) addToken("cubes", "Player cubes (Projects)", { by, text: "Projects are bought with cubes" });

    // Potion.
    if (c.cost?.potion || c.pile?.members.some((m) => card(m).cost?.potion)) {
      if (once("potion")) result.basic.push({ id: "potion", count: 16, reasons: [] });
      result.basic.find((p) => p.id === "potion")!.reasons.push({ by, text: `costs a Potion` });
    }

    // Groups.
    if (types.has("Looter")) {
      if (once("ruins")) {
        result.basic.push({
          id: "ruins", count: 10 * (players - 1), reasons: [], shuffled: true,
          members: db.data.cards.filter((x) => x.types.includes("Ruins")).map((x) => ({ id: x.id, count: 10 })),
        });
      }
      result.basic.find((p) => p.id === "ruins")!.reasons.push({ by, text: `is a Looter` });
    }
    if (/\bLoot\b/.test(texts) && !types.has("Loot")) {
      if (once("loot")) {
        const loot = db.data.cards.filter((x) => x.types.includes("Loot"));
        result.nonSupply.push({ id: "loot", count: loot.reduce((n, x) => n + (x.quantity ?? 1), 0), reasons: [],
          shuffled: true, members: loot.map((x) => ({ id: x.id, count: x.quantity ?? 1 })) });
        for (const x of loot) use(x.id, { by, text: "Loot pile" });
      }
      result.nonSupply.find((p) => p.id === "loot")!.reasons.push({ by, text: `gains Loot` });
    }
    if (/\bSpirit piles?\b/.test(texts)) {
      for (const s of ["will-o-wisp", "imp", "ghost"]) addNonSupply(s, { by, text: `gains from the Spirit piles` });
    }
    for (const [type, cardName] of [["Prize", "Tournament"], ["Reward", "Joust"]] as const) {
      if (c.name !== cardName) continue;
      for (const x of db.data.cards.filter((x) => x.types.includes(type))) {
        addNonSupply(x.id, { by, text: `uses ${type}s` });
      }
    }
    if (HEIRLOOMS[id]) {
      const h = HEIRLOOMS[id]!;
      result.startingDeck.cards.push({ id: h, count: 1 });
      result.startingDeck.reasons.push({ by, text: `Each player replaces a Copper with ${name(h)}` });
      use(h, { by, text: `Heirloom` });
    }
    if (id === "necromancer") {
      for (const z of db.data.cards.filter((x) => x.types.includes("Zombie"))) {
        result.trash.push({ id: z.id, count: 1 });
        use(z.id, { by, text: "Necromancer puts the Zombies in the trash" });
      }
    }
    if (id === "baker") {
      result.playerStart.coffers += 1;
      result.playerStart.reasons.push({ by, text: "Each player starts with +1 Coffers" });
    }
    if (types.has("Liaison") && once("ally")) {
      const allies = [...pool].filter((x) => db.byId.get(x)?.types.includes("Ally"));
      const ally = choose("the Ally", given.ally, allies);
      if (ally) {
        choices.ally = ally;
        result.landscapes.push({ id: ally, reasons: [{ by, text: `is a Liaison` }] });
        use(ally, { by, text: "Ally for Liaisons" });
      }
      result.playerStart.favors += 1;
      result.playerStart.reasons.push({ by, text: "Each player starts with 1 Favor (Liaisons)" });
    }
    if (id === "importer") {
      result.playerStart.favors += 4;
      result.playerStart.reasons.push({ by, text: "Importer: each player gets +4 Favors" });
    }
    if (types.has("Omen") && once("prophecy")) {
      const prophecies = [...pool].filter((x) => db.byId.get(x)?.types.includes("Prophecy"));
      const prophecy = choose("the Prophecy", given.prophecy, prophecies);
      if (prophecy) {
        choices.prophecy = prophecy;
        result.landscapes.push({ id: prophecy, reasons: [{ by, text: `is an Omen` }] });
        use(prophecy, { by, text: "Prophecy for Omens" });
      }
      addToken("sun", `Sun tokens (${SUN_TOKENS[players]} on the Prophecy)`, { by, text: "Omens remove Sun tokens" });
    }
    if (types.has("Fate") && !fateCards.includes(id)) fateCards.push(id);
    if (types.has("Doom") && once("hexes")) {
      const hexes = db.data.cards.filter((x) => x.types.includes("Hex")).map((x) => x.id);
      result.decks.push({ id: "hexes", cards: hexes, reasons: [{ by, text: `is a Doom card` }] });
      for (const h of hexes) use(h, { by: id, text: "In the Hexes deck" });
    } else if (types.has("Doom")) {
      result.decks.find((d) => d.id === "hexes")!.reasons.push({ by, text: `is a Doom card` });
    }

    // Cards whose setup picks something.
    if (id === "young-witch" && once("bane")) {
      const bane = choose("the Bane", given.bane, unusedKingdom((k) => costIs(k, 2, 3)));
      if (bane) { choices.bane = bane; addExtraKingdom(bane, { by, text: "Bane for Young Witch (costs $2 or $3)" }); }
    }
    if (id === "approaching-army" && once("approaching-army")) {
      const pile = choose("Approaching Army", given.approachingArmy, unusedKingdom((k) => k.types.includes("Attack")));
      if (pile) { choices.approachingArmy = pile; addExtraKingdom(pile, { by, text: "Approaching Army adds an Attack pile" }); }
    }
    if (id === "ferryman" && once("ferryman")) {
      const pile = choose("Ferryman", given.ferryman, unusedKingdom((k) => costIs(k, 3, 4)));
      if (pile) {
        choices.ferryman = pile;
        usedPiles.add(pile);
        result.setAside.push({ id: "ferryman", cards: [pile], reasons: [{ by, text: "Gain one when you gain a Ferryman" }] });
        use(pile, { by, text: "Ferryman's pile" });
      }
    }
    if (id === "riverboat" && once("riverboat")) {
      const pickId = choose("Riverboat", given.riverboat, unusedCards((k) => isAction(k) && !k.types.includes("Duration") && costIs(k, 5)));
      if (pickId) {
        choices.riverboat = pickId;
        usedPiles.add(card(pickId).pileId ?? pickId);
        result.setAside.push({ id: "riverboat", cards: [pickId], reasons: [{ by, text: "Played when you play a Riverboat" }] });
        use(pickId, { by, text: "Set aside for Riverboat" });
      }
    }
    if (id === "way-of-the-mouse" && once("mouse")) {
      const pickId = choose("Way of the Mouse", given.wayOfTheMouse,
        unusedCards((k) => isAction(k) && !k.types.includes("Duration") && costIs(k, 2, 3)));
      if (pickId) {
        choices.wayOfTheMouse = pickId;
        usedPiles.add(card(pickId).pileId ?? pickId);
        result.setAside.push({ id: "way-of-the-mouse", cards: [pickId], reasons: [{ by, text: "Played by Way of the Mouse" }] });
        use(pickId, { by, text: "Set aside for Way of the Mouse" });
      }
    }
    if (id === "black-market" && once("black-market")) {
      const size = input.blackMarketSize ?? 15;
      const candidates = unusedKingdom((k) => !k.pile && k.id !== "black-market");
      const keep = (given.blackMarket ?? []).filter((x) => candidates.includes(x));
      const deck = [...keep, ...shuffle(rng, candidates.filter((x) => !keep.includes(x)))].slice(0, size);
      choices.blackMarket = deck;
      for (const x of deck) { usedPiles.add(x); use(x, { by, text: "In the Black Market deck" }); }
      result.setAside.push({ id: "black-market", cards: deck, reasons: [{ by, text: `Black Market deck of ${deck.length} unused Kingdom cards` }] });
    }

    // Setup tokens on landmarks etc. are covered by notes; make sure the tokens are listed.
    if (note && /\{vp:/.test(note)) addToken("vp", "Victory tokens", { by, text: `setup places them` });
    if (id === "tax") addToken("debt", "Debt tokens", { by, text: "Tax puts Debt on each Supply pile" });
    if (id === "trade-route") addToken("coin-tokens", "Coin tokens (as markers)", { by, text: "Trade Route's setup" });

    // Boons, once all Fate cards might be known: handled after the loop (Druid needs the full picture).
    if (!queue.length && fateCards.length && once("boons")) {
      const boons = db.data.cards.filter((x) => x.types.includes("Boon")).map((x) => x.id);
      const druid = fateCards.includes("druid");
      let deckBoons = boons;
      if (druid) {
        const keep = (given.druidBoons ?? []).filter((b) => boons.includes(b)).slice(0, 3);
        const set = [...keep, ...shuffle(rng, boons.filter((b) => !keep.includes(b)))].slice(0, 3);
        choices.druidBoons = set;
        result.setAside.push({ id: "druid", cards: set, reasons: [{ by: "druid", text: "sets aside 3 Boons face up" }] });
        for (const b of set) use(b, { by: "druid", text: "Set aside for Druid" });
        deckBoons = boons.filter((b) => !set.includes(b));
      }
      const others = fateCards.filter((f) => f !== "druid");
      if (others.length) {
        result.decks.push({ id: "boons", cards: deckBoons, reasons: others.map((f) => ({ by: f, text: `is a Fate card` })) });
        for (const b of deckBoons) use(b, { by: others[0]!, text: "In the Boons deck" });
      }
    }
  }

  // Obelisk and Traits pick from the final Supply, so they come last.
  const actionSupply = [...supplyKingdom].filter((p) => card(p).types.includes("Action"));
  if (inUse.has("obelisk")) {
    const candidates = [...actionSupply, ...(triggered.has("ruins") ? ["ruins"] : [])];
    const target = choose("Obelisk", given.obelisk, candidates);
    if (target) { choices.obelisk = target; result.targets.obelisk = target; }
  }
  const traits = input.landscapes.filter((l) => card(l).types.includes("Trait"));
  if (traits.length) {
    choices.traits = {};
    const taken = new Set<string>();
    for (const t of traits) {
      const candidates = [...supplyKingdom].filter((p) => {
        const ty = card(p).types;
        return (ty.includes("Action") || ty.includes("Treasure")) && !taken.has(p);
      });
      const target = choose(name(t), given.traits?.[t], candidates);
      if (target) { taken.add(target); choices.traits[t] = target; result.targets[t] = target; }
    }
  }

  // Kingdom piles with sizes.
  const pileSize = (c: Card): Pile => {
    const victory = c.types.includes("Victory");
    if (c.pile) {
      const members = c.pile.members.map((m) => {
        const mc = card(m);
        let count = mc.quantity ?? 1;
        if (c.id === "castles" && players === 2) count = 1;
        return { id: m, count };
      });
      return { id: c.id, count: members.reduce((n, m) => n + m.count, 0), reasons: [], members, shuffled: c.pile.shuffled };
    }
    const base = c.quantity ?? 10;
    return { id: c.id, count: victory && players === 2 ? Math.min(base, 8) : victory ? Math.max(base, 12) : base, reasons: [] };
  };
  for (const id of input.kingdom) result.kingdom.push({ ...pileSize(card(id)), reasons: inUse.get(id) ?? [] });
  for (const p of result.extraKingdom) Object.assign(p, { ...pileSize(card(p.id)), reasons: p.reasons });

  // Landscapes picked directly.
  result.landscapes = [
    ...input.landscapes.map((id) => ({ id, reasons: [{ by: null, text: "Landscape" }] })),
    ...result.landscapes,
  ];

  // Platinum/Colony and Shelters.
  const first = input.kingdom[0] ? card(input.kingdom[0]) : undefined;
  const last = input.kingdom.length ? card(input.kingdom[input.kingdom.length - 1]!) : undefined;
  result.platinumColony = input.platinumColony === "auto"
    ? { used: first?.set === "prosperity", reason: { by: first?.id ?? null, text: first?.set === "prosperity"
        ? `The first Kingdom card (${first.name}) is from Prosperity`
        : "The first Kingdom card isn't from Prosperity" } }
    : { used: input.platinumColony, reason: { by: null, text: input.platinumColony ? "Chosen for this game" : "Not used this game" } };
  result.shelters = input.shelters === "auto"
    ? { used: last?.set === "dark-ages", reason: { by: last?.id ?? null, text: last?.set === "dark-ages"
        ? `The last Kingdom card (${last.name}) is from Dark Ages`
        : "The last Kingdom card isn't from Dark Ages" } }
    : { used: input.shelters, reason: { by: null, text: input.shelters ? "Chosen for this game" : "Not used this game" } };

  // Basic Supply.
  const big = players > 4;
  const victoryCount = players === 2 ? 8 : 12;
  const heirloomCount = result.startingDeck.cards.length;
  const startingCoppers = 7 - heirloomCount;
  const basics: Pile[] = [
    { id: "copper", count: (big ? 120 : 60) - startingCoppers * players, reasons: [] },
    { id: "silver", count: big ? 80 : 40, reasons: [] },
    { id: "gold", count: big ? 60 : 30, reasons: [] },
    ...(result.platinumColony.used ? [{ id: "platinum", count: 12, reasons: [result.platinumColony.reason] }] : []),
    { id: "estate", count: victoryCount, reasons: [] },
    { id: "duchy", count: victoryCount, reasons: [] },
    { id: "province", count: players === 2 ? 8 : players <= 4 ? 12 : 12 + 3 * (players - 4), reasons: [] },
    ...(result.platinumColony.used ? [{ id: "colony", count: victoryCount, reasons: [result.platinumColony.reason] }] : []),
    { id: "curse", count: 10 * (players - 1), reasons: [] },
  ];
  result.basic = [...basics, ...result.basic];

  // Starting deck.
  result.startingDeck.cards.unshift({ id: "copper", count: startingCoppers });
  if (result.shelters.used) {
    for (const s of ["hovel", "necropolis", "overgrown-estate"]) result.startingDeck.cards.push({ id: s, count: 1 });
    result.startingDeck.reasons.push({ by: result.shelters.reason.by, text: "Shelters replace the starting Estates" });
  } else {
    result.startingDeck.cards.push({ id: "estate", count: 3 });
  }
  if (inUse.has("inherited")) {
    result.startingDeck.reasons.push({ by: "inherited", text: "Each player replaces a starting card with the Inherited pile's card (after Shelters and Heirlooms)" });
  }

  return result;
}
