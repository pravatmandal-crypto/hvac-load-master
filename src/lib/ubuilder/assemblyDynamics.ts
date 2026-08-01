/**
 * Resolving a U Builder assembly's dynamic response onto envelope elements.
 *
 * WHY THIS EXISTS. `getCLTD` damps the solar term using `element.decrementFactor`, which the
 * RoomTable assembly picker denormalises onto the element when you choose an assembly — the
 * same way `uValue` is copied. Elements assigned an assembly BEFORE that field existed carry
 * only `wallTypeId`, so they silently keep the light-construction CLTD until someone re-picks
 * the assembly from the dropdown.
 *
 * Backfilling inside a presentation component is NOT sufficient, and getting that wrong is
 * the worst possible failure mode: the read-out on screen damps correctly while the report,
 * Excel export, analysis snapshot and Recompute-All all read the raw Firestore elements and
 * silently do not. The numbers look verified and are not. (Tezpur GURT R3: Avionics Store
 * printed roof CLTD 36.98 in the report against 18.47 on screen, for exactly this reason.)
 *
 * So resolve at the SOURCE — where envelope elements enter the page — and every consumer
 * downstream inherits it. The Firestore subscription lives in ./useAssemblyDynamics; this
 * module stays pure so the resolution logic is testable without Firebase.
 */

import { calcThermalDynamics } from './calculations';

export interface AssemblyDynamics {
  decrementFactor?: number;
  arealMass?: number;
}

/** wallTypeId (the u_assemblies doc id) → its dynamic response. */
export type AssemblyDynamicsMap = Map<string, AssemblyDynamics>;

/** An envelope element, narrowed to just what the backfill touches. */
export interface BackfillableElement {
  wallTypeId?: string;
  decrementFactor?: number | null;
  arealMass?: number | null;
}

/**
 * Fill in `decrementFactor` / `arealMass` from the assigned assembly where the element does
 * not already carry them. Returns the SAME array reference when nothing changed, so this is
 * safe to call inside a memo without invalidating downstream work on every render.
 */
export function backfillElements<T extends BackfillableElement>(
  elements: readonly T[],
  dynamics: AssemblyDynamicsMap,
): T[] {
  if (dynamics.size === 0 || elements.length === 0) return elements as T[];
  let changed = false;
  const out = elements.map((el) => {
    // Already resolved, or explicitly cleared to a catalog type (null) — leave it alone.
    if (el.decrementFactor != null || !el.wallTypeId) return el;
    const d = dynamics.get(el.wallTypeId);
    if (!d || d.decrementFactor == null) return el;
    changed = true;
    return { ...el, decrementFactor: d.decrementFactor, arealMass: d.arealMass };
  });
  return changed ? out : (elements as T[]);
}

/** Same, over the per-room map the Load Calculator holds. Preserves reference identity. */
export function backfillElementsByRoom<T extends BackfillableElement>(
  byRoom: Record<string, T[]>,
  dynamics: AssemblyDynamicsMap,
): Record<string, T[]> {
  if (dynamics.size === 0) return byRoom;
  let changed = false;
  const out: Record<string, T[]> = {};
  for (const [roomId, els] of Object.entries(byRoom)) {
    const next = backfillElements(els, dynamics);
    if (next !== els) changed = true;
    out[roomId] = next;
  }
  return changed ? out : byRoom;
}

/**
 * Build the lookup from raw u_assemblies docs. Docs saved before the dynamic-response fields
 * existed carry only `layers`, so recompute rather than dropping them to no damping.
 */
export function toDynamicsMap(
  docs: ReadonlyArray<{ id: string; data: Record<string, any> }>,
): AssemblyDynamicsMap {
  const m: AssemblyDynamicsMap = new Map();
  for (const { id, data } of docs) {
    let decrementFactor = data?.decrementFactor as number | undefined;
    let arealMass = data?.arealMass as number | undefined;
    if (decrementFactor == null && Array.isArray(data?.layers)) {
      const dyn = calcThermalDynamics(data.layers);
      decrementFactor = dyn.decrementFactor;
      arealMass = dyn.arealMass;
    }
    if (decrementFactor != null) m.set(id, { decrementFactor, arealMass });
  }
  return m;
}
