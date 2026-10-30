// The one control that chooses a library role, on the Atlas and the block page.
// All six roles are always shown in the same order, so the control keeps its
// shape; a role with no recorded tokens in the current block is unavailable.

import { LIBRARY_ROLES, ROLE_SHORT_LABELS } from "../library/roles";
import type { LibraryRole } from "../library/roles";
import { Segmented } from "./segmented";
import type { Segment } from "./segmented";

/** The six role segments; a role outside `available` is shown but unavailable. */
export function roleSegments(available: readonly LibraryRole[] = LIBRARY_ROLES): Segment<LibraryRole>[] {
  return LIBRARY_ROLES.map((role) => {
    const unavailable = !available.includes(role);
    return {
      value: role,
      label: ROLE_SHORT_LABELS[role],
      unavailable,
    };
  });
}

export function RoleChoice({
  value,
  available,
  onChange,
}: {
  value: LibraryRole;
  /** The roles that can be chosen; all six when absent. */
  available?: readonly LibraryRole[];
  onChange: (role: LibraryRole) => void;
}) {
  return <Segmented label="Token kind" segments={roleSegments(available)} value={value} onChange={onChange} />;
}
