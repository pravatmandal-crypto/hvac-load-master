/**
 * Shared TFA / DOAS resolver — the single source of truth for "is this room served
 * by a TFA/DOAS unit, and in what mode?". Replaces the per-component copies that
 * previously lived in EquipmentSelection, LoadCalculator, ZoneList and reportService
 * (their drift caused most of the TFA reconciliation bugs).
 *
 * Simplified model (2026-06-01): `room.tfaMode` is the PRIMARY driver. A single
 * project-level DOAS exists; a room is TFA-served when its mode says so and a DOAS
 * exists — no manual zone-linking required. The legacy doasLinkedSystemIds /
 * doasLinkedZoneIds path is kept as a fallback for rooms whose mode is unset
 * (`inherit`) so existing projects keep working until the Phase-3 backfill.
 */

export type ResolvedTfaMode = 'no-tfa' | 'tfa-served' | 'tfa-only';

/** The project's single TFA/DOAS system, if one has been created. */
export const getProjectDoas = (equipSystems: any[] | undefined | null): any | null =>
  (equipSystems ?? []).find((s: any) => s?.type === 'DOAS') ?? null;

/** Legacy detection: room's primary system or zone is in a DOAS's link arrays. */
const findDoasByLink = (room: any, equipSystems: any[] | undefined | null): any | null => {
  const sysId = room?.systemId as string | undefined;
  const zoneId = room?.zoneId as string | undefined;
  if (!sysId && !zoneId) return null;
  return (equipSystems ?? []).find((s: any) => {
    if (s?.type !== 'DOAS') return false;
    const sysIds = (s.doasLinkedSystemIds ?? []) as string[];
    const zoneIds = (s.doasLinkedZoneIds ?? []) as string[];
    if (sysId && sysIds.includes(sysId)) return true;
    if (zoneId && zoneIds.includes(zoneId)) return true;
    if (sysId && zoneIds.includes(sysId)) return true; // legacy: sysId stored in zone links
    return false;
  }) ?? null;
};

/**
 * Resolve a room's effective TFA serving + mode.
 *   1. Explicit room.tfaMode 'no-tfa' → not served.
 *   2. Explicit 'tfa-served' / 'tfa-only' → served by the project DOAS if one exists
 *      (the UI auto-creates the DOAS when the user picks central/corridor).
 *   3. Unset / 'inherit' → legacy link detection + zone.tfaDefaultMode, else not served.
 */
export const resolveRoomTfa = (
  room: any,
  equipSystems: any[] | undefined | null,
  zoneDocs: any[] = [],
): { doas: any | null; mode: ResolvedTfaMode } => {
  const raw = (room?.tfaMode as string | undefined) ?? 'inherit';

  if (raw === 'no-tfa') return { doas: null, mode: 'no-tfa' };

  if (raw === 'tfa-served' || raw === 'tfa-only') {
    const doas = getProjectDoas(equipSystems);
    // Needs a DOAS to actually condition the OA; until one exists, behave as no-tfa.
    return doas ? { doas, mode: raw } : { doas: null, mode: 'no-tfa' };
  }

  // Unset / 'inherit' → backward-compat link path.
  const linked = findDoasByLink(room, equipSystems);
  if (!linked) return { doas: null, mode: 'no-tfa' };
  const zoneDoc = (zoneDocs ?? []).find((z: any) => z.id === room?.zoneId);
  const zoneDefault = (zoneDoc as any)?.tfaDefaultMode as string | undefined;
  if (zoneDefault === 'tfa-only' || zoneDefault === 'tfa-served') return { doas: linked, mode: zoneDefault };
  return { doas: linked, mode: 'tfa-served' };
};

/** Default cooling source for an auto-created project DOAS: chilled-water when a
 *  chiller primary exists (the common Indian practice), else a self-contained unit. */
export const pickCoolingSource = (
  project: any,
  equipSystems: any[] | undefined | null,
): 'own-unit' | 'chiller-plant' => {
  const sysType = project?.systemType ?? project?.data?.systemType;
  if (sysType === 'Chiller') return 'chiller-plant';
  if ((equipSystems ?? []).some((s: any) => s?.type === 'Chiller')) return 'chiller-plant';
  return 'own-unit';
};

/** Cold-DOAS supply defaults for a freshly-created project TFA unit. */
export const TFA_SUPPLY_DEFAULTS = {
  tfaSupplyTemp: 55,
  tfaSupplyHumidity: 90,
  ervSensibleEffectiveness: 0,
  ervLatentEffectiveness: 0,
} as const;
