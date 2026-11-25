// Train with nothing to train toward offers three ways to a basis group in the target's place:
// a group at random, the Index, and the visitor's own picture. After a draw at random, another draw
// sits beside the way to another patch. No choice prefers a group that trains well.

import { Link, useLocation, useNavigate } from "react-router";
import { SITE_WORDS } from "../app/site-words";
import { indexPath } from "../features/atlas/atlas-position";
import { ChoosePictureButton } from "../features/look/picture-entry";
import { trainPath } from "../features/look/strongest-request";
import { DRAWN_AT_RANDOM, randomGroup } from "./random-group";

const WORDS = SITE_WORDS.grow.targetChoices;

/** Opens Train on a basis group drawn when it is pressed, never `current`. */
function RandomGroupButton({ current, children }: { current: number | null; children: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const draw = () => navigate(trainPath(randomGroup(Math.random(), current), location.search), { state: DRAWN_AT_RANDOM });
  return <button type="button" className="grow-pick" onClick={draw}>{children}</button>;
}

/** The occurrence with no target: one line of words and the three choices. */
export function TrainTargetChoices() {
  return (
    <div className="grow-target-choices">
      <p>{WORDS.lead}</p>
      <RandomGroupButton current={null}>{WORDS.random}</RandomGroupButton>
      <Link className="grow-pick" to={indexPath()}>{WORDS.index}</Link>
      <ChoosePictureButton className="grow-pick">{WORDS.picture}</ChoosePictureButton>
    </div>
  );
}

/** Beside the way to another patch, after a draw at random or for a group Train cannot start: another group at random. */
export function AnotherRandomGroup({ block }: { block: number }) {
  return <RandomGroupButton current={block}>{WORDS.another}</RandomGroupButton>;
}
