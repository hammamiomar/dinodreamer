/** "1 image", "2 images", "16,384 blocks". */
export function count(value: number, noun: string, plural = `${noun}s`): string {
  return `${value.toLocaleString()} ${value === 1 ? noun : plural}`;
}

const COMPACT = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

/** "1.1 M", "42": a figure for a caption, with a space before its magnitude letter. */
export function compactFigure(value: number): string {
  return COMPACT.format(value).replace(/(\d)([KMBT])$/, "$1 $2");
}

/** "1.1 M pictures", "42 tokens", "1 token": a figure with its unit. */
export function compactCount(value: number, noun: string, plural = `${noun}s`): string {
  return `${compactFigure(value)} ${value === 1 ? noun : plural}`;
}
