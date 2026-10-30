/**
 * Copy for the Painter (/create and its dock). A placeholder in braces ({block}, {message}) is filled by
 * the component with fill or fillNodes (app/site-words.ts). The term and basis group words the
 * editor shares with its formulas stay in presentation.ts (TERM_TEXT, BLOCKS_TEXT, NOISE_TEXT).
 * A request in the code is an editing constraint on the page.
 */
export const CREATE_TEXT = {
  /** The page's name, a label above the canvas: the same word as the Painter page's way in. */
  heading: "Painter",
  transport: {
    /** The run controls under the canvas (transport.tsx), left to right. "Load the model" stands for Play until the model is in this browser. */
    loadModel: "Load the model",
    play: "Play",
    pause: "Pause",
    /** In Play's place after a failure. */
    retry: "Retry",
    step: "Step",
    reset: "Reset",
    /** The small word before the seed's field, and the field's name for a screen reader. */
    seedWord: "seed",
    seedName: "Seed",
    /** The small word before the two save buttons, their names and their tooltips. */
    saveWord: "save",
    saveImage: "Save image",
    saveImageTitle: "Save image: the picture on the stage, as a PNG",
    saveVideo: "Save video",
    saveVideoTitle: "Save video: the run's pictures, as a clip",
    /** The video button's name while the clip is encoded. */
    savingVideo: "Saving the video",
    /** The step count at the row's right end; {step} is the number, in bold. Its tooltip is the rate. */
    stepCount: "step {step}",
    rate: "{rate} steps/s",
    /** The note under the row when the clip could not be saved. {message} is the error. */
    notSaved: "not saved: {message}",
    /** The note when the browser has no WebGPU. */
    noWebGpu: "Painting needs WebGPU: use Chrome, Edge or Safari 26. The Index and the basis group viewer still work in this browser.",
    /** The note when the engine did not apply a revision. */
    revisionRejected: "Revision {revision} was not applied: {message}",
    /** The note when the engine refused Play or Step; {command} is that word. */
    refused: "{command} refused: {message}",
    /** The passing notes while the engine prepares. */
    preparingDevice: "Preparing this device",
    preparingRequest: "Preparing the new constraint · the image keeps its pixels",
    /** The card over the canvas until the first objective is installed: its heading is preparingDevice. */
    downloading: "DINOv3 is cached in this browser for up to two weeks. Your constraints and paint are kept.",
    encoding: "Encoding the reference pictures on this device. No network call happens inside the loop.",
    megabytes: "{done} / {total} MB",
  },

  page: {
    /** The editing constraints column (create-page.tsx), for a screen reader, and the title field's name. */
    requests: "Editing constraints",
    title: "Title",
    /** In the constraints column when there is none. */
    noRequests: "No editing constraints yet.",
    /** Under the constraints when the image holds four. */
    full: "The image holds four editing constraints. Remove one to add another.",
    /** Under the constraints when the autosave failed. {message} is the error. */
    notSaved: "not saved: {message}",
    /** Clear, beside the title, and the question it asks in place. */
    clear: "Clear",
    clearName: "Clear the image",
    clearQuestion: "Clear the name, the constraints, Protect, Noise and the step?",
    /** Added to the question when the creation is saved. */
    clearSaved: " The saved image keeps what you have now.",
    keep: "Keep",
  },

  dock: {
    /** The dock (dock-canvas.tsx): its name for a screen reader, its title field, and the link to /create. */
    name: "Your image",
    title: "Title",
    open: "Open",
    openName: "Open your image",
    /** The tray's tab, beside the thumbnail. */
    tab: "Image",
    /** The constraint slots under the image, for a screen reader. {block} is the basis group's number. */
    slots: "Constraints",
    heldSlot: "Basis group {block}, not placed yet: paint where it goes",
    requestSlot: "Basis group {block}: paint its areas with the dock's brush",
    /** The step beside the title. */
    step: "step {step}",
    /** The run chip in the head. */
    play: "Play",
    pause: "Pause",
    /** The choice of the area a stroke paints, for a screen reader. */
    brushArea: "The area the brush paints",
    protect: "Protect",
  },

  areas: {
    /** What one stroke paints when it paints both of a constraint's areas, in the dock's line and on the held card: "Response and Appearance". {respond} and {look} are the term names. */
    both: "{respond} and {look}",
  },

  request: {
    /** A constraint's card (cards/request-card.tsx), for a screen reader. {id} is the constraint's number. */
    name: "Constraint {id}",
    /** The basis group's number, a link to the basis group viewer, for a screen reader. */
    openBlock: "Basis group {block}: open it in the basis group viewer",
    /** Under the number: "basis group", then the token for a CLS or storage constraint ("basis group · CLS"). */
    blockWord: "basis group",
    blockToken: "basis group · {token}",
    /** What the card's "?" explains, and its × button, for a screen reader. */
    explainSubject: "constraint {id}",
    remove: "Remove constraint {id}",
    /** The card's "?" text; the brush's help follows it. */
    explanation: [
      "Response: the image changes until this area's tokens carry this basis group's response vector.",
      "Appearance: this area takes the look of the reference pictures.",
      "The lock paints both areas with one stroke.",
    ],
    /** A term's weight stepper, for a screen reader: "Response weight". */
    weightName: "{name} weight",
    /** The source picture, for a screen reader. {id} is the picture's number. */
    imageName: "Image {id}",
  },

  held: {
    /** The card of a token dropped but not placed yet (cards/held-card.tsx), for a screen reader. */
    name: "Basis group {block}, not placed yet",
    /** Under its number. */
    side: "basis group · not placed yet",
    remove: "Remove basis group {block}",
    /** The tooltip of its areas' name. */
    firstStroke: "Your first stroke on the image places these areas",
  },

  image: {
    /** The Image group of rows under the constraints (cards/image-group.tsx): its name and heading. */
    name: "Image",
    protect: "Protect",
    /** After Protect's name: how many cells it holds. */
    oneCell: "1 cell",
    cells: "{count} cells",
    /** The chip that clears Protect, and the word at the line's end while the row paints or can paint. */
    clear: "clear",
    painting: "painting",
    paint: "paint",
    /** Protect's sentence under its line. */
    protectSentence: "painted cells keep the base image's pixels, which move with the image while Zoom is on",
    /** The Zoom row's stepper, for a screen reader: its name, what its buttons change and the value as read. */
    zoomName: "Zoom per optimizer update",
    zoomSubject: "zoom per optimizer update",
    zoomSpoken: "{percent} % per optimizer update",
  },

  pictures: {
    /** A reference picture in a card's strip (cards/picture-strip.tsx), for a screen reader. {id} is its number. */
    image: "Image {id}",
    editWindow: "Image {id}: edit its window",
    remove: "Remove this picture",
  },

  window: {
    /** The source window editor (cards/source-window-editor.tsx): its title, its count, Close. */
    title: "Source window",
    count: "image {id} · {selected} of {cells} tokens",
    close: "Close",
    /** Under the grid. */
    note: "Selected tokens enter this picture's appearance template. DINOv3 still reads the whole picture.",
    /** The three chips at the foot. */
    wholeView: "whole view",
    reset: "reset",
    remove: "remove this picture",
  },

  stepper: {
    /** A stepper's − and + buttons, for a screen reader (cards/stepper.tsx). {subject} is what they change. */
    decrease: "Decrease {subject}",
    increase: "Increase {subject}",
    /** The same buttons' tooltips (cards/stepping.ts, stepTitle): "Decrease by 0.1. With Shift, by 1." {amount} is the step; the Shift sentence is left out when the large step is the same. */
    decreaseBy: "Decrease by {amount}.",
    increaseBy: "Increase by {amount}.",
    withShift: " With Shift, by {amount}.",
    /** An amount with its unit, "5 %". */
    amountWithUnit: "{step} {unit}",
  },

  blocks: {
    /** The basis groups stepper on a card's Response section, for a screen reader (cards/code-blocks.tsx). */
    name: "Basis groups",
  },

  brush: {
    /** The brush on one line (canvas/brush-palette.tsx): the two glyphs' names and the choice's name. */
    paint: "Paint",
    erase: "Erase",
    stroke: "Paint or erase",
    /** The size and opacity groups: their tooltips and their steppers' names. */
    sizeTitle: "Size: how far the round brush reaches",
    sizeName: "brush size",
    opacityTitle: "Opacity: the strength one stroke adds at its center",
    opacityName: "brush opacity",
  },

  lock: {
    /** The lock between Response and Appearance (canvas/lock-square.tsx): its name and tooltip, closed and open. */
    linked: "Response and Appearance paint together: unlock to paint them separately",
    unlinked: "Response and Appearance paint separately: lock to paint them together",
  },

  palette: {
    /** The response target's controls under a card's response space (detail/palette-controls.tsx). A region is a response selection. */
    kindName: "Response target kind",
    kinds: { point: "Point", path: "Path", region: "Selection" },
    /** The radius slider's label, {radius} its value, and its name for a screen reader. */
    radius: "Target radius ×{radius}",
    radiusName: "Target radius multiplier",
    /** A response selection's two fields, and their names for a screen reader. */
    selectionRadius: "Selection radius",
    selectionRadiusName: "Selection radius in response units",
    coverage: "Coverage",
    coverageName: "Selection coverage weight",
    /** Under a response selection's fields. */
    recorded: "{selected} recorded targets of {points} points · drag the sphere edge to select more. The multiplier scales the selected response vectors.",
    /** A path's two buttons; {endpoint} is A or B, then its cell. A path's ends are endpoints, not reference patches. */
    pickAnchor: "Pick endpoint {endpoint} ({row}, {column})",
  },

  canvas: {
    name: "Painting canvas",
    /** Over the image while a path endpoint is picked (canvas/creation-canvas.tsx); {endpoint} is A or B. */
    anchorHint: "Click a grid cell for endpoint {endpoint}.",
    cancel: "Cancel",
    /** Over the image while the held token waits for its first stroke. */
    held: "paint where the new constraint goes",
    /** The empty image's one line; a finger taps where a mouse drags. */
    emptyFine: "Open a basis group in the Index and send one of its patches here.",
    /** Under the canvas when a link's reference patch (reference-link.ts) could not be opened. {message} is the error's own. */
    linkProblem: "The link's reference patch could not be opened: {message}",
    emptyCoarse: "Open a basis group in the Index and send one of its patches here.",
  },

  objective: {
    /** The objective column (objective/objective-column.tsx): its name for a screen reader. */
    name: "Objective",
    /** The movement figure at its head: the label, and the unit after the number. */
    movement: "movement",
    perUpdate: "per update",
    /** In place of the rows when no term is on. */
    noTerm: "no term is on",
    /** Beside the total. */
    total: "Total: the terms above, each times its weight.",
    /** The minimap and the movement map, for a screen reader. */
    minimap: "Response vectors of the measured tokens and the token's response vector",
    movementMap: "How much each cell's pixels changed in the latest optimizer update",
  },

  codeSpace: {
    /** The line under a card's response space (detail/card-code-space.tsx): what the dots are, for a painted area or a CLS or storage token. */
    paintedDots: "● a painted cell's response vector",
    tokenDots: "● the image's {token}'s response vector",
    /** Then what to drag: for a point target, after the ring's legend; for a path or response selection, the rings. */
    dragPoint: "{legend} · drag it to another token",
    dragRings: "drag the labelled rings along the recorded response plot",
    /** The two measures at the line's end; each number is in bold. */
    distance: "Distance {distance} · Spread {spread}",
    /** The 3-D view, for a screen reader. */
    name: "Response space of basis group {block}: the token's response vector, the measured response vectors and the basis group's recorded response vectors",
    /** The chip that moves a point target to a random recorded token, its tooltip, and the line when that fails. */
    random: "Random token",
    randomTitle: "A random recorded token of basis group {block} becomes the target",
    moveFailed: "The new token's basis groups did not load; the target stays.",
  },

  settings: {
    /** The run settings under the transport (run-settings.tsx), for a screen reader. */
    name: "Run settings",
  },

  model: {
    /** Under the transport before the first load in this browser (run/model-download.ts, MODEL_LINE). {mb} is the download's size in MB. */
    line: "Painting needs the DINOv3 model in your browser, about {mb} MB. Model files are cached for up to two weeks. It runs on your graphics card and nothing leaves your machine.",
  },
} as const;
