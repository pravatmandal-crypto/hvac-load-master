/**
 * Room-input fingerprint for staleness detection.
 * ────────────────────────────────────────────────────────────────────────────
 * The Load Calculator persists each room's `_calc*` results to Firestore, and
 * Equipment Selection / PDF / Excel read those SAVED values. If a room's inputs
 * (geometry, gains, envelope, fresh-air, safety %…) change but the room is never
 * re-saved, the saved loads silently go stale — reports & equipment sizing then
 * use old numbers. (This is exactly how a whole project can drift low.)
 *
 * `computeRoomInputSig` builds a compact fingerprint of every input that affects
 * a room's load. It is written to `_calcInputSig` when the room is saved, and the
 * LoadCalculator staleness banner recomputes it on open — a mismatch (or a missing
 * fingerprint on legacy rooms) means the saved data no longer matches the inputs.
 *
 * Design conditions are intentionally NOT part of this fingerprint: project-level
 * condition changes are already handled by the auto-recompute-on-condition-change
 * effect, and DOAS-supply drift by the existing `_calcTfaSupplyKey` detector. This
 * fingerprint covers the remaining gap — room-intrinsic input drift.
 *
 * Bump CALC_VERSION whenever the load-engine math changes so every room re-flags
 * as stale and gets recomputed (generalises the hand-written engine-change traps).
 */

export const CALC_VERSION = 1;

/** Short, stable djb2 hash → base36 string. Keeps the persisted fingerprint tiny. */
function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Normalise a numeric input to 3 decimals so float jitter never false-flags a room. */
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0;
};

/**
 * Fingerprint of one envelope element — ONLY the fields the envelope engine actually
 * reads (envelope.ts): type, area, uValue, orientation, shgc, isOverride, and (when
 * overridden) solarFactor. Reading only these — instead of every key — keeps the sig
 * stable against incidental in-memory fields the UI attaches to elements (auto-recomputed
 * solarFactor on non-override elements, selection flags, etc.) that don't affect the load.
 * `solarFactor` is included only when `isOverride` is true, because that's the sole case
 * the engine uses the stored value (otherwise it derives CLTD/SHGF from orientation).
 */
function elementFingerprint(el: Record<string, any>): string {
  const parts = [
    `t=${el.type ?? ''}`,
    `a=${num(el.area)}`,
    `u=${num(el.uValue)}`,
    `o=${el.orientation ?? ''}`,
    `c=${el.color ?? ''}`,
    `s=${num(el.shgc)}`,
    `ov=${el.isOverride ? 1 : 0}`,
    ...(el.isOverride ? [`sf=${num(el.solarFactor)}`] : []),
  ];
  return parts.join(',');
}

export interface RoomSigInput {
  /** The room document (raw stored fields — same object the LC holds in state). */
  room: Record<string, any> | null | undefined;
  /** The room's envelope elements. */
  elements: Array<Record<string, any>> | null | undefined;
}

/**
 * Fingerprint of every room-intrinsic input the load engine reads. MUST be computed
 * identically at save time (to stamp `_calcInputSig`) and at detection time (to compare)
 * — so it reads only raw stored room fields, never a derived/resolved value.
 */
export function computeRoomInputSig(input: RoomSigInput): string {
  return roomSigParts(input).sig;
}

/** Debug variant — returns the raw fingerprint parts alongside the hash, for diffing. */
export function roomSigParts({ room, elements }: RoomSigInput): { sig: string; roomPart: string; elemPart: string } {
  const r = room ?? {};
  const roomPart = [
    // Geometry
    num(r.length), num(r.width), num(r.height),
    r.hasFalseCeiling ? 1 : 0, num(r.falseCeilingHeight),
    // Fresh air / supply-air basis
    num(r.facph), num(r.recircPct), r.supplyCfmBasis ?? '', r.achProfile ?? '',
    // Internal gains
    num(r.peopleCount), r.activityType ?? '',
    num(r.lightsWattsPerSqft), num(r.equipmentKW), num(r.othersKW),
    // Slab / ground
    r.isGroundFloor ? 1 : 0, num(r.slabPerimeter), num(r.slabFFactor),
    // Parasitic + safety factors
    num(r.ductGainPct), num(r.fanGainPct),
    num(r.sensibleSafetyPercent ?? r.sensibleSafetyFactor),
    num(r.latentSafetyPercent ?? r.latentSafetyFactor),
    num(r.overallSafetyPercent ?? r.grandTotalSafetyFactor),
    // TFA / DOAS routing (supply-setting drift handled separately by _calcTfaSupplyKey)
    r.tfaMode ?? '', r.doasId ?? '',
  ].join('~');

  const elemPart = (elements ?? [])
    .map(elementFingerprint)
    .sort()
    .join('|');

  return { sig: `v${CALC_VERSION}:${hashString(roomPart + '||' + elemPart)}`, roomPart, elemPart };
}
