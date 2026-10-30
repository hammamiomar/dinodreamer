// The block-count stepper asks for the request's block plus its token's strongest
// other blocks. Increasing the count requires the token address to load first.
// Without address files, only requests that already ask multiple blocks show the
// control, so their count can still decrease.

import type { Dispatch } from "react";
import { useLibrary } from "../../../app/library-session";
import { MAX_CODE_BLOCKS, type Request } from "../../../recipe";
import { ExplainButton, ExplanationReveal, useExplanation } from "../../../ui/explain";
import { useLoaded } from "../../../ui/use-loaded";
import { codeBlockCount } from "../model";
import { BLOCKS_TEXT } from "../presentation";
import type { EditorAction } from "../state";
import { Stepper } from "./stepper";
import type { StepRule } from "./stepping";
import { CREATE_TEXT } from "../create-text";

/** One block a press; Shift adds a quarter of the address. */
const BLOCKS_STEPS: StepRule = { step: 1, largeStep: 8, min: 1, max: MAX_CODE_BLOCKS };

export function CodeBlocks({ request, dispatch }: { request: Request; dispatch: Dispatch<EditorAction> }) {
  const library = useLibrary();
  const about = useExplanation();
  const { source } = request.respondLike;
  const address = useLoaded(`${source.imageId}:${source.slot}`, () => library.tokenAddress(source));
  const count = codeBlockCount(request);
  const ready = address.status === "ready" ? address.value : null;
  // Without the token's address the request can ask fewer blocks, never more.
  const rule = { ...BLOCKS_STEPS, max: request.respondLike.target.kind === "point" && ready ? MAX_CODE_BLOCKS : count };
  const reason = address.status === "absent" ? BLOCKS_TEXT.unavailable : address.status === "failed" ? BLOCKS_TEXT.failed : null;
  if (library.release.addresses === null && count === 1) return null;
  return (
    <div className="code-blocks" onClick={(event) => event.stopPropagation()}>
      <div className="code-blocks-line">
        <span className="label">{BLOCKS_TEXT.name}</span>
        <Stepper
          kind="blocks"
          value={count}
          label={CREATE_TEXT.blocks.name}
          subject={BLOCKS_TEXT.name}
          rule={rule}
          integer
          disabled={rule.min === rule.max}
          onCommit={(next) => dispatch({ type: "setCodeBlocks", requestId: request.id, count: Math.min(next, rule.max), address: ready })}
        />
        <ExplainButton explanation={about} subject={BLOCKS_TEXT.name} />
      </div>
      <ExplanationReveal explanation={about}>
        <p>{BLOCKS_TEXT.definition}</p>
        {reason && <p>{reason}</p>}
      </ExplanationReveal>
    </div>
  );
}
