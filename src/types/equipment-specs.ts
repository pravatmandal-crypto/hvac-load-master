export interface AHUData {
  quantity?: number;
  supplyAirCFM: number;
  outsideAirPct: number;
  outsideAirCFM: number;
  returnAirCFM: number;
  outdoorDBF: number;
  outdoorWBF: number;
  roomDBF: number;
  roomRHPct: number;
  mixedAirDBF: number;
  mixedAirWBF: number;
  leavingAirDBF: number;
  leavingAirRHPct: number;
  // Off-coil dew point (°F) and apparatus dew point (°F) — the coil-selection drivers the
  // AHU manufacturer needs. ADP must sit below the room dew point to hold the design RH.
  leavingAirDPF?: number;
  apparatusDewPointF?: number;
  coolingCapTR: number;
  coolingCapKW: number;
  coilType: string;
  chwSupplyTempC: number;
  chwReturnTempC: number;
  chwFlowLPS: number;
  chwPipeDN: number;
  heatingCoil: boolean;
  heatingCapKW: number;
  hwTempC: string;
  hwSupplyTempC?: number;
  hwReturnTempC?: number;
  hwFlowLPS?: number;
  hwPipeDN?: number;
  fanType: string;
  fanCurve?: string;
  fanDrive?: string;
  hepaFilter?: boolean;
  hepaFilterGrade?: string;
  extStaticPa: number;
  totalStaticPa: number;
  fanMotorKW: number;
  preFilterGrade: string;
  finalFilterGrade: string;
  hasMixingBox?: boolean;
  coolingCoilRows?: number;
  coolCoilWidthMM?: number;
  coolCoilHeightMM?: number;
  coolCoilDepthMM?: number;
  heatingCoilRows?: number;
  heatCoilDepthMM?: number;
  heatVentLoadKW?: number;
  heatReheatKW?: number;
  ahuLengthMM?: number;
  ahuWidthMM?: number;
  ahuHeightMM?: number;
  casingMaterial: string;
  supplyDuctMM: string;
  returnDuctMM: string;
  notes: string;
}

export interface ChillerData {
  quantity?: number;
  coolingCapTR: number;
  coolingCapKW: number;
  copRated: number;
  refrigerant: string;
  condenserType: string;
  chwSupplyTempC: number;
  chwReturnTempC: number;
  chwFlowLPS: number;
  chwPipeDN: number;
  cwSupplyTempC: number;
  cwReturnTempC: number;
  cwFlowLPS: number;
  cwPipeDN: number;
  inputKW: number;
  voltageHz: string;
  notes: string;
}

export interface CTData {
  quantity?: number;
  dutyTR: number;
  dutyKW: number;
  hotWaterTempC: number;
  coldWaterTempC: number;
  designWBTC: number;
  approach: number;
  range: number;
  waterFlowLPS: number;
  waterFlowGPM: number;
  towerType: string;
  flowType: string;
  casingMaterial: string;
  fillType: string;
  fanMotorKW: number;
  inletPipeDN: number;
  outletPipeDN: number;
  notes: string;
}

export interface PackageData {
  coolingCapTR: number;
  coolingCapKW: number;
  eerRated: number;
  refrigerant: string;
  supplyAirCFM: number;
  extStaticPa: number;
  inputKW: number;
  quantity: number;
  notes: string;
}

export interface HumidifierData {
  capacityKgHr: number;
  type: string;
  humidifierType?: 'steam-electrode' | 'ultrasonic';
  heatingElementKW: number;
  waterConsumptionLPH: number;
  controlType: string;
  voltageHz: string;
  notes: string;
}

export interface AHUZoneData extends AHUData {
  zoneName: string;
}

export interface FullSpec {
  specType: string;
  ahu?: AHUData;            // single aggregate unit (legacy / single-zone)
  ahuUnits?: AHUZoneData[]; // per-zone units; takes precedence over ahu when present
  chiller?: ChillerData;
  ct?: CTData;
  pkg?: PackageData;
  humidifier?: HumidifierData;
  generatedAt?: string;
  savedAt?: string;
}
