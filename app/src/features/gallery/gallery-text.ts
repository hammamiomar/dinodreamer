/** Gallery and submission-form copy for the Image editor landing page. */
export const GALLERY_TEXT = {
  // The section's head (gallery-page.tsx), on the Painter's page.
  title: "Gallery",
  lead: "Visitors painted these with the Painter and submitted them. Open one to continue it there.",
  submit: "Submit your image…",

  // The lines under the head while the gallery is read, or when it has nothing.
  loading: "Loading the gallery…",
  failed: (message: string) => `The gallery is not available. ${message}`,
  empty: "Nothing is published yet.",

  // The gallery's reads and the submission's answer when they fail (gallery-api.ts); the page shows
  // them after "The gallery is not available." or under the form.
  fetch: {
    answered: (status: number) => `The gallery answered ${status}.`,
    noEntries: "The gallery index has no entries list.",
    entryField: (position: number, field: string) => `Gallery entry ${position} has no ${field}.`,
    recipeAnswered: (title: string, status: number) => `The image-editing configuration of “${title}” answered ${status}.`,
    noId: "The gallery accepted the submission but returned no id.",
    /** The Worker gave no message of its own: its status and the start of its answer. */
    refused: (status: number, text: string) => `The gallery refused the submission (${status})${text ? `: ${text}` : ""}.`,
  },

  // A picture opened (EntryDetail, a dialog).
  detail: {
    by: (credit: string) => `by ${credit}`,
    published: (date: string) => `Published ${date}`,
    open: "Open configuration",
    opening: "Opening…",
    close: "Close",
    note: "Opening the image-editing configuration replaces your image. Save your image first if you want to keep it.",
  },

  // Submitting a saved image (SubmitPanel).
  form: {
    title: "Submit your image",
    reading: "Reading saved images…",
    none: "Save your image first. Only saved images can be submitted.",
    /** The choice of saved images, for a screen reader. */
    choices: "Saved image",
    titleField: "Title",
    credit: "Credit",
    creditNote: "(optional, shown with the image)",
    public: "The image and its image-editing configuration become public if the submission passes review. The configuration names the library pictures it uses.",
    send: "Submit for review",
    sending: "Sending…",
    cancel: "Cancel",
    /**
     * What the form says before it posts (gallery-api.ts submissionProblems and creationProblems):
     * what the Worker would refuse, and an image an earlier objective made.
     */
    problems: {
      noTitle: "Give your image a title.",
      longTitle: (limit: number) => `The title is longer than ${limit} characters.`,
      longCredit: (limit: number) => `The credit is longer than ${limit} characters.`,
      largeImage: "The image is larger than 2 MB.",
      largeRecipe: "The image-editing configuration is larger than 64 KB.",
      recipe: (problem: string) => `Image-editing configuration: ${problem}.`,
      /** {reason} is storage/creations.ts UPGRADED_IMAGE_REASON's phrase. */
      remake: (reason: string) => `This image was made with ${reason}. Open it, run it again, and submit the new image.`,
    },
    /** After a submission; the reference follows it. */
    sent: "Sent. Your image appears in the gallery after review. Reference:",
    close: "Close",
  },
} as const;
