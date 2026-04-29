/**
 * Internal Gains Calculations
 * Calculate heat and moisture loads from people, lighting, and equipment
 * Based on ASHRAE Fundamentals 2017, Chapter 18
 */

import { RoomDetails, ASHRAE_CONSTANTS, ACTIVITY_TYPES } from './constants';
import { calculateRoomArea } from './geometry';

export interface InternalGains {
  sensible: number;
  latent: number;
  breakdown?: {
    peopleSensible: number;
    peopleLatent: number;
    lightsSensible: number;
    equipmentSensible: number;
    othersSensible: number;
  };
}

/**
 * Calculate internal heat gains (Sensible & Latent) from occupants, lights, and equipment
 * ASHRAE Table 6.1 - Office work: 245 sensible / 205 latent BTU/h per person
 * 
 * @param room - Room details including occupancy and loads
 * @returns Object with sensible and latent gains in BTU/h
 */
export const calculateInternalGains = (room: RoomDetails): InternalGains => {
  const area = calculateRoomArea(room);

  // People: ASHRAE Table 18-2 — look up by activityType, default to office
  const activity = ACTIVITY_TYPES.find(a => a.id === (room.activityType ?? 'office'))
                ?? ACTIVITY_TYPES.find(a => a.id === 'office')!;
  const peopleSensible = room.peopleCount * activity.sensible;
  const peopleLatent   = room.peopleCount * activity.latent;

  // Lights: Sensible only - Convert W/ft² to BTU/h
  // 1 W = 3.412 BTU/h
  const lightsSensible = area * room.lightsWattsPerSqft * ASHRAE_CONSTANTS.W_TO_BTU_H;

  // Equipment: Sensible only - Convert KW to BTU/h
  // 1 KW = 3412 BTU/h
  const equipmentSensible = room.equipmentKW * ASHRAE_CONSTANTS.KW_TO_BTU_H;

  // Others: Sensible only
  const othersSensible = room.othersKW * ASHRAE_CONSTANTS.KW_TO_BTU_H;

  return {
    sensible: peopleSensible + lightsSensible + equipmentSensible + othersSensible,
    latent: peopleLatent,
    breakdown: {
      peopleSensible,
      peopleLatent,
      lightsSensible,
      equipmentSensible,
      othersSensible,
    },
  };
};
