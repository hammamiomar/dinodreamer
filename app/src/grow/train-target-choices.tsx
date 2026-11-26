// Train with nothing to train toward offers three ways to a basis group in the target's place:
// a group at random, the Index, and the visitor's own picture. After a draw at random, another draw
// sits beside the way to another patch. No choice prefers a group that trains well.

import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { SITE_WORDS } from "../app/site-words";
import { indexPath } from "../features/atlas/atlas-position";
import { ChoosePictureButton } from "../features/look/picture-entry";
import { trainPath } from "../features/look/strongest-request";
import { DRAWN_AT_RANDOM, randomGroup } from "./random-group";

const WORDS = SITE_WORDS.grow.targetChoices;

type TargetDoorKind = "random" | "index" | "picture";

/** Opens Train on a basis group drawn when it is pressed, never `current`. */
function RandomGroupButton({ current, className = "grow-pick", children }: {
  current: number | null;
  className?: string;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const draw = () => navigate(trainPath(randomGroup(Math.random(), current), location.search), { state: DRAWN_AT_RANDOM });
  return <button type="button" className={className} onClick={draw}>{children}</button>;
}

/** Crisp 1 px geometric 16 × 16 SVG glyph representing each training target entry mode. */
function TargetDoorGlyph({ kind }: { kind: TargetDoorKind }) {
  if (kind === "random") {
    return (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <rect x="2" y="2" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1" />
        <circle cx="5" cy="5" r="1" fill="currentColor" />
        <circle cx="11" cy="5" r="1" fill="currentColor" />
        <circle cx="8" cy="8" r="1" fill="currentColor" />
        <circle cx="5" cy="11" r="1" fill="currentColor" />
        <circle cx="11" cy="11" r="1" fill="currentColor" />
      </svg>
    );
  }
  if (kind === "index") {
    return (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <rect x="2" y="2" width="5" height="5" fill="none" stroke="currentColor" strokeWidth="1" />
        <rect x="9" y="2" width="5" height="5" fill="none" stroke="currentColor" strokeWidth="1" />
        <rect x="2" y="9" width="5" height="5" fill="none" stroke="currentColor" strokeWidth="1" />
        <rect x="9" y="9" width="5" height="5" fill="none" stroke="currentColor" strokeWidth="1" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <rect x="2" y="2" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1" />
      <polyline points="2,11 6,8 9.5,10.5 14,7" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.55" />
      <rect x="8.5" y="3.5" width="4" height="4" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

/** Shared interior layout for each target option card: title with geometric glyph over its hint. */
function TargetDoorBody({ title, hint, kind }: { title: string; hint: string; kind: TargetDoorKind }) {
  return (
    <>
      <span className="grow-target-door-head">
        <strong>{title}</strong>
        <span className="grow-target-door-mark">
          <TargetDoorGlyph kind={kind} />
        </span>
      </span>
      <span className="grow-target-door-hint">{hint}</span>
    </>
  );
}

/** The occurrence with no target: a quiet label and three 1 px-bordered entry cards. */
export function TrainTargetChoices() {
  return (
    <div className="grow-target-choices">
      <span className="label">{WORDS.lead}</span>
      <div className="grow-target-doors">
        <RandomGroupButton current={null} className="grow-target-door">
          <TargetDoorBody title={WORDS.random} hint={WORDS.randomHint} kind="random" />
        </RandomGroupButton>
        <Link className="grow-target-door" to={indexPath()}>
          <TargetDoorBody title={WORDS.index} hint={WORDS.indexHint} kind="index" />
        </Link>
        <ChoosePictureButton className="grow-target-door">
          <TargetDoorBody title={WORDS.picture} hint={WORDS.pictureHint} kind="picture" />
        </ChoosePictureButton>
      </div>
    </div>
  );
}

/** Beside the way to another patch, after a draw at random or for a group Train cannot start: another group at random. */
export function AnotherRandomGroup({ block }: { block: number }) {
  return <RandomGroupButton current={block} className="grow-pick">{WORDS.another}</RandomGroupButton>;
}
