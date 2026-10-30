/** Copy for saved images on the Image editor landing page. */
export const SAVED_TEXT = {
  // The section's head.
  title: "Yours",
  lead: "Your paintings stay in this browser. Clearing site data removes them. Export one to keep a copy.",
  importButton: "Import an image…",

  // The lines under the head.
  reading: "Reading saved images…",
  failed: (message: string) => `Saved images could not be read: ${message}`,
  none: "No images are saved yet. Your image is saved as you work on it.",
  /** After an import; the second form names what the draft still needs before it can run. */
  imported: (file: string) => `Imported ${file}.`,
  importedNeeds: (file: string, problems: string) => `Imported ${file}. Before it can run: ${problems}`,
  deleted: (title: string) => `Deleted “${title}”.`,

  // A saved image (CreationCard).
  openName: (title: string) => `Open ${title}`,
  /** After the date: the engine the image was made with. */
  engine: (engine: string) => ` · engine ${engine}`,
  otherRelease: (release: string, served: string) => `Made with release ${release}. This site serves ${served}.`,
  /** {reason} is storage/creations.ts UPGRADED_IMAGE_REASON's phrase. */
  upgraded: (reason: string) => `The image was made with ${reason}. Open and run it to make a new one.`,
  open: "Open",
  opening: "Opening…",
  exportButton: "Export",
  png: "PNG",
  deleteAsk: "Delete…",
  deleteConfirm: "Delete",
  keep: "Keep",
  renameName: (title: string) => `Rename ${title}`,
  titleField: "Title",

  // Records this version cannot read (UnreadableCard).
  unreadable: {
    name: "Unreadable images",
    title: "Unreadable",
    lead: "This version of the site cannot read these records. Export keeps each one exactly as it was stored.",
    problem: (problem: string) => `unreadable: ${problem}`,
  },
} as const;
