// Tangible attribution plaque ("Maker Card") shared across Home Beat 3, the Publish form's live
// preview, and the Automata stage (`replay/material-stage.tsx`).
//
// Tentative basis-group label proposals are intentionally omitted here: when a maker provides a
// custom title, the card leads with their title; otherwise it leads cleanly with `Basis group N`.

import type { CSSProperties, ReactNode } from "react";
import { fill, SITE_WORDS } from "../app/site-words";
import { ownTitle } from "./material-facts";
import "./maker-card.css";

export interface MakerCardInput {
  block: number;
  /** Raw title stored on the entry or typed in the publish form. */
  title: string;
  /** File's internal definition name (`file.name`), used so research run IDs are not treated as human titles. */
  definitionName?: string;
  /** Maker credit stored on the entry or typed in the publish form. */
  credit: string;
  /** Short plain description of the grids/start (for example, "coarse + fine, from a noise field"). */
  detail?: string | null;
  /** Optimizer updates completed during training, if known. */
  updates?: number | null;
  /** Whether the automaton is published (or being previewed for publication) under Apache 2.0. */
  published?: boolean;
  /** Live form preview mode: shows gentle placeholders before the maker types a title or credit. */
  preview?: boolean;
}

export interface MakerCardView {
  heading: string;
  headingPlaceholder: boolean;
  creditLine: string | null;
  creditPlaceholder: boolean;
  facts: string[];
}

const LICENSE_FACT = "Apache 2.0";

/**
 * Pure presentation policy for the Maker Card across all three surfaces (Home, Publish preview,
 * and Automata stage). Tested directly in `maker-card.test.ts`.
 */
export function resolveMakerCardView(input: MakerCardInput): MakerCardView {
  const trimmedTitle = input.title.trim();
  const humanTitle = input.definitionName !== undefined
    ? ownTitle(trimmedTitle, { name: input.definitionName })
    : trimmedTitle;
  const trimmedCredit = input.credit.trim();
  const groupLabel = fill(SITE_WORDS.stage.readingBlock, { block: input.block });

  let heading: string;
  let headingPlaceholder = false;
  const facts: string[] = [];

  if (humanTitle !== "") {
    heading = humanTitle;
    facts.push(groupLabel);
  } else {
    heading = groupLabel;
    if (input.preview) headingPlaceholder = true;
  }

  if (input.detail) facts.push(input.detail);
  if (typeof input.updates === "number" && Number.isFinite(input.updates) && input.updates > 0) {
    facts.push(`${input.updates.toLocaleString("en-US")} updates`);
  }
  if (input.published || input.preview) {
    facts.push(LICENSE_FACT);
  }

  let creditLine: string | null = null;
  let creditPlaceholder = false;
  if (trimmedCredit !== "") {
    creditLine = `Made by ${trimmedCredit}`;
  } else if (input.preview) {
    creditLine = "Your name appears here (optional)";
    creditPlaceholder = true;
  }

  return {
    heading,
    headingPlaceholder,
    creditLine,
    creditPlaceholder,
    facts,
  };
}

export function MakerCard({
  block,
  title,
  definitionName,
  credit,
  detail,
  updates,
  published = true,
  preview = false,
  accent,
  action,
  label,
}: MakerCardInput & {
  /** Optional sampled colour CSS value (`--sampled`); inherits from parent stage when omitted. */
  accent?: string | null;
  /** Optional right-aligned link or button (for example, opening the piece on `/automata`). */
  action?: ReactNode;
  /** Optional quiet eyebrow above the title (for example, "Gallery plaque preview"). */
  label?: string;
}) {
  const view = resolveMakerCardView({
    block,
    title,
    definitionName,
    credit,
    detail,
    updates,
    published,
    preview,
  });
  const style = accent ? ({ "--sampled": accent } as CSSProperties) : undefined;

  return (
    <aside className="maker-card" style={style} aria-label={label ?? view.heading}>
      {label && <span className="label maker-card-eyebrow">{label}</span>}
      <div className="maker-card-head">
        <div className="maker-card-identity">
          <p className="maker-card-title" data-placeholder={view.headingPlaceholder || undefined}>
            {view.heading}
          </p>
          {view.creditLine && (
            <p className="maker-card-credit" data-placeholder={view.creditPlaceholder || undefined}>
              {view.creditLine}
            </p>
          )}
        </div>
        {action && <div className="maker-card-action">{action}</div>}
      </div>
      {view.facts.length > 0 && (
        <p className="maker-card-facts">
          {view.facts.join(" · ")}
        </p>
      )}
    </aside>
  );
}
