// The colour picker edits both request tones while the lock is closed, or one term
// while it is open. Picks apply immediately. inks.ts defines the palette and derived
// Appearance tone; presentation.ts provides the labels.

import { useEffect, useId, useRef } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import { inkName, paletteFor, sameColour, toHex, type InkPair, type InkTarget } from "../inks";
import { INK_PICKER_TEXT, inkSwatchName } from "../presentation";

/** The twelve colours stand in two rows of six; the arrow keys move along a row or between the rows. */
const ROW = 6;
const STEPS: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: ROW, ArrowUp: -ROW };

/** The swatch beside a term's name. It opens the picker and leaves the selection as it is. */
export function InkSwatch({ target, pair, onOpen }: { target: InkTarget; pair: InkPair; onOpen(): void }) {
  const tone = target === "look" ? pair.look : pair.code;
  return (
    <button
      type="button"
      className="ink-swatch"
      data-split={target === "request" || undefined}
      aria-haspopup="dialog"
      aria-label={inkSwatchName(target, inkName(tone))}
      style={{ "--swatch": tone, "--swatch-look": pair.look } as CSSProperties}
      onClick={(event) => {
        // The section's click selects its term; the swatch only opens the picker.
        event.stopPropagation();
        onOpen();
      }}
    />
  );
}

/**
 * The picker for one request: for the request while its lock is closed (the Appearance tone
 * follows the pick), else for one term. First focus goes to the chosen colour; closing gives
 * focus back to the swatch. Escape closes the picker and nothing else.
 */
export function InkPicker({
  requestId,
  target,
  pair,
  onPick,
  onDefault,
  onClose,
}: {
  requestId: number;
  target: InkTarget;
  /** The request's two tones as they are now. */
  pair: InkPair;
  onPick(colour: string): void;
  onDefault(): void;
  onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const radios = useRef<(HTMLButtonElement | null)[]>([]);
  const titleId = useId();
  const term = target === "look" ? "look" : "respond";
  const colours = paletteFor(term);
  const tone = term === "look" ? pair.look : pair.code;
  const chosen = colours.findIndex((entry) => sameColour(entry.colour, tone));
  const focusable = chosen >= 0 ? chosen : 0;
  const hex = toHex(tone);

  useEffect(() => {
    const element = dialog.current!;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.showModal();
    radios.current[focusable]?.focus();
    return () => {
      if (element.open) element.close();
      if (opener?.isConnected) opener.focus();
    };
    // The first focus is where the picker opens; later picks keep focus where the keys put it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    // The page's Escape clears the selection; this one only closes the picker.
    if (event.key !== "Escape") return;
    event.preventDefault();
    onClose();
  };

  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = STEPS[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = (index + step + colours.length) % colours.length;
    radios.current[next]?.focus();
    onPick(colours[next]!.colour);
  };

  return (
    <dialog
      ref={dialog}
      className="ink-picker"
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
      onCancel={(event) => event.preventDefault()}
      onClick={(event) => {
        // The card behind does not see the picker's clicks; a click on the backdrop closes it.
        event.stopPropagation();
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="ink-picker-body">
        <header className="ink-picker-head">
          <h2 id={titleId}>{INK_PICKER_TEXT.title}</h2>
          <p className="label">
            Constraint {requestId} · {INK_PICKER_TEXT.context[target]}
          </p>
        </header>
        <div className="ink-picker-preview" aria-hidden="true">
          {target === "request" ? (
            <>
              <span className="ink-sample" style={{ "--tone": pair.code } as CSSProperties} />
              <span className="label">{INK_PICKER_TEXT.code}</span>
              <span className="ink-sample" style={{ "--tone": pair.look } as CSSProperties} />
              <span className="label">{INK_PICKER_TEXT.derived}</span>
            </>
          ) : (
            <>
              <span className="ink-sample" style={{ "--tone": tone } as CSSProperties} />
              <span className="label">{term === "look" ? INK_PICKER_TEXT.look : INK_PICKER_TEXT.code}</span>
            </>
          )}
        </div>
        <div className="ink-palette" role="radiogroup" aria-label={INK_PICKER_TEXT.palette}>
          {colours.map((entry, index) => (
            <button
              key={entry.name}
              ref={(button) => {
                radios.current[index] = button;
              }}
              type="button"
              role="radio"
              aria-checked={index === chosen}
              aria-label={entry.name}
              title={entry.name}
              tabIndex={index === focusable ? 0 : -1}
              style={{ "--swatch": entry.colour } as CSSProperties}
              onClick={() => onPick(entry.colour)}
              onKeyDown={(event) => move(event, index)}
            />
          ))}
        </div>
        <label className="ink-free label">
          {INK_PICKER_TEXT.free}
          <input type="color" value={hex} onChange={(event) => onPick(event.currentTarget.value)} />
          <span className="mono">{hex}</span>
        </label>
        <div className="ink-picker-actions">
          <button type="button" className="link-control" onClick={onDefault}>
            {INK_PICKER_TEXT.default}
          </button>
          <button type="button" className="button" onClick={onClose}>
            {INK_PICKER_TEXT.close}
          </button>
        </div>
      </div>
    </dialog>
  );
}
