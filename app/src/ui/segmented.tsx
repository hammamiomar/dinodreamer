// A segmented control: one choice among a few, drawn as one rectangle of
// segments with the chosen one filled. For assistive technology and the keyboard
// it is a radio group: Tab reaches the chosen segment, the arrow keys move the
// choice and skip segments that are shown but unavailable.

import { Fragment, useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";

export interface Segment<T extends string> {
  value: T;
  /** The segment's text; markup only to swap a shorter text in at narrow widths. */
  label: ReactNode;
  /** The segment's accessible name, where its text is a glyph: "one half" for ½. */
  name?: string;
  /** Shown, but cannot be chosen. */
  unavailable?: boolean;
  /** Why an unavailable segment cannot be chosen: its tooltip. */
  reason?: string;
  /** Choosing it while it is chosen acts again (Random rolls another page). */
  repeatable?: boolean;
  /** Starts a group of its own, set apart from the segments before it by a gap and a vertical hairline. */
  apart?: boolean;
}

/** The segments in runs, each run starting at a segment set apart; one run when none is. */
export function segmentGroups<S extends { value: string; apart?: boolean }>(segments: readonly S[]): { start: number; segments: S[] }[] {
  const groups: { start: number; segments: S[] }[] = [];
  segments.forEach((segment, index) => {
    if (index === 0 || segment.apart) groups.push({ start: index, segments: [] });
    groups[groups.length - 1]!.segments.push(segment);
  });
  return groups;
}

/**
 * The segment an arrow key moves to: the next available one in `step` direction,
 * wrapping at the ends, or null when no other segment is available.
 */
export function stepChoice(segments: readonly { unavailable?: boolean }[], from: number, step: 1 | -1): number | null {
  for (let offset = 1; offset < segments.length; offset += 1) {
    const index = (((from + step * offset) % segments.length) + segments.length) % segments.length;
    if (!segments[index]!.unavailable) return index;
  }
  return null;
}

const STEPS: Record<string, 1 | -1> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

export function Segmented<T extends string>({
  label,
  segments,
  value,
  onChange,
}: {
  /** Names the group for assistive technology, e.g. "Token kind". */
  label: string;
  segments: readonly Segment<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const chosen = segments.findIndex((segment) => segment.value === value);
  // With no chosen segment, Tab still reaches the group through its first available segment.
  const focusable = chosen >= 0 ? chosen : segments.findIndex((segment) => !segment.unavailable);

  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const step = STEPS[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = stepChoice(segments, index, step);
    if (next === null) return;
    buttons.current[next]?.focus();
    onChange(segments[next]!.value);
  };

  const button = (segment: Segment<T>, index: number) => (
    <button
      key={segment.value}
      ref={(button) => {
        buttons.current[index] = button;
      }}
      type="button"
      role="radio"
      aria-checked={index === chosen}
      aria-label={segment.name}
      // Not `disabled`: a disabled button shows no tooltip, and the tooltip says why.
      aria-disabled={segment.unavailable || undefined}
      title={segment.unavailable ? segment.reason : undefined}
      data-repeatable={segment.repeatable || undefined}
      tabIndex={index === focusable ? 0 : -1}
      onClick={() => {
        if (!segment.unavailable && (index !== chosen || segment.repeatable)) onChange(segment.value);
      }}
      onKeyDown={(event) => onKeyDown(event, index)}
    >
      {segment.label}
    </button>
  );

  const groups = segmentGroups(segments);
  if (groups.length === 1) {
    return (
      <div className="segmented" role="radiogroup" aria-label={label}>
        {segments.map(button)}
      </div>
    );
  }
  // One radio group for assistive technology and the arrow keys, drawn as separate rectangles.
  return (
    <div className="segmented-groups" role="radiogroup" aria-label={label}>
      {groups.map((group) => (
        <Fragment key={group.start}>
          {group.start > 0 && <span className="segmented-divider" aria-hidden="true" />}
          <div className="segmented">{group.segments.map((segment, offset) => button(segment, group.start + offset))}</div>
        </Fragment>
      ))}
    </div>
  );
}
