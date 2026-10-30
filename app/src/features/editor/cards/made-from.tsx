// A miniature provenance bar shared by editor and Atlas cards. Meters clip shares
// to 0–100%; editor cards also show signed numbers. Unstable CLS or storage shares
// show numbers without meters. Cards without numbers keep the clipped meters.

import { useLibrary } from "../../../app/library-session";
import { SOURCE_PARTS, provenanceOf, sourceParts, unstableParts } from "../../../library/provenance";
import type { Provenance } from "../../../library/records";
import { slotLibraryRole, type LibraryRole } from "../../../library/roles";
import type { Token } from "../../../recipe";
import { formatShare, PROVENANCE, SOURCE_PART_NAMES } from "../../../ui/glossary";
import { useLoaded } from "../../../ui/use-loaded";
import "./made-from.css";

/** A share as a meter's fill: a negative share fills nothing, one above 100 % the whole track. */
function meterFill(share: number): number {
  return Math.min(Math.max(share, 0), 1);
}

export function MadeFromBar({ provenance, role, numbers = true }: { provenance: Provenance; role: LibraryRole; numbers?: boolean }) {
  const parts = sourceParts(provenance);
  // Unstable parts read as numbers only, where there are numbers.
  const meters = !numbers || !unstableParts(parts, role);
  return (
    <section className="made-from" data-numbers={numbers || undefined} aria-label={PROVENANCE.name} title={PROVENANCE.definition}>
      <span className="label made-from-head">{PROVENANCE.name}</span>
      <ul data-unstable={!meters || undefined}>
        {parts.map(({ part, share }) => (
          <li key={part}>
            <span className="label">{SOURCE_PART_NAMES[part]}</span>
            {numbers && <b className="mono">{formatShare(share)}</b>}
            {meters && (
              <span className="made-from-meter" aria-hidden="true">
                <i style={{ width: `${meterFill(share) * 100}%` }} />
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The Canvas card's bar: it loads the block's provenance for the role of the request's
 * source token. While it loads, and where the release has none or it cannot be read, the
 * five rows hold their place with dashes (PendingMadeFrom), so a new card has its final
 * height at once, even on a slow network. The bar is context: the request
 * works the same without it.
 */
export function MadeFrom({ block, source }: { block: number; source: Token }) {
  const library = useLibrary();
  const file = useLoaded(block, () => library.provenance(block));
  const role = slotLibraryRole(source.slot);
  const provenance = file.status === "ready" ? provenanceOf(file.value, role) : null;
  if (!provenance) return <PendingMadeFrom />;
  return <MadeFromBar provenance={provenance} role={role} />;
}

/** The bar's five rows before their numbers: each name, a dash and an empty meter, at the same 16 px a row. */
function PendingMadeFrom() {
  return (
    <section className="made-from" data-numbers aria-label={PROVENANCE.name} aria-busy="true" title={PROVENANCE.definition}>
      <span className="label made-from-head">{PROVENANCE.name}</span>
      <ul>
        {SOURCE_PARTS.map((part) => (
          <li key={part}>
            <span className="label">{SOURCE_PART_NAMES[part]}</span>
            <b className="mono">—</b>
            <span className="made-from-meter" aria-hidden="true">
              <i style={{ width: 0 }} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
