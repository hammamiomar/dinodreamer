import { BAND_NAMES, type BandIndex } from "./strength-bands";

const count = (value: number) => value.toLocaleString("en-US");
const patches = (value: number) => `${count(value)} ${value === 1 ? "patch" : "patches"}`;

/**
 * Wording for the basis group panel and the picture page, grouped by where it appears.
 */
export const LOOK_TEXT = {
  // The head (block-head.tsx): the line under the number, and the page's one primary.
  head: {
    /** The response category, in the Index's words: "Prefix-token category". */
    family: (name: string) => `${name} category`,
    patches: (value: number) => `selected on ${count(value)} library ${value === 1 ? "patch" : "patches"}`,
    materials: (value: number) => `${count(value)} ${value === 1 ? "automaton" : "automata"}`,
    grow: "Train an automaton",
    star: "Star",
    starred: "Starred",
    starLabel: (block: number) => `Star basis group ${block}`,
  },

  // Its largest responses (strongest-pictures.tsx): the Level 4 row of the first screen.
  fires: {
    title: "Level 4",
    /** After the level's word: its estimated patches in the whole response set. */
    about: (value: string) => `about ${value} patches`,
    /** At the end of the row's heading line, for the picture under the pointer, in focus or tapped. */
    growFrom: "Train from this patch",
    /** A picture's name for a screen reader. */
    picture: (picture: string, column: number, row: number) => `${picture}, patch ${column}, ${row}`,
    empty: "The public sample has no Level 4 patch with a picture.",
  },

  // Its automata (block-materials.tsx), under the Level 4 row.
  materials: {
    title: "Automata",
    /** The link after the heading's count, to Automata. */
    all: (total: number) => `All ${count(total)} in Automata`,
    none: "No automaton of this basis group yet.",
    /** A tile's third line, for an automaton whose final cellular model did not meet the selection target; one that met it shows its stored value in m. */
    didNotFire: "selection target not met",
    /** A tile's grids for an automaton at 2 px per cell: "Fine · 2 px". */
    twoPixels: (rule: string) => `${rule} · 2 px`,
    failed: (message: string) => `The automata could not be read: ${message}`,
  },

  // The response plot (cloud-view.tsx, cloud-controls.tsx, the side panel in token-pictures.tsx).
  cloud: {
    /** The response plot's heading: what it shows. */
    title: "Every patch where it is among the top 32, by response magnitude",
    /** The tool choice's name for a screen reader. */
    tools: "Response plot tools",
    turn: "Turn",
    lasso: "Lasso",
    wand: "Wand",
    /** The check that shows the wand, its reach, the flat views and the request. */
    advanced: "Advanced",
    /** One line at the view's lower right, for the tool in use. */
    hints: {
      turn: "Drag to turn. Click a dot to see its picture.",
      lasso: "Draw around dots. Turn and draw again to keep what is inside both.",
      wand: "Click a dot. The response selection spreads from it. Shift-click adds a start.",
    },
    /** The side panel's name for a screen reader. */
    picked: "The picked patch",
    /** The side panel's button. */
    growFrom: "Train from this patch",
  },

  // The details line under the response levels (cloud-controls.tsx CloudDetails).
  details: {
    drawn: (drawn: number, total: number) => `${count(drawn)} of ${patches(total)} drawn`,
    withoutPicture: (value: number) => `${count(value)} without a public picture`,
    sample: (sample: number) => `pictures and counts from a public sample of ${count(sample)}`,
    /** Loads the next part of the basis group's full response set. */
    more: "draw more",
  },

  // The view (cloud-view.tsx, cloud-drawing.ts).
  canvasLabel: "Response plot. Drag to turn. Arrow keys turn; Shift with arrow keys moves; plus and minus zoom. Click the plot, then scroll to zoom.",
  planes: { "12": "Flat: side", "13": "Flat: top", "23": "Flat: end-on" } as Record<"12" | "13" | "23", string>,
  /** The display basis's axes: the first points along the published main direction. */
  axes: ["main direction", "2", "3"],
  resetView: "Reset view",
  ring: "ring",
  wandLimit: (reach: number) => `the wand reaches the first ${count(reach)}`,
  loadingMore: "Loading…",

  // Advanced, the tools row (cloud-controls.tsx).
  reach: "Reach",
  reachValue: (percent: number) => `${percent}%`,
  region: (selected: number) => patches(selected),
  clear: "Clear",

  // The basis group panel over any page (basis-group-panel.tsx).
  panel: {
    name: (block: number) => `Basis group ${block}`,
    close: "Close",
    loading: "Loading basis group…",
  },

  // The automaton's reference patch, first in the basis group panel opened from Automata (look-page.tsx, OriginPlace).
  origin: {
    /** The section's heading. */
    title: "Trained toward this patch",
    /** In place of the picture, when the reference was a patch of the person's own picture. */
    upload: "A patch of the person's own picture; the picture stayed on their device.",
    /** The link that lights the patch in the cloud below and scrolls there. */
    show: "Show it in the cloud",
  },

  // Picture names for tooltips, alternative text and screen readers (cloud-token.ts).
  pictureOf: {
    library: (imageId: number) => `Image ${imageId}`,
    upload: "Your picture",
  },

  // A response level's share of the response set (strength-display.tsx formatShare): the level rows, the picture page.
  share: {
    underOne: "under 1%",
    percent: (percent: number) => `${percent}%`,
  },
  /** Names the per-level counts for a screen reader (strength-display.tsx). */
  countsName: "Patches per response level",

  // A strip of pictures (token-pictures.tsx TokenStrip): the level rows, Advanced, your picture's section.
  strip: {
    previous: (strip: string) => `Previous pictures in ${strip}`,
    next: (strip: string) => `Next pictures in ${strip}`,
    /** A picture's name for a screen reader: pressing it picks the patch. */
    select: (picture: string, column: number, row: number) => `Select ${picture}, patch ${column}, ${row}`,
  },

  // Your picture's source chip, over its section (picture-entry.tsx PictureSourceChip).
  source: {
    name: "Picture source",
    from: "From your picture",
    remove: "Remove",
    removeName: "Remove picture",
  },

  /** The panel's line for an address that names no basis group (basis-group-panel.tsx). */
  notABlock: "There is no basis group with this number.",

  // One patch: the side panel, the Train page's reference patch card.
  patchAt: (column: number, row: number) => `Patch ${column}, ${row}`,
  /** The side panel's line under the response level: which patch of which kind of picture; the image id is its title only. */
  patchOf: (column: number, row: number, yours: boolean) => `Patch ${column}, ${row} of ${yours ? "your picture" : "a library picture"}`,
  position: (fraction: number) => fraction < 0
    ? "Below the median selection threshold"
    : `${Math.round(fraction * 100)}% of the way out`,
  noPicture: "No public picture",
  selectAround: "Select around it",
  askForIt: "Make it the reference patch",
  asking: "The reference patch",

  // The training target, inside Advanced (request-panel.tsx).
  request: {
    title: "Training target",
    /** The section's name for a screen reader. */
    name: "Training target for Train",
    /** The strip of the response selection's pictures. */
    selected: "Selected patches",
  },
  asksFor: "Reference patch",
  noAnchor: "Nothing yet. Start with Level 4: it holds the patches with the largest response magnitudes in the sample.",
  startStrongest: "Start with Level 4",
  selectBand: "Select a response level",
  anchorFollows: {
    wand: "the patch you clicked",
    lasso: "the patch with the largest response magnitude you drew around",
    picture: "your picture’s patch with the largest response magnitude here",
    band: "the level’s patch nearest the main direction",
  },
  anchorChosen: "chosen by you",
  followSelection: "Follow the selection",
  weakAnchor: "Training tests so far: reference patches near the ring did not meet the selection target; reference patches from Level 3 and Level 4 did.",
  lift: (band: BandIndex) => `Lift to ${BAND_NAMES[band]}`,
  liftNote: (degrees: number) => `Same direction within ${degrees < 1 ? "1" : Math.round(degrees)}°, farther out`,
  noLift: (band: BandIndex) => `The public sample has no ${BAND_NAMES[band]} patch.`,
  prefixNote: "A selection covers the loaded patches only.",
  regionEmpty: "Response selection: none yet",
  growing: "expanding the response selection…",
  regionFailed: "The response selection could not be calculated. Select a response level or reload the page to try again.",
  regionFrom: {
    wand: (seeds: number) => `spread from ${seeds} ${seeds === 1 ? "start" : "starts"}`,
    lasso: (passes: number) => passes === 1 ? "one lasso" : `${passes} lassos, inside all`,
    picture: () => "your picture’s patches",
    band: (band: BandIndex) => `every loaded ${BAND_NAMES[band]} patch`,
  },
  regionCount: (selected: number) => `Response selection: ${patches(selected)}`,
  send: "Send to Train",
  download: "Download training target",
  thinned: (limit: number, selected: number) => `Send carries ${count(limit)} of ${patches(selected)}, evenly spread; the download has all of them.`,
  sent: (sent: number, selected: number) => `Ready for Train: ${sent < selected ? `${count(sent)} of ${patches(selected)}` : patches(sent)}.`,
  openGrow: "Open Train",
  keepRequest: "Download the training target to keep it after this tab closes.",
  needsAnchor: "Choose a reference patch first.",
  // The experimental Painter handoff in the request actions.
  canvas: "Send to the Painter · experimental",
  canvasFull: "The Painter holds four requests already. Remove one there first.",
  canvasLibraryOnly: "The Painter takes a library patch, with its recorded code.",

  // An Index card's link to Train (features/atlas/cloud-card.tsx).
  grow: "Train ↗",

  // Your picture in this basis group (picture-place.tsx).
  picture: {
    title: "Your picture in this basis group",
    patches: (value: number) => `${patches(value)} of your picture`,
    none: "This basis group is not among the top 32 on any patch of your picture. Go back and choose another of its selected basis groups.",
    strongestHere: "Your largest response magnitude here",
    span: "The white box spans the response magnitudes of your picture’s patches in this basis group, smallest to largest; the ring marks your largest.",
    alreadyStrongest: "Your patch is already in Level 4, the highest response level.",
    selectAll: "Select your picture’s patches",
    nearest: (band: BandIndex) => `Nearest ${BAND_NAMES[band]} patch in the same direction`,
    blockStrongest: "The basis group’s patches with the largest response magnitudes",
    whiteRings: "White rings in the response plot",
    move: "Lift moves the reference patch outward along your patch’s direction, toward larger response magnitudes.",
    growFrom: "Train from this",
  },

  // Your picture's status while it is opened and analyzed (app/uploaded-picture.tsx): under the picture
  // page's head, on the Index's upload line and over a basis group's page. The error follows the failures.
  upload: {
    preparing: "Preparing your picture…",
    starting: "Starting the image analyzer…",
    notOpened: (error: string) => `This picture could not be opened. ${error}`,
    /** Also the line without WebGPU: the image analyzer's own reason follows it. */
    notRead: (error: string) => `The picture could not be analyzed. ${error}`,
  },

  // The picture page (/picture, picture-page.tsx): your uploaded picture and the basis groups selected in it.
  picturePage: {
    label: "Your picture",
    /** The heading when the upload has no name. */
    untitled: "Your picture",
    chooseAnother: "Choose another picture",
    empty: "No picture is open. Upload a picture on the Index to start.",
    toExplore: "Go to the Index",
    pictureName: "The centered square of your picture that the image analyzer sees",
    /** Under the picture: the hovered basis group, or how to see one. */
    hovered: (block: number, count: number) => `Basis group ${block} · selected on ${count} ${count === 1 ? "patch" : "patches"}`,
    hoverHint: "Hover or focus a basis group to see the patches where it is selected.",
    note: "This centered square is analyzed in your browser.",
    blocksName: "Basis groups selected in your picture",
    blocksTitle: "Selected basis groups",
    blocksLead:
      "Ranked by the number of patches where each is selected. The tag names the response level of your patch with the largest response magnitude in that basis group. Open a basis group to find your patches in its response plot, or train an automaton of what your picture showed there.",
    patches: (count: number) => `${count} ${count === 1 ? "patch" : "patches"}`,
    growFrom: "Train from this",
    opening: "Opening Train…",
    listCount: (shown: number, total: number) => `${shown} of ${total} selected basis groups`,
    more: "Show more basis groups",
    readAgain: "Try reading again",
    cancel: "Cancel",
  },

  // The response levels under the response plot (band-rows.tsx).
  bandsTitle: "Response levels",
  /** The level word's name for a screen reader: it frames the level's dots in the response plot. */
  showBand: (band: string) => `${band}: show in the response plot`,
  bandEstimate: (about: string, share: string) => `about ${about} · ${share}`,
  emptyBand: "No patch of the public sample is at this response level.",
} as const;
