/**
 * Room Geometry and Helper Calculations
 * Basic calculations for room dimensions, areas, and volumes
 */

import { RoomDetails } from './constants';

/**
 * Calculate effective room volume considering false ceiling
 * @param room - Room details
 * @returns Volume in cubic feet
 */
export const calculateRoomVolume = (room: RoomDetails): number => {
  const effectiveHeight = room.hasFalseCeiling && room.falseCeilingHeight 
    ? room.falseCeilingHeight 
    : room.height;
  return room.length * room.width * effectiveHeight;
};

/**
 * Calculate floor area of a room
 * @param room - Room details
 * @returns Area in square feet
 */
export const calculateRoomArea = (room: RoomDetails): number => {
  return room.length * room.width;
};

/**
 * Calculate all surface areas for a room
 * Assumes rectangular room with standard ceiling height
 * @param room - Room details
 * @returns Object with all surface areas
 */
export const calculateRoomSurfaceAreas = (room: RoomDetails) => {
  const area = calculateRoomArea(room);
  const effectiveHeight = room.hasFalseCeiling && room.falseCeilingHeight 
    ? room.falseCeilingHeight 
    : room.height;
  
  return {
    floor: area,
    ceiling: area,
    northWall: room.width * effectiveHeight,
    southWall: room.width * effectiveHeight,
    eastWall: room.length * effectiveHeight,
    westWall: room.length * effectiveHeight,
    totalWallArea: 2 * (room.length + room.width) * effectiveHeight,
  };
};
