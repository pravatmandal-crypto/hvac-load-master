/**
 * Room-input fingerprint for staleness detection.
 * ────────────────────────────────────────────────────────────────────────────
 * The Load Calculator persists each room's `_calc*` results to Firestore, and
 * Equipment Selection / PDF / Excel read those SAVED values. If a room's inputs
 * (geometry, gains, fresh-air, safety %…) change but the room is never re-saved,
 * the saved loads silently go stale — reports & equipment sizing then use old
 * numbers. (This is exactly how a whole project can drift low.)
 *
 * `computeRoomInputSig` builds a compact fingerprint of the room's deterministic
 * SCALAR inputs. It is written to `_calcInputSig` when the room is saved, and the
 * LoadCalculator staleness banner recomputes it on open — a mismatch (or a missing
 * fingerprint on legacy rooms) means the saved data no longer matches the inputs.
 *
 * Deliberately NOT in the fingerprint, to keep it 100% stable across a reload:
 *   • Envelope elements (not even the count) — they load asynchronously and the UI
 *     mutates the objects in memory (auto-recomputed solarFactor, selection flags),
 *     so any element-derived value re-flags every room on a cold load. Envelope
 *     add/remove/edit re-persist the room via their own handlers, so element changes
 *     are still captured.
 *   • Design conditions — handled by the auto-recompute-on-condition-change effect.
 *   • DOAS supply settings — handled by the existing `_calcTfaSupplyKey` detector.
 * This fingerprint covers the remaining gap: room-intrinsic scalar input drift.
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

export interface RoomSigInput {
  /** The room document (raw stored fields — same object the LC holds in state). */
  room: Record<string, any> | null | undefined;
  /**
   * The room's envelope elements. Only the COUNT enters the fingerprint — per-element
   * fields are deliberately excluded because the UI mutates element objects in memory
   * (auto-recomputed solarFactor, selection flags, etc.), which would make the sig
   * unstable across a reload and re-flag every room. Envelope EDITS re-persist the room
   * through their own handlers, so field-level element changes are still captured that way;
   * the count catches add/remove.
   */
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

  // Elements are intentionally NOT part of the fingerprint — not even the count.
  // Envelope element objects load asynchronously and the UI mutates them in memory,
  // so any element-derived value makes the sig differ between save-time and a cold
  // reload, re-flagging every room. Envelope add/remove/edit all re-persist the room
  // through their own handlers, so element changes are still captured that way. The
  // fingerprint therefore depends ONLY on the room's deterministic scalar inputs.
  const elemPart = `n=${(elements ?? []).length}`; // kept for the debug read-out only

  return { sig: `v${CALC_VERSION}:${hashString(roomPart)}`, roomPart, elemPart };
}
