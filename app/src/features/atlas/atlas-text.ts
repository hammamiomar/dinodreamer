import { BAND_NAMES } from "../look/strength-bands";

/** Index wording, grouped by where it appears. */
export const ATLAS_TEXT = {
  // The head (atlas-page.tsx): the heading, plain-English orientation line, and upload line beside it.
  title: "The shape of a basis group",
  subtitle: "16,384 basis groups learned from DINOv3 without labels. Open any card to inspect its patches or train an automaton.",
  upload: {
    button: "Inspect your own picture",
    view: "Open inspected picture →",
  },

  // The controls (atlas-page.tsx).
  /** The find field's accessible name; its visible prompt is the placeholder. */
  search: "Find a basis group by its number",
  /** The find field's placeholder: what to type, with the collection's range (16,384 groups, numbered from 0). */
  searchPlaceholder: "Basis group number, 0 to 16383",
  sort: "Sort",
  orders: {
    reach: "Reaches farther past the median ring",
    ring: "More patches above the median ring",
    pole: "Larger opposite-direction spread",
    block: "Basis group order (0–16,383)",
  },
  /** The automaton filter (atlas-page.tsx): every group, the groups with an automaton, or those with none. */
  automaton: {
    label: "Automata",
    filters: {
      any: "Any",
      some: "Has an automaton",
      none: "No automaton yet",
    },
  },
  starred: "Starred",
  // The response category: the filter in the first row of controls and a card's label line
  // (cloud-card.tsx). The category names are `families` below.
  category: {
    /** The filter's label, before its choice. */
    label: "Category",
    /** The filter's first option: every block, with a category or without. */
    any: "Any",
    /** A card's label line, after the number: "Own-token category". */
    card: (name: string) => `${name} category`,
  },
  results: (first: number, last: number, total: number) =>
    `${first.toLocaleString()}–${last.toLocaleString()} of ${total.toLocaleString()} ${total === 1 ? "basis group" : "basis groups"}`,
  mobileResults: (first: number, last: number, total: number) =>
    `${first.toLocaleString()}–${last.toLocaleString()} of ${total.toLocaleString()}`,
  filterToggle: "Filter & sort",
  filterToggleActive: (active: number) => `Filter & sort · ${active}`,
  /** The button at the end of the control line: it opens another page of the same choices at random. */
  random: "Random",

  // A card (cloud-card.tsx).
  /** The number's name for a screen reader: it opens the basis group's page. */
  openBlock: (block: number) => `Basis group ${block}`,
  cloudName: (block: number, patches: number) =>
    `Basis group ${block}: ${patches.toLocaleString()} sampled patches where it is selected`,
  bands: BAND_NAMES,
  count: (count: number, total: number) =>
    `${count.toLocaleString()} of ${total.toLocaleString()} patches`,
  pictureName: (block: number, band: string) =>
    `${band} patch of basis group ${block}`,
  stripBar: "Level widths show the number of patches",
  loadingCard: "Loading basis group…",
  failed: "This response plot could not be loaded.",
  retry: "Try again",
  emptyCloud: "No selected patches in this sample.",

  // The end of the page (atlas-page.tsx).
  emptyResults: "No basis groups match these choices.",
  loadingFilters: "Loading filter data…",
  filterFailed: (message: string) => `These filters could not be applied. ${message}`,
  categoryUnavailable: "This release has no response categories.",
  reset: "Reset choices",
  previous: "Previous basis groups",
  next: "Next basis groups",
  pagination: "Index pages",
  specBar: {
    name: "Sample specification",
    sampleLabel: "Sample",
    sampleValue: "4,096 library patches per basis group",
    plotCapLabel: "Plot cap",
    plotCapValue: "Up to 1,024 sampled patches drawn in 3D per card",
  },

  // A basis group's response category in words: the Inspect page's line, the Automata choices and How it works.
  families: {
    local: "Own-token",
    neighbourhood: "Near-patch",
    surround: "Distant-patch",
    global: "Prefix-token",
    position: "Position-concentrated",
    unknown: "Unmeasured",
  },
  /** The link to the Index under a basis group's response category (the basis group panel's source bar). */
  familyLink: "Category colors in the Index",
} as const;
