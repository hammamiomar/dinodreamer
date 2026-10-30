// Level 4 pictures from the public sample, with each patch marked. The current
// picture has an outline and a Train action in the row's heading, outside the image.
// A click, Enter or Space trains; touch and pen first select, then train on a second
// press. Hovering also rings the picture's point in the cloud.

import { useRef, useState } from "react";
import { GRID, PATCH_SLOT_OFFSET } from "../../recipe";
import { cloudTokenPicture, type CloudToken } from "./cloud-token";
import { LOOK_TEXT } from "./look-text";
import { TokenPicture } from "./token-pictures";

/** What pressed a picture: a mouse, a pen, a finger, or the keyboard (a click without a pointer). */
export type PicturePointer = "mouse" | "pen" | "touch" | "keyboard";

/**
 * What a press on a picture does. A mouse's hover and the keyboard's focus showed the line's word
 * before the press, so the press trains. A finger or a pen may not have shown it: its first press on
 * a picture makes that picture current ("arm"), and a press on the current picture trains.
 */
export function pictureAction(index: number, armed: number | null, pointer: PicturePointer): "train" | "arm" {
  const firstPressArms = pointer === "touch" || pointer === "pen";
  if (!firstPressArms || armed === index) return "train";
  return "arm";
}

function picturePointer(pointerType: string): PicturePointer {
  if (pointerType === "mouse" || pointerType === "pen" || pointerType === "touch") return pointerType;
  return "keyboard";
}

export function StrongestPictures({ indices, about, token, lit, onHover, onGrow }: {
  /** Page indices, the picture Grow a material grows toward first (leadingPictures). */
  indices: readonly number[];
  /** The band's estimated patches in the whole block, already rounded: "740". */
  about: string;
  token: (index: number) => CloudToken;
  /** The picture to outline: the one Grow a material grows toward, while it is hovered. */
  lit: number | null;
  onHover: (index: number | null) => void;
  onGrow: (index: number) => void;
}) {
  // The picture under the pointer (kept while the pointer crosses the gaps of the row), the one in
  // focus, and the one a finger's tap made current. The first of them is the current picture.
  const [pointed, setPointed] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const [armed, setArmed] = useState<number | null>(null);
  const current = focused ?? pointed ?? armed;
  // The pointer of the press under way. A cancelled press (a finger that scrolls) leaves none, and a
  // click with no pointer count (detail 0: Enter or Space) is the keyboard's whatever came before.
  const pressPointer = useRef<PicturePointer>("keyboard");

  function press(index: number, clickCount: number) {
    const pointer = clickCount === 0 ? "keyboard" : pressPointer.current;
    const action = pictureAction(index, armed, pointer);
    pressPointer.current = "keyboard";
    if (action === "train") onGrow(index);
    else setArmed(index);
  }

  return (
    <section className="look-fires" aria-labelledby="look-fires-title" data-current={current !== null || undefined}>
      <div className="look-group-head">
        <h2 id="look-fires-title" className="band strongest">{LOOK_TEXT.fires.title}</h2>
        <span className="look-count">{LOOK_TEXT.fires.about(about)}</span>
        {indices.length > 0 && <span id="look-fires-action" className="look-fires-action">{LOOK_TEXT.fires.growFrom}</span>}
      </div>
      {indices.length === 0 ? (
        <p className="muted">{LOOK_TEXT.fires.empty}</p>
      ) : (
        <ul className="look-pictures" onPointerLeave={() => setPointed(null)}>
          {indices.map((index) => {
            const point = token(index);
            const cell = point.slot - PATCH_SLOT_OFFSET;
            return (
              <li key={index} className="look-picture" data-current={current === index || undefined} data-lit={lit === index || undefined}
                onPointerEnter={() => {
                  setPointed(index);
                  onHover(index);
                }}
                onPointerLeave={() => onHover(null)}>
                <button type="button" className="look-picture-face" aria-describedby="look-fires-action"
                  aria-label={LOOK_TEXT.fires.picture(cloudTokenPicture(point), cell % GRID + 1, Math.floor(cell / GRID) + 1)}
                  onPointerDown={(event) => {
                    pressPointer.current = picturePointer(event.pointerType);
                  }}
                  onPointerCancel={() => {
                    pressPointer.current = "keyboard";
                  }}
                  onClick={(event) => press(index, event.detail)}
                  onFocus={() => {
                    setFocused(index);
                    onHover(index);
                  }}
                  onBlur={() => {
                    setFocused(null);
                    onHover(null);
                  }}>
                  <TokenPicture point={point} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
