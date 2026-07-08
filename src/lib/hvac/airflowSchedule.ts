/**
 * Airflow schedule builder — the room-wise / zone-wise recirc + fresh-air (FACFM)
 * breakdown a designer needs for air-terminal and duct layout.
 *
 * This is the canonical, TFA-aware computation. It mirrors the per-room engine used by
 * ZoneList.computeZoneTotals / reportService.computeDetailed (envelope + internal + vent +
 * TFA credit → coil → resolveSupplyCfm) and then applies the shared computeAirflowSplit so
 * the split definition (Recirc = Total − FACFM) is identical everywhere.
 *
 * Callers supply each zone's resolved summer (and optional monsoon) design conditions; the
 * space Design CFM is taken as the governing (worst-season) value, matching the strips/detail.
 */
import {
  type DesignConditions,
  type RoomDetails,
  type EnvelopeElement,
} from './constants';
import { calculateRoomVolume } from './geometry';
import { calculateTFALoad } from './ventilation';
import { resolveRoomTfa } from './tfa';
import { computeAirflowSplit } from './supplyCfm';
import { computeRoomLoad } from './computeRoomLoad';

export type AirflowMode = 'no-tfa' | 'tfa-served' | 'tfa-only';

export interface AirflowScheduleRoom {
  roomId: string;
  roomName: string;
  mode: AirflowMode;
  totalSupply: number;
  recirc: number;
  facfm: number;
}

export interface AirflowScheduleZone {
  zoneId: string;
  zoneName: string;
  rooms: AirflowScheduleRoom[];
  totalSupply: number;
  recirc: number;
  facfm: number;
}

export interface AirflowZoneInput {
  zoneId: string;
  zoneName: string;
  summerDc: DesignConditions;
  monsoonDc?: DesignConditions | null;
  rooms: Array<{ room: any; elements: EnvelopeElement[] }>;
}

const toRd = (room: any): RoomDetails => ({
  id: room.id,
  name: room.name ?? '',
  floor: room.floor ?? 'Ground',
  length: Number(room.length) || 0,
  width: Number(room.width) || 0,
  height: Number(room.height) || 0,
  hasFalseCeiling: room.hasFalseCeiling ?? false,
  falseCeilingHeight: Number(room.falseCeilingHeight) || 8,
  facph: Number(room.facph) || 0,
  peopleCount: Number(room.peopleCount) || 0,
  activityType: room.activityType ?? 'office',
  lightsWattsPerSqft: Number(room.lightsWattsPerSqft) || 0,
  equipmentKW: Number(room.equipmentKW) || 0,
  othersKW: Number(room.othersKW) || 0,
});

/**
 * Space-coil Design CFM for one room at one season — delegates to the shared engine
 * (computeRoomLoad), which resolves TFA from equipSystems exactly as the report does, so
 * the airflow schedule and the load report always size the space coil identically.
 */
function roomDesignCfm(
  rd: RoomDetails,
  elements: EnvelopeElement[],
  dc: DesignConditions,
  equipSystems: any[],
  zoneDocs: any[] | undefined,
  project: any,
): number {
  return computeRoomLoad(rd, elements, dc, { equipSystems, project, zoneDocs }).designCfm;
}

export function buildAirflowSchedule(params: {
  zones: AirflowZoneInput[];
  project?: any;
  equipSystems?: any[];
  zoneDocs?: any[];
}): AirflowScheduleZone[] {
  const { zones, project, equipSystems = [], zoneDocs } = params;
  const out: AirflowScheduleZone[] = [];

  for (const z of zones) {
    const rows: AirflowScheduleRoom[] = [];
    for (const { room, elements } of z.rooms) {
      try {
        // Keep the extra room fields the calc reads (safety %, gain %, basis, recircPct),
        // but let toRd's coerced numerics (length/width/height/facph…) win over raw strings.
        const rd = { ...room, ...toRd(room) } as RoomDetails;
        const { doas, mode } = resolveRoomTfa(room, equipSystems, zoneDocs);
        const isTFA = !!doas;
        const isTfaOnly = mode === 'tfa-only';
        const summerCfm = roomDesignCfm(rd, elements, z.summerDc, equipSystems, zoneDocs, project);
        const govCfm = z.monsoonDc
          ? Math.max(summerCfm, roomDesignCfm(rd, elements, z.monsoonDc, equipSystems, zoneDocs, project))
          : summerCfm;
        const tfa = isTFA ? calculateTFALoad(rd, z.summerDc) : null;
        const freshAirCFM = (calculateRoomVolume(rd) * rd.facph) / 60;
        const split = computeAirflowSplit({
          designSupplyCFM: govCfm,
          freshAirCFM,
          tfaCfm: tfa?.cfm ?? 0,
          isTFA,
          isTfaOnly,
        });
        rows.push({
          roomId: room.id,
          roomName: room.name ?? 'Unnamed',
          mode: isTfaOnly ? 'tfa-only' : isTFA ? 'tfa-served' : 'no-tfa',
          totalSupply: split.totalSupplyCFM,
          recirc: split.recircCFM,
          facfm: split.freshAirCFM,
        });
      } catch {
        // skip a room that fails to calculate rather than dropping the whole schedule
      }
    }
    if (rows.length > 0) {
      out.push({
        zoneId: z.zoneId,
        zoneName: z.zoneName,
        rooms: rows,
        totalSupply: rows.reduce((s, r) => s + r.totalSupply, 0),
        recirc: rows.reduce((s, r) => s + r.recirc, 0),
        facfm: rows.reduce((s, r) => s + r.facfm, 0),
      });
    }
  }
  return out;
}
