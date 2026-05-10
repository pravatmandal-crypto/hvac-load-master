/**
 * ASHRAE 62.1-2019 Multi-Space Ventilation
 * Breathing zone OA, zone/system OA efficiency, multi-space equation.
 */

// ─── Space Type Table ─────────────────────────────────────────────────────────
// ASHRAE 62.1-2019 Table 6.2.2.1 — Minimum Ventilation Rates in Breathing Zone
// Rp = people-dependent component (cfm/person)
// Ra = area-dependent component (cfm/ft²)

export interface SpaceType62 {
  id: string;
  label: string;
  category: string;
  Rp: number; // cfm/person
  Ra: number; // cfm/ft²
}

export const SPACE_TYPES_62: SpaceType62[] = [
  // ── Office / Administrative ──────────────────────────────────────────────
  { id: 'office_general',    label: 'Office (open plan / private)',  category: 'Office',      Rp: 5,    Ra: 0.06 },
  { id: 'conference',        label: 'Conference / Meeting Room',     category: 'Office',      Rp: 5,    Ra: 0.06 },
  { id: 'reception',         label: 'Reception / Lobby',             category: 'Office',      Rp: 5,    Ra: 0.06 },
  { id: 'break_room',        label: 'Break Room / Pantry',           category: 'Office',      Rp: 5,    Ra: 0.06 },
  { id: 'computer_lab',      label: 'Computer Lab / IT Room',        category: 'Office',      Rp: 5,    Ra: 0.06 },
  { id: 'bank_office',       label: 'Bank / Financial Office',       category: 'Office',      Rp: 7.5,  Ra: 0.06 },
  // ── Education ────────────────────────────────────────────────────────────
  { id: 'classroom_k12',     label: 'Classroom (K-12)',              category: 'Education',   Rp: 10,   Ra: 0.12 },
  { id: 'classroom_univ',    label: 'Classroom (University / Adult)',category: 'Education',   Rp: 7.5,  Ra: 0.06 },
  { id: 'lecture_hall',      label: 'Lecture Hall / Auditorium',     category: 'Education',   Rp: 7.5,  Ra: 0.06 },
  { id: 'library',           label: 'Library',                       category: 'Education',   Rp: 5,    Ra: 0.12 },
  { id: 'gymnasium',         label: 'Gymnasium (school)',            category: 'Education',   Rp: 10,   Ra: 0.18 },
  // ── Food & Beverage ──────────────────────────────────────────────────────
  { id: 'restaurant',        label: 'Restaurant / Dining Room',      category: 'Food',        Rp: 7.5,  Ra: 0.18 },
  { id: 'cafeteria',         label: 'Cafeteria / Canteen',           category: 'Food',        Rp: 7.5,  Ra: 0.18 },
  { id: 'kitchen_commercial',label: 'Commercial Kitchen',            category: 'Food',        Rp: 7.5,  Ra: 0.12 },
  { id: 'bar_lounge',        label: 'Bar / Lounge',                  category: 'Food',        Rp: 7.5,  Ra: 0.18 },
  // ── Retail & Service ─────────────────────────────────────────────────────
  { id: 'retail_sales',      label: 'Retail Sales Floor',            category: 'Retail',      Rp: 15,   Ra: 0.12 },
  { id: 'mall_common',       label: 'Mall / Common Area',            category: 'Retail',      Rp: 7.5,  Ra: 0.06 },
  { id: 'storage_active',    label: 'Storage (active / staffed)',    category: 'Retail',      Rp: 5,    Ra: 0.06 },
  // ── Hospitality ──────────────────────────────────────────────────────────
  { id: 'hotel_room',        label: 'Hotel Guest Room',              category: 'Hospitality', Rp: 5,    Ra: 0.06 },
  { id: 'hotel_lobby',       label: 'Hotel Lobby',                   category: 'Hospitality', Rp: 7.5,  Ra: 0.06 },
  { id: 'banquet_hall',      label: 'Banquet / Ballroom / Hall',     category: 'Hospitality', Rp: 7.5,  Ra: 0.06 },
  // ── Healthcare ───────────────────────────────────────────────────────────
  { id: 'hospital_patient',  label: 'Hospital Patient Room',         category: 'Healthcare',  Rp: 25,   Ra: 0.12 },
  { id: 'hospital_exam',     label: 'Exam Room / Consultation',      category: 'Healthcare',  Rp: 15,   Ra: 0.06 },
  { id: 'hospital_waiting',  label: 'Hospital Waiting Area',         category: 'Healthcare',  Rp: 5,    Ra: 0.06 },
  // ── Sports & Recreation ──────────────────────────────────────────────────
  { id: 'gym_fitness',       label: 'Gym / Fitness Centre',          category: 'Sports',      Rp: 20,   Ra: 0.06 },
  { id: 'sports_court',      label: 'Indoor Sports Court',           category: 'Sports',      Rp: 20,   Ra: 0.18 },
  // ── Residential / Institutional ──────────────────────────────────────────
  { id: 'dormitory',         label: 'Dormitory / Hostel Room',       category: 'Residential', Rp: 5,    Ra: 0.06 },
  { id: 'corridor',          label: 'Corridor / Hallway',            category: 'Misc',        Rp: 0,    Ra: 0.06 },
  { id: 'server_room',       label: 'Server Room / Data Centre',     category: 'Misc',        Rp: 0,    Ra: 0.06 },
  { id: 'storage_inactive',  label: 'Storage (inactive / unoccupied)',category: 'Misc',       Rp: 0,    Ra: 0.06 },
];

export const SPACE_TYPE_MAP: Record<string, SpaceType62> = Object.fromEntries(
  SPACE_TYPES_62.map(s => [s.id, s]),
);

export function getSpaceType(id?: string): SpaceType62 {
  return SPACE_TYPE_MAP[id ?? ''] ?? SPACE_TYPE_MAP['office_general'];
}

// ─── Zone Air Distribution Effectiveness (Ez) ────────────────────────────────
// ASHRAE 62.1-2019 Table 6.2.2.2
export interface EzOption {
  id: string;
  label: string;
  Ez: number;
}

export const EZ_OPTIONS: EzOption[] = [
  { id: 'ceiling_cool', label: 'Ceiling supply — cooling (typical)',        Ez: 1.0 },
  { id: 'ceiling_warm', label: 'Ceiling supply — heating (warm air >15°F)', Ez: 0.8 },
  { id: 'floor_supply', label: 'Floor supply / low-wall supply',            Ez: 1.0 },
  { id: 'ufad',         label: 'Under-floor air distribution (UFAD)',       Ez: 1.2 },
  { id: 'perimeter',    label: 'Perimeter slot diffusers',                  Ez: 1.0 },
];

export const EZ_MAP: Record<string, number> = Object.fromEntries(
  EZ_OPTIONS.map(e => [e.id, e.Ez]),
);

export function getEz(ezId?: string): number {
  return EZ_MAP[ezId ?? 'ceiling_cool'] ?? 1.0;
}

// ─── Per-Room Calculation ─────────────────────────────────────────────────────

export interface RoomVbz {
  roomId: string;
  spaceType: string;
  Rp: number;
  Ra: number;
  peopleCount: number;
  areaSqFt: number;
  Vbz: number; // cfm — breathing zone OA
}

export function calcRoomVbz(room: {
  id: string;
  spaceType?: string;
  peopleCount?: number;
  length?: number;
  width?: number;
}): RoomVbz {
  const st = getSpaceType(room.spaceType);
  const people = Number(room.peopleCount) || 0;
  const area = (Number(room.length) || 0) * (Number(room.width) || 0);
  const Vbz = st.Rp * people + st.Ra * area;
  return { roomId: room.id, spaceType: st.id, Rp: st.Rp, Ra: st.Ra, peopleCount: people, areaSqFt: area, Vbz };
}

// ─── Per-Zone Calculation ─────────────────────────────────────────────────────

export interface ZoneVentilation62 {
  zoneId: string;
  zoneName: string;
  ezId: string;
  Ez: number;
  Vbz: number;   // sum of room Vbz (cfm)
  Voz: number;   // Vbz / Ez (cfm) — zone OA
  Vpz: number;   // zone supply airflow (cfm) — sum of room design CFM
  Zpz: number;   // Voz / Vpz — zone OA fraction (0–1)
  rooms: RoomVbz[];
  isCritical?: boolean; // set after system-level calc
}

export function calcZoneVentilation(
  zoneId: string,
  zoneName: string,
  zoneRooms: Array<{ id: string; spaceType?: string; peopleCount?: number; length?: number; width?: number; _calcOverallDesignCFM?: any; _calcDesignCFM?: any }>,
  ezId = 'ceiling_cool',
): ZoneVentilation62 {
  const Ez = getEz(ezId);
  const rooms = zoneRooms.map(r => calcRoomVbz(r));
  const Vbz = rooms.reduce((s, r) => s + r.Vbz, 0);
  const Voz = Ez > 0 ? Vbz / Ez : Vbz;
  const Vpz = zoneRooms.reduce((s, r) => s + (Number(r._calcOverallDesignCFM) || Number(r._calcDesignCFM) || 0), 0);
  const Zpz = Vpz > 0 ? Voz / Vpz : 0;
  return { zoneId, zoneName, ezId, Ez, Vbz, Voz, Vpz, Zpz, rooms };
}

// ─── System-Level Calculation (Multi-Space Equation) ─────────────────────────

export interface SystemVentilation62 {
  zones: ZoneVentilation62[];
  Vou: number;    // sum of all Voz (cfm)
  Vs: number;     // total supply CFM
  Zs: number;     // Vou / Vs (uncorrected system OA fraction)
  Xs: number;     // max Zpz — critical zone OA fraction
  criticalZoneId: string;
  Ev: number;     // 1 + Xs - Zs (system ventilation efficiency, capped at 1.0 per 62.1 §6.2.2.5)
  Vot: number;    // Vou / Ev — system OA after multi-space correction (cfm)
  oaPct: number;  // Vot / Vs × 100
}

export function calcSystemVentilation62(zones: ZoneVentilation62[]): SystemVentilation62 {
  const Vou = zones.reduce((s, z) => s + z.Voz, 0);
  const Vs  = zones.reduce((s, z) => s + z.Vpz, 0);
  const Zs  = Vs > 0 ? Vou / Vs : 0;

  let Xs = 0;
  let criticalZoneId = '';
  for (const z of zones) {
    if (z.Zpz > Xs) { Xs = z.Zpz; criticalZoneId = z.zoneId; }
  }

  // ASHRAE 62.1 §6.2.2.5: Ev = 1 + Xs - Zs, capped at 1.0
  const Ev = Math.min(1.0, 1 + Xs - Zs);
  const Vot = Ev > 0 ? Vou / Ev : Vou;
  const oaPct = Vs > 0 ? (Vot / Vs) * 100 : 0;

  const zonesMarked = zones.map(z => ({ ...z, isCritical: z.zoneId === criticalZoneId }));
  return { zones: zonesMarked, Vou, Vs, Zs, Xs, criticalZoneId, Ev, Vot, oaPct };
}
