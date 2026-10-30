// Stride, detail and far view edit recipe.optimizer without resetting Adam.
// Explanations open in their click order without moving the canvas. On wide layouts
// the stack uses the space below the settings, or opens above if that space is too
// short. While open its placement stays fixed; on narrow layouts each explanation
// follows its setting. editor.css handles the layout, and the hooks measure available
// space and scroll a newly opened explanation into view.

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode, RefObject } from "react";
import type { Optimizer } from "../../recipe";
import { ExplainButton, ExplanationReveal, type Explanation } from "../../ui/explain";
import { Segmented } from "../../ui/segmented";
import { TermSwitch } from "./cards/term-row";
import { DETAIL_POSITIONS, RUN_SETTING_TEXT, STRIDE_POSITIONS } from "./presentation";
import { CREATE_TEXT } from "./create-text";

/** The settings in the order of the row, and of the lines on a phone. */
const SETTINGS = ["step", "scale", "robustView"] as const;
export type RunSettingKey = (typeof SETTINGS)[number];

/**
 * The open texts and each text's slot in the stack. Opening a text puts it at the bottom;
 * closing one leaves it in its slot, where it collapses, so the texts below it rise.
 */
export interface TextStack {
  open: readonly RunSettingKey[];
  slot: Record<RunSettingKey, number>;
  /** The slot the next opened text takes. */
  next: number;
}

export const CLOSED_STACK: TextStack = { open: [], slot: { step: 0, scale: 0, robustView: 0 }, next: 1 };

export function toggleText(stack: TextStack, key: RunSettingKey): TextStack {
  if (stack.open.includes(key)) return { ...stack, open: stack.open.filter((open) => open !== key) };
  return { open: [...stack.open, key], slot: { ...stack.slot, [key]: stack.next }, next: stack.next + 1 };
}

/** The texts' box ends this far above the stage's bottom edge. In CSS pixels. */
const TEXTS_BOTTOM_MARGIN = 8;
/** How long the box follows a text that opens: the reveal's 240 ms (styles.css --motion-move) and a frame or two. */
const FOLLOW_OPENING_MS = 320;

export function RunSettings({ optimizer, onChange }: { optimizer: Optimizer; onChange(change: Partial<Optimizer>): void }) {
  const [stack, setStack] = useState(CLOSED_STACK);
  const section = useRef<HTMLElement>(null);
  const texts = useRef<HTMLDivElement>(null);
  const place = useTextsPlace(section, texts, stack.open.length);
  useFollowOpenedText(texts, stack.open.length);
  const ids: Record<RunSettingKey, string> = { step: useId(), scale: useId(), robustView: useId() };
  const explanation = (key: RunSettingKey): Explanation => ({
    open: stack.open.includes(key),
    toggle: () => setStack((current) => toggleText(current, key)),
    id: ids[key],
  });
  const controls: Record<RunSettingKey, ReactNode> = {
    step: (
      <Segmented
        label={RUN_SETTING_TEXT.step.name}
        segments={STRIDE_POSITIONS.map((position) => ({ value: String(position.step), label: position.glyph, name: position.spoken }))}
        value={String(optimizer.step)}
        onChange={(value) => {
          const position = STRIDE_POSITIONS.find((candidate) => String(candidate.step) === value);
          if (position) onChange({ step: position.step });
        }}
      />
    ),
    scale: (
      <Segmented
        label={RUN_SETTING_TEXT.scale.name}
        segments={[
          { value: "even", label: DETAIL_POSITIONS.even },
          { value: "coarse", label: DETAIL_POSITIONS.coarse },
        ]}
        value={optimizer.scale}
        onChange={(value) => onChange({ scale: value })}
      />
    ),
    robustView: (
      <TermSwitch on={optimizer.robustView} label={RUN_SETTING_TEXT.robustView.name} onChange={(robustView) => onChange({ robustView })} />
    ),
  };
  return (
    <section ref={section} className="run-settings" aria-label={CREATE_TEXT.settings.name}>
      {SETTINGS.map((key, index) => (
        <RunSetting key={key} name={RUN_SETTING_TEXT[key].name} explanation={explanation(key)} line={2 * index}>
          {controls[key]}
        </RunSetting>
      ))}
      <div ref={texts} className="run-setting-texts" data-place={place}>
        {SETTINGS.map((key, index) => (
          <ExplanationReveal
            key={key}
            explanation={explanation(key)}
            style={{ "--line-order": 2 * index + 1, "--stack-order": stack.slot[key] } as CSSProperties}
          >
            <p>
              <span className="run-setting-name">{RUN_SETTING_TEXT[key].name}</span>
              {RUN_SETTING_TEXT[key].explanation}
            </p>
          </ExplanationReveal>
        ))}
      </div>
    </section>
  );
}

/** Where the texts open: below the settings, in the room the centring leaves, or above them as a panel. */
export type TextsPlace = "below" | "above";

/**
 * Measures the room under the settings, down to the stage's bottom edge, as --texts-room on
 * the section (the box below may fill it, editor.css), and chooses the texts' place: below
 * when the room holds all three texts, else above. It measures again whenever the stage or a
 * part of the centred block changes size, since either moves the settings. The place
 * follows the window but never changes while a text is open, so the stack never jumps; the
 * last text to shut lets it catch up.
 */
function useTextsPlace(section: RefObject<HTMLElement | null>, texts: RefObject<HTMLDivElement | null>, openCount: number): TextsPlace {
  const [place, setPlace] = useState<TextsPlace>("below");
  const anyOpen = useRef(openCount > 0);
  useLayoutEffect(() => {
    anyOpen.current = openCount > 0;
  }, [openCount]);
  const measure = useRef(() => {});
  useLayoutEffect(() => {
    const element = section.current;
    const box = texts.current;
    const stage = element?.closest(".create-stage");
    if (!element || !box || !stage) return;
    measure.current = () => {
      const room = Math.max(0, Math.floor(stage.getBoundingClientRect().bottom - element.getBoundingClientRect().bottom - TEXTS_BOTTOM_MARGIN));
      element.style.setProperty("--texts-room", `${room}px`);
      if (anyOpen.current) return;
      // Only the centred stage (1280 px and wider) makes the stack a box of its own; where the stage flows, it stays below.
      const centred = getComputedStyle(box).position === "absolute";
      // A text's full height, shut or open: its content overflows its collapsed box.
      const needed = [...box.querySelectorAll(".explanation")].reduce((sum, text) => sum + text.scrollHeight, 0);
      setPlace(centred && needed > room ? "above" : "below");
    };
    measure.current();
    const observer = new ResizeObserver(() => measure.current());
    observer.observe(stage);
    for (const part of stage.children) observer.observe(part);
    return () => observer.disconnect();
  }, [section, texts]);
  useEffect(() => {
    if (openCount === 0) measure.current();
  }, [openCount]);
  return place;
}

/**
 * A newly opened text is the stack's last; while it eases open, the box keeps its bottom in
 * view. Only the box scrolls, never the stage, so the canvas does not move. Where the box
 * does not scroll (the texts fit, or the stage flows), setting its scroll does nothing.
 */
function useFollowOpenedText(texts: RefObject<HTMLDivElement | null>, openCount: number) {
  const before = useRef(openCount);
  useEffect(() => {
    const opened = openCount > before.current;
    before.current = openCount;
    const box = texts.current;
    if (!opened || !box) return;
    const end = performance.now() + FOLLOW_OPENING_MS;
    let frame = 0;
    const follow = () => {
      box.scrollTop = box.scrollHeight;
      if (performance.now() < end) frame = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(frame);
  }, [texts, openCount]);
}

/** One setting: its name and "?", then its control. `line` is its place among the lines and their texts on a phone. */
function RunSetting({ name, explanation, line, children }: { name: string; explanation: Explanation; line: number; children: ReactNode }) {
  return (
    <div className="run-setting" style={{ "--line-order": line } as CSSProperties}>
      <span className="run-setting-head">
        <span className="label">{name}</span>
        <ExplainButton explanation={explanation} subject={name} />
      </span>
      {children}
    </div>
  );
}
