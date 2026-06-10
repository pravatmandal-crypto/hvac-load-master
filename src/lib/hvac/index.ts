/**
 * HVAC Calculation Engine
 * Main entry point - exports all HVAC calculation utilities
 * Organized by domain for better maintainability and testability
 */

// Constants and Interfaces
export {
  type DesignConditions,
  type WallType,
  type WallColor,
  type RoomDetails,
  type EnvelopeElement,
  type EnvelopeBreakdown,
  type PsychrometricProperties,
  type CoilParameters,
  type VentilationLoadResult,
  type HeatingLoadResult,
  type TFALoadResult,
  type DuctSizingResult,
  type PipeSizingResult,
  type MoistureResult,
  type ReheatResult,
  type ParasiticGainsResult,
  type SolarGainResult,
  DEFAULT_WALL_TYPES,
  ACTIVITY_TYPES,
  ACTIVITY_ACH_RECOMMENDATIONS,
  getRecommendedAch,
  getMinAdp,
  ASHRAE_CONSTANTS,
  CLTD_OFFSETS,
  CLTD_COLOR_CORRECTION,
  CLTD_LM,
  SHGF_FACTORS,
  SOLAR_INTENSITY_COEFFICIENTS,
  VALIDATION_RULES,
} from './constants';

// Geometry calculations
export { calculateRoomVolume, calculateRoomArea, calculateRoomSurfaceAreas } from './geometry';

// Internal gains (people, lighting, equipment)
export { calculateInternalGains, type InternalGains } from './internalGains';

// Envelope (wall, glass, roof) gains
export {
  getCLTD,
  getSHGF,
  calculateSingleElementGain,
  calculateEnvelopeGain,
} from './envelope';

// Solar radiation
export { calculateSolarGain } from './solar';

// Ventilation and heating
export { calculateVentilationLoad, calculateHeatingLoad, calculateTFALoad } from './ventilation';

// Psychrometric properties and coil parameters
export { calculatePsychrometrics, calculateCoilParameters, dewPointFromHumidityRatio } from './psychrometrics';

// Duct and pipe sizing
export {
  sizeDuct,
  sizeRectangularDuct,
  sizePipe,
  getPipeVelocity,
  calculatePipeFrictionLoss,
} from './sizing';

// Moisture management and reheat
export { calculateMoistureManagement, calculateReheat } from './reheat';

// Parasitic gains
export { calculateParasiticGains } from './parasitic';

// Supply-air CFM basis resolver (DSCFM vs ACH preset)
export { resolveSupplyCfm, resolveDesignMode, resolveRoomSupplyBasis, type SupplyCfmBasis, type SupplyCfmResult, type DesignMode } from './supplyCfm';

// ASHRAE 62.1 ventilation
export {
  SPACE_TYPES_62,
  SPACE_TYPE_MAP,
  EZ_OPTIONS,
  EZ_MAP,
  getSpaceType,
  getEz,
  calcRoomVbz,
  calcZoneVentilation,
  calcSystemVentilation62,
  type SpaceType62,
  type EzOption,
  type RoomVbz,
  type ZoneVentilation62,
  type SystemVentilation62,
} from './ventilation62';

// Dehumidification strategy comparison (single-AHU subcool+reheat vs DOAS/TFA)
export {
  compareDehumidStrategies,
  saturationTempFromW,
  type DehumidStrategyInput,
  type DehumidStrategyComparison,
} from './dehumidStrategy';

// TFA / DOAS shared resolver (single source of truth for room TFA serving + mode)
export {
  getProjectDoas,
  resolveRoomTfa,
  pickCoolingSource,
  TFA_SUPPLY_DEFAULTS,
  type ResolvedTfaMode,
} from './tfa';
