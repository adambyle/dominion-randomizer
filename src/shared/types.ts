// Shared data model for generated card data (data/generated/*.json) and the setup engine.
//
// Rich text fields use a small inline markup produced by scripts/wikitext.ts:
//   **bold**  *italic*  \n line break  \n---\n dividing line
//   {card:Name}  {cost:3}  {cost:3*}  {debt:8}  {potion}  {vp:2}  {coin:+1}  {sun}

export type Edition = 1 | 2;

/** A physical product someone can own: a set in a particular edition. */
export interface Box {
  id: string; // e.g. "dominion-2", "cornucopia-1", "seaside-1"
  set: string; // set id, e.g. "dominion"
  name: string; // display name, e.g. "Dominion (2nd Edition)"
  edition: Edition | null; // null for sets that only had one printing
  released: string; // yyyy-mm, used for ordering
}

export interface SetInfo {
  id: string;
  name: string;
  boxes: string[];
}

export interface Cost {
  coin: number;
  debt: number;
  potion: boolean;
  /** "*" (special cost rules) or "+" (overpay) as printed after the coin cost. */
  extra?: "*" | "+";
}

/**
 * How a card enters the game:
 * - kingdom:    a randomizable Kingdom pile (including split-pile piles like "Augurs")
 * - pileMember: a card inside a split/mixed Kingdom pile (Rocks, Dame Anna, Sibyl ...)
 * - basic:      Supply piles not chosen as Kingdom cards (Copper, Platinum, Potion, Ruins, Shelters)
 * - nonSupply:  piles outside the Supply (Spoils, Horse, Wishes, Prizes, Heirlooms, Loot ...)
 * - landscape:  Events, Landmarks, Projects, Ways, Traits, Allies, Prophecies
 * - status:     Boons, Hexes, States, Artifacts
 */
export type CardKind = "kingdom" | "pileMember" | "basic" | "nonSupply" | "landscape" | "status";

export interface Card {
  id: string; // slug of the wiki page title
  name: string;
  set: string;
  /** Boxes this card is printed in. */
  boxes: string[];
  kind: CardKind;
  types: string[];
  cost: Cost | null; // null for landscapes/statuses without a cost
  text: string;
  /** Below-the-line text (Setup:, Heirloom:, Overpay: ...). */
  text2?: string;
  quantity?: number;
  /** For split piles: the member card ids in pile order (top first). */
  pile?: { members: string[]; shuffled: boolean };
  /** For pileMember: the id of the Kingdom pile it belongs to. */
  pileId?: string;
  illustrator?: string;
  image?: string;
  wikiTitle: string;
}

export interface FaqSection {
  heading: string; // "Official FAQ", "Other rules clarifications", ...
  items: FaqItem[];
  /** True when the section was written for this app rather than copied from the wiki. */
  supplemental?: boolean;
  /** Superseded rulings the wiki keeps in collapsed boxes (e.g. "Deprecated official FAQ (2018–2021)"). */
  deprecated?: boolean;
}

export interface FaqItem {
  text: string;
  children?: FaqItem[];
}

export interface CardFaq {
  id: string;
  sections: FaqSection[];
}

export interface RulesPage {
  id: string;
  title: string;
  sections: { heading: string; body: string }[];
}

export interface RecommendedKingdom {
  id: string;
  name: string;
  /** Where it comes from: a set's rulebook, or "Designed by Donald X." */
  source: "rulebook" | "donald-x";
  /** Section heading on the wiki, e.g. "Dominion 2E & Seaside 1E". */
  group: string;
  /** Sets the kingdom draws from. Playability is decided per card: each card needs an owned box. */
  sets: string[];
  /** Rulebook editions named by the wiki heading ("Dominion 2E & Seaside 1E"), keyed by set id. */
  editions: Record<string, Edition>;
  kingdom: string[]; // card ids (Kingdom piles)
  landscapes: string[]; // card ids
  colony: boolean;
  shelters: boolean;
  /** Fixed choices the rulebook makes (Bane, Ferryman pile, Druid's Boons, Trait targets ...). */
  choices: Record<string, string | string[]>;
}

export interface CardData {
  generated: string;
  source: string;
  boxes: Box[];
  sets: SetInfo[];
  cards: Card[];
  /** Setup instructions from the wiki's Setup page, keyed by card id (or type name for group rules). */
  setupNotes: Record<string, string>;
}
