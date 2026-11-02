// Hand-maintained data the wiki doesn't express in a machine-readable way.
// Card names here must match wiki page titles exactly; build-data.ts fails loudly if one doesn't.

import type { Edition } from "../src/shared/types";

/** Wiki "set" field values that are excluded entirely (unreleased products). */
export const EXCLUDED_SETS = new Set(["Arcana"]);

export interface SetDef {
  id: string;
  wikiName: string; // value of the infobox |set= field
  name: string;
  /** Boxes by edition. Sets printed once have a single box with edition null. */
  boxes: { id: string; name: string; edition: Edition | null; released: string }[];
}

export const SETS: SetDef[] = [
  { id: "dominion", wikiName: "Dominion", name: "Dominion", boxes: [
    { id: "dominion-1", name: "Dominion (1st Edition)", edition: 1, released: "2008-10" },
    { id: "dominion-2", name: "Dominion (2nd Edition)", edition: 2, released: "2016-10" },
  ] },
  { id: "intrigue", wikiName: "Intrigue", name: "Intrigue", boxes: [
    { id: "intrigue-1", name: "Intrigue (1st Edition)", edition: 1, released: "2009-07" },
    { id: "intrigue-2", name: "Intrigue (2nd Edition)", edition: 2, released: "2016-10" },
  ] },
  { id: "seaside", wikiName: "Seaside", name: "Seaside", boxes: [
    { id: "seaside-1", name: "Seaside (1st Edition)", edition: 1, released: "2009-10" },
    { id: "seaside-2", name: "Seaside (2nd Edition)", edition: 2, released: "2022-03" },
  ] },
  { id: "alchemy", wikiName: "Alchemy", name: "Alchemy", boxes: [
    { id: "alchemy", name: "Alchemy", edition: null, released: "2010-05" },
  ] },
  { id: "prosperity", wikiName: "Prosperity", name: "Prosperity", boxes: [
    { id: "prosperity-1", name: "Prosperity (1st Edition)", edition: 1, released: "2010-10" },
    { id: "prosperity-2", name: "Prosperity (2nd Edition)", edition: 2, released: "2022-03" },
  ] },
  // In 1st edition Cornucopia and Guilds were separate boxes; 2nd edition merged them.
  { id: "cornucopia-guilds", wikiName: "Cornucopia & Guilds", name: "Cornucopia & Guilds", boxes: [
    { id: "cornucopia-1", name: "Cornucopia (1st Edition)", edition: 1, released: "2011-06" },
    { id: "guilds-1", name: "Guilds (1st Edition)", edition: 1, released: "2013-06" },
    { id: "cornucopia-guilds-2", name: "Cornucopia & Guilds (2nd Edition)", edition: 2, released: "2024-01" },
  ] },
  { id: "hinterlands", wikiName: "Hinterlands", name: "Hinterlands", boxes: [
    { id: "hinterlands-1", name: "Hinterlands (1st Edition)", edition: 1, released: "2011-10" },
    { id: "hinterlands-2", name: "Hinterlands (2nd Edition)", edition: 2, released: "2022-09" },
  ] },
  { id: "dark-ages", wikiName: "Dark Ages", name: "Dark Ages", boxes: [
    { id: "dark-ages", name: "Dark Ages", edition: null, released: "2012-08" },
  ] },
  { id: "adventures", wikiName: "Adventures", name: "Adventures", boxes: [
    { id: "adventures", name: "Adventures", edition: null, released: "2015-04" },
  ] },
  { id: "empires", wikiName: "Empires", name: "Empires", boxes: [
    { id: "empires", name: "Empires", edition: null, released: "2016-06" },
  ] },
  { id: "nocturne", wikiName: "Nocturne", name: "Nocturne", boxes: [
    { id: "nocturne", name: "Nocturne", edition: null, released: "2017-11" },
  ] },
  { id: "renaissance", wikiName: "Renaissance", name: "Renaissance", boxes: [
    { id: "renaissance", name: "Renaissance", edition: null, released: "2018-10" },
  ] },
  { id: "menagerie", wikiName: "Menagerie", name: "Menagerie", boxes: [
    { id: "menagerie", name: "Menagerie", edition: null, released: "2020-03" },
  ] },
  { id: "allies", wikiName: "Allies", name: "Allies", boxes: [
    { id: "allies", name: "Allies", edition: null, released: "2022-03" },
  ] },
  { id: "plunder", wikiName: "Plunder", name: "Plunder", boxes: [
    { id: "plunder", name: "Plunder", edition: null, released: "2022-12" },
  ] },
  { id: "rising-sun", wikiName: "Rising Sun", name: "Rising Sun", boxes: [
    { id: "rising-sun", name: "Rising Sun", edition: null, released: "2024-02" },
  ] },
  // Promos are sold individually; build-data.ts creates one box per promo pile.
  { id: "promo", wikiName: "Promo", name: "Promos", boxes: [] },
];

/** 1st-edition Cornucopia & Guilds cards, split by the box they shipped in. */
export const FIRST_EDITION_BOX: Record<string, "cornucopia-1" | "guilds-1"> = Object.fromEntries([
  ...["Fairgrounds", "Farming Village", "Fortune Teller", "Hamlet", "Harvest", "Horn of Plenty",
    "Horse Traders", "Hunting Party", "Jester", "Menagerie", "Remake", "Tournament", "Young Witch",
    "Bag of Gold", "Diadem", "Followers", "Princess", "Trusty Steed"].map((c) => [c, "cornucopia-1"] as const),
  ...["Advisor", "Baker", "Butcher", "Candlestick Maker", "Doctor", "Herald", "Journeyman",
    "Masterpiece", "Merchant Guild", "Plaza", "Soothsayer", "Stonemason", "Taxman"].map((c) => [c, "guilds-1"] as const),
]);

/**
 * Kingdom piles made of several differently named cards. `pile` is the wiki page for the pile
 * where one exists (Augurs, Castles, Knights); Empires-style two-card piles have no page, so
 * their name is "Top/Bottom" like the randomizer card.
 */
export const SPLIT_PILES: { pile: string; members: string[]; shuffled: boolean }[] = [
  { pile: "Catapult/Rocks", members: ["Catapult", "Rocks"], shuffled: false },
  { pile: "Encampment/Plunder", members: ["Encampment", "Plunder"], shuffled: false },
  { pile: "Gladiator/Fortune", members: ["Gladiator", "Fortune"], shuffled: false },
  { pile: "Patrician/Emporium", members: ["Patrician", "Emporium"], shuffled: false },
  { pile: "Settlers/Bustling Village", members: ["Settlers", "Bustling Village"], shuffled: false },
  { pile: "Sauna/Avanto", members: ["Sauna", "Avanto"], shuffled: false },
  { pile: "Castles", shuffled: false, members: ["Humble Castle", "Crumbling Castle", "Small Castle",
    "Haunted Castle", "Opulent Castle", "Sprawling Castle", "Grand Castle", "King's Castle"] },
  { pile: "Knights", shuffled: true, members: ["Dame Anna", "Dame Josephine", "Dame Molly", "Dame Natalie",
    "Dame Sylvia", "Sir Bailey", "Sir Destry", "Sir Martin", "Sir Michael", "Sir Vander"] },
  { pile: "Augurs", members: ["Herb Gatherer", "Acolyte", "Sorceress", "Sibyl"], shuffled: false },
  { pile: "Clashes", members: ["Battle Plan", "Archer", "Warlord", "Territory"], shuffled: false },
  { pile: "Forts", members: ["Tent", "Garrison", "Hill Fort", "Stronghold"], shuffled: false },
  { pile: "Odysseys", members: ["Old Map", "Voyage", "Sunken Treasure", "Distant Shore"], shuffled: false },
  { pile: "Townsfolk", members: ["Town Crier", "Blacksmith", "Miller", "Elder"], shuffled: false },
  { pile: "Wizards", members: ["Student", "Conjurer", "Sorcerer", "Lich"], shuffled: false },
];

/**
 * Corrections to recommended kingdoms where every copy on the wiki is wrong, keyed by kingdom
 * title and the edition signature of its section heading (e.g. "dominion:1,intrigue:1").
 */
export const KINGDOM_FIXES: { title: string; editions: string; remove?: string[]; note: string }[] = [
  { title: "Hand Madness", editions: "dominion:1,intrigue:1", remove: ["Workshop"],
    note: "Both wiki copies list 11 piles; Workshop is not in the 1st-edition rulebook set." },
];

/** Wiki pages that aren't cards but belong in the in-app rules reference. */
export const RULES_PAGE_SKIP_HEADINGS =
  /trivia|gallery|preview|history|retrospective|external|strategy|card art|versions|language|outtakes|opinion|in other|flavor|theme|impact|further development|relevant|wording|box|contents|official releases|see also|references|navigation/i;
