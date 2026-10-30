/**
 * Copy for the Painter landing page at /canvas, linked from the Experimental menu.
 */
export const CANVAS_TEXT = {
  /** The page's name, its heading. */
  label: "Painter · experimental",
  /** The one-line takeaway under it. */
  claim: "Paint where a chosen patch's point should appear, and the picture grows from noise until DINO reads it there.",
  /** Three short paragraphs: what it is, what keeps the picture a picture, where it runs. */
  paragraphs: [
    "This was the site's first tool, and it stays an experiment: a cellular automaton shows a basis group better. It is feature visualization in the classic form, with a brush: you paint the cells that should carry the point. The picture starts as noise. Every update DINO reads it, the featurizer measures the painted cells in one basis group, and the loss is the distance from their mean point to the point you chose. The pixels move to shrink it; DINO never changes.",
    "Two terms keep the picture a picture. Smoothness holds neighboring pixels close, and Restraint holds every pixel near the average color of DINO's training pictures. An Appearance term can borrow the look of reference pictures, by sorting their values rather than copying any patch.",
    "It runs on your graphics card, in the browser, and nothing leaves your device unless you publish it. Open a basis group in the Index, choose a reference patch, and send it here.",
  ],
  /** The link to the paper the method comes from, in the first paragraph's words. */
  reference: { words: "feature visualization", url: "https://distill.pub/2017/feature-visualization/" },
  /** The way in: the Painter itself (/create), whose heading has the same word. */
  open: "Open the Painter",
} as const;
