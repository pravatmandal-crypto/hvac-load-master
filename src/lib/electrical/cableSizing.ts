/**
 * Cable Sizing and Ampacity Calculations
 * Based on NEC, IEC 60364, and industry standards
 */

import {
  CABLE_SIZES,
  AMPACITY_TABLE,
  MCB_RATINGS,
  ELECTRICAL_CONSTANTS,
  APPLICATION_PROFILES,
  CableSize,
  AmpacityRating,
  MCBRating,
  CableSizingResult,
  ApplicationType,
  ApplicationProfile,
} from "./constants";

/**
 * Calculate voltage drop for a cable run
 * Formula: VD = (2 × L × I × R) / 1000
 * Where: L = length (m), I = current (A), R = resistance (Ω/km)
 */
export function calculateVoltageDrop(
  cableSize: CableSize,
  loadCurrent: number, // Amps
  cableLength: number, // meters
  material: "copper" | "aluminum" = "copper",
  ambientTemp: number = 20 // °C
): number {
  const resistivity =
    material === "copper"
      ? ELECTRICAL_CONSTANTS.COPPER_RESISTIVITY
      : ELECTRICAL_CONSTANTS.ALUMINUM_RESISTIVITY;

  // Temperature correction
  const tempCoeff =
    material === "copper"
      ? ELECTRICAL_CONSTANTS.TEMP_COEFFICIENT_COPPER
      : ELECTRICAL_CONSTANTS.TEMP_COEFFICIENT_ALUMINUM;
  const tempFactor = 1 + tempCoeff * (ambientTemp - 20);

  // Resistance at operating temperature (Ω/m)
  const resistance = (resistivity * tempFactor) / cableSize.metric;

  // Voltage drop (V) assuming single-phase
  // For 3-phase: multiply by √3
  const voltageDrop = (2 * cableLength * loadCurrent * resistance) / 1000;

  return voltageDrop;
}

/**
 * Calculate voltage drop percentage
 */
export function calculateVoltagDropPercent(
  voltageDrop: number,
  systemVoltage: number
): number {
  return (voltageDrop / systemVoltage) * 100;
}

/**
 * Get ampacity rating for a cable at specific conditions
 */
export function getAmpacityRating(
  cableId: string,
  temperature: 60 | 75 | 90 | 70 = 75
): AmpacityRating | null {
  // First try exact temperature match
  const exact = AMPACITY_TABLE.find(
    (rating) => rating.cableId === cableId && rating.temperature === temperature
  );
  if (exact) return exact;

  // Fallback for IEC entries commonly defined at 70C when caller requests 75C.
  // This keeps metric (mm2) catalog usable in mixed NEC/IEC datasets.
  if (temperature === 75) {
    const iecFallback = AMPACITY_TABLE.find(
      (rating) => rating.cableId === cableId && rating.temperature === 70
    );
    if (iecFallback) return iecFallback;
  }

  return null;
}

/**
 * Apply derating factors to ampacity
 * Common factors: temperature, bundling, altitude, conduit type
 */
export function applyDeratingFactors(
  baseAmpacity: number,
  ambientTemp: number = 30, // °C (typically 30°C for indoor, 40°C for outdoor)
  bundledCables: number = 1, // Number of cables in same conduit
  conduitFillPercentage: number = 40 // % (NEC limit: 40%)
): { deratedAmpacity: number; factors: { [key: string]: number } } {
  const factors: { [key: string]: number } = {};

  let deratedAmpacity = baseAmpacity;

  // Temperature derating
  // Assume table values at 30°C, derate 5% per 10°C above
  if (ambientTemp > 30) {
    const tempDerating = 1 - ((ambientTemp - 30) / 10) * 0.05;
    factors.temperature = Math.max(tempDerating, 0.5); // Minimum 50%
    deratedAmpacity *= factors.temperature;
  }

  // Bundling/grouping derating (IEC 60364)
  let bundlingFactor = 1.0;
  if (bundledCables === 2) bundlingFactor = 0.8;
  else if (bundledCables === 3) bundlingFactor = 0.7;
  else if (bundledCables === 4) bundlingFactor = 0.65;
  else if (bundledCables >= 5 && bundledCables <= 6) bundlingFactor = 0.6;
  else if (bundledCables >= 7 && bundledCables <= 9) bundlingFactor = 0.5;
  else if (bundledCables >= 10) bundlingFactor = 0.45;

  if (bundledCables > 1) {
    factors.bundling = bundlingFactor;
    deratedAmpacity *= bundlingFactor;
  }

  // Conduit fill derating (if exceeding 40%)
  if (conduitFillPercentage > 40) {
    const fillFactor = Math.max(0.5, 1 - (conduitFillPercentage - 40) / 100);
    factors.conduitFill = fillFactor;
    deratedAmpacity *= fillFactor;
  }

  return {
    deratedAmpacity: Math.round(deratedAmpacity * 10) / 10,
    factors,
  };
}

/**
 * Find best cable size for a given load current
 */
export function selectCableSize(
  loadCurrent: number, // A
  systemVoltage: number = 230, // V (230V single-phase or 400V 3-phase)
  cableLength: number = 0, // m (optional, for voltage drop check)
  ambientTemp: number = 30,
  bundledCables: number = 1,
  allowableVoltageDropPercent: number = ELECTRICAL_CONSTANTS.ACCEPTABLE_VOLTAGE_DROP,
  material: "copper" | "aluminum" = "copper"
): { cable: CableSize; ampacity: AmpacityRating; deratedAmpacity: number } | null {
  // Apply safety factor to load current
  const requiredCurrent = loadCurrent * ELECTRICAL_CONSTANTS.SAFETY_FACTOR_CABLE;
  // Practical rule: for same cross-section, aluminum carries less current than copper.
  // Apply a conservative correction when base table values are copper-centric.
  const materialAmpacityFactor = material === "aluminum" ? 0.8 : 1.0;

  // Prefer IEC metric sizes first for IS/IEC workflows; fallback to full catalog if needed.
  const iecCatalog = CABLE_SIZES.filter((cable) => cable.awg == null && cable.id.endsWith("mm2"));
  const catalogs: CableSize[][] = [iecCatalog, CABLE_SIZES];

  for (const catalog of catalogs) {
    // Skip duplicate pass if IEC filter produced no subset
    if (!catalog.length) continue;
    // Find cables with sufficient ampacity
    for (const cable of catalog) {
      const ampacityRating = getAmpacityRating(cable.id);
      if (!ampacityRating) continue;

      const { deratedAmpacity } = applyDeratingFactors(
        ampacityRating.ampacity * materialAmpacityFactor,
        ambientTemp,
        bundledCables
      );

      // Check if cable has sufficient ampacity
      if (deratedAmpacity < requiredCurrent) continue;

      // Check voltage drop if cable length provided
      if (cableLength > 0) {
        const vd = calculateVoltageDrop(cable, requiredCurrent, cableLength, material);
        const vdPercent = calculateVoltagDropPercent(vd, systemVoltage);

        if (vdPercent > allowableVoltageDropPercent) continue;
      }

      return { cable, ampacity: ampacityRating, deratedAmpacity };
    }
  }

  return null;
}

/**
 * Find best MCB for a given circuit current
 * Selects smallest MCB ≥ circuit current
 */
export function selectMCB(
  circuitCurrent: number, // A
  loadType: "resistive" | "inductive" | "mixed" = "mixed",
  systemVoltage: number = 230 // V
): MCBRating | null {
  // Determine breaker type based on load
  let preferredType = "Type C"; // Default for mixed loads
  if (loadType === "resistive") preferredType = "Type B";
  if (loadType === "inductive") preferredType = "Type D";

  // Find breakers matching voltage and type
  const candidateMCBs = MCB_RATINGS.filter(
    (mcb) => mcb.voltage === systemVoltage && mcb.type === preferredType
  );

  // Select smallest MCB ≥ circuit current
  for (const mcb of candidateMCBs.sort((a, b) => a.capacity - b.capacity)) {
    if (mcb.capacity >= circuitCurrent) {
      return mcb;
    }
  }

  return null;
}

/**
 * Get application profile by type
 */
export function getApplicationProfile(type: ApplicationType): ApplicationProfile {
  return APPLICATION_PROFILES[type] || APPLICATION_PROFILES.general;
}

/**
 * Calculate inrush current for a given application
 * Inrush = Rated Current × Inrush Multiplier
 */
export function calculateInrushCurrent(
  ratedCurrent: number,
  applicationType: ApplicationType,
  customInrushMultiplier?: number
): number {
  const profile = getApplicationProfile(applicationType);
  const multiplier = customInrushMultiplier ?? profile.inrushMultiplier;
  return ratedCurrent * multiplier;
}

/**
 * Size cable considering inrush behavior
 * Practical approach: cable is thermally sized on running current with margin,
 * while breaker curve selection handles inrush transients.
 */
export function calculateInrushBasedSizing(
  ratedCurrent: number,
  applicationType: ApplicationType,
  useStartingProtection: boolean = false,
  customInrushMultiplier?: number
): {
  effectiveCurrent: number;
  inrushCurrent: number;
  recommendation: string;
} {
  const profile = getApplicationProfile(applicationType);
  const inrushCurrent = calculateInrushCurrent(ratedCurrent, applicationType, customInrushMultiplier);

  let effectiveCurrent = ratedCurrent;
  let recommendation = '';

  if (useStartingProtection) {
    // With soft-starter or star-delta: inrush reduced, size for rated current + some margin
    effectiveCurrent = ratedCurrent * 1.25; // 25% margin for thermal stability
    recommendation = `With ${profile.startingMethod}: Cable sized for rated current (${ratedCurrent.toFixed(1)}A) + 25% margin = ${effectiveCurrent.toFixed(1)}A`;
  } else if (applicationType === "heater") {
    // Resistive heaters have negligible inrush; avoid compounding margins because
    // selectCableSize already applies the global cable safety factor.
    effectiveCurrent = ratedCurrent;
    recommendation = `Resistive load: cable sized on running current (${ratedCurrent.toFixed(1)}A). Global cable safety factor is applied in final selection.`;
  } else {
    // Without starter: still size cable on running current with a higher practical margin.
    // Peak inrush is a breaker-trip/coordination concern rather than steady cable ampacity basis.
    effectiveCurrent = ratedCurrent * 1.35; // DOL margin
    recommendation = `Without starting protection: cable sized at running current + 35% (${effectiveCurrent.toFixed(1)}A). Peak inrush ${inrushCurrent.toFixed(1)}A should be managed by breaker curve/coordination.`;
  }

  return {
    effectiveCurrent,
    inrushCurrent,
    recommendation,
  };
}

/**
 * Comprehensive cable & MCB sizing considering application type and inrush
 */
export function sizeCableAndMCBWithApplication(
  loadCurrent: number, // A
  applicationType: ApplicationType = 'general',
  systemVoltage: number = 230, // V
  cableLength: number = 0, // m
  ambientTemp: number = 30, // °C
  bundledCables: number = 1,
  allowableVoltageDropPercent: number = ELECTRICAL_CONSTANTS.ACCEPTABLE_VOLTAGE_DROP,
  material: "copper" | "aluminum" = "copper",
  useStartingProtection: boolean = false,
  customInrushMultiplier?: number
): CableSizingResult | null {
  const profile = getApplicationProfile(applicationType);
  const warnings: string[] = [];
  const notes: string[] = [];

  // Step 1: Calculate inrush and effective sizing current
  const inrushCalcs = calculateInrushBasedSizing(
    loadCurrent,
    applicationType,
    useStartingProtection,
    customInrushMultiplier
  );
  const inrushCurrent = inrushCalcs.inrushCurrent;
  const effectiveCurrentForCable = inrushCalcs.effectiveCurrent;

  notes.push(`Application: ${profile.label}`);
  if (material === "aluminum") {
    notes.push("Aluminum conductor selected: ampacity adjusted conservatively (~80% of equivalent copper table value). Larger cross-section may be recommended.");
  }
  notes.push(`Inrush: ${inrushCurrent.toFixed(1)}A (${profile.inrushMultiplier}× rated), Duration: ~${profile.inrushDuration}ms`);
  notes.push(inrushCalcs.recommendation);

  // Step 2: Select cable based on effective current
  const cableSizingResult = selectCableSize(
    effectiveCurrentForCable,
    systemVoltage,
    cableLength,
    ambientTemp,
    bundledCables,
    allowableVoltageDropPercent,
    material
  );

  if (!cableSizingResult) {
    warnings.push("No suitable cable found for given current and conditions");
    return null;
  }

  let { cable, ampacity, deratedAmpacity } = cableSizingResult;

  // DOL motor rule: always jump one cable size above the calculated minimum.
  if (applicationType === "motor" && !useStartingProtection) {
    const iecCatalog = CABLE_SIZES
      .filter((candidate) => candidate.awg == null && candidate.id.endsWith("mm2"))
      .sort((a, b) => a.metric - b.metric);

    let nextCable: CableSize | undefined;
    const currentIndex = iecCatalog.findIndex((candidate) => candidate.id === cable.id);
    if (currentIndex >= 0 && currentIndex < iecCatalog.length - 1) {
      nextCable = iecCatalog[currentIndex + 1];
    } else {
      // Fallback when selected cable is outside IEC subset (e.g., AWG entry).
      nextCable = iecCatalog.find((candidate) => candidate.metric > cable.metric);
    }

    if (nextCable) {
      const nextAmpacity = getAmpacityRating(nextCable.id);
      if (nextAmpacity) {
        const materialAmpacityFactor = material === "aluminum" ? 0.8 : 1.0;
        const nextDeratedAmpacity = applyDeratingFactors(
          nextAmpacity.ampacity * materialAmpacityFactor,
          ambientTemp,
          bundledCables
        ).deratedAmpacity;

        const previousMetric = cable.metric;
        cable = nextCable;
        ampacity = nextAmpacity;
        deratedAmpacity = nextDeratedAmpacity;

        notes.push(
          `DOL motor size jump applied: ${previousMetric} mm2 -> ${cable.metric} mm2.`
        );
      }
    }

    // Stricter engineering floor for all DOL motors.
    const dolMinMetric = 2.5;
    if (cable.metric < dolMinMetric) {
      const minCable = iecCatalog.find((candidate) => candidate.metric >= dolMinMetric);
      if (minCable) {
        const minAmpacity = getAmpacityRating(minCable.id);
        if (minAmpacity) {
          const materialAmpacityFactor = material === "aluminum" ? 0.8 : 1.0;
          const minDeratedAmpacity = applyDeratingFactors(
            minAmpacity.ampacity * materialAmpacityFactor,
            ambientTemp,
            bundledCables
          ).deratedAmpacity;

          const previousMetric = cable.metric;
          cable = minCable;
          ampacity = minAmpacity;
          deratedAmpacity = minDeratedAmpacity;

          notes.push(
            `DOL motor minimum floor applied: ${previousMetric} mm2 -> ${cable.metric} mm2 (minimum ${dolMinMetric} mm2).`
          );
        }
      }
    }
  }

  // Step 3: Apply application-specific derating
  const applicationDerating = profile.derating;
  const deCableAmpacity = deratedAmpacity * applicationDerating;

  if (deCableAmpacity < loadCurrent) {
    warnings.push(
      `After ${applicationType} derating (${(applicationDerating * 100).toFixed(0)}%): available capacity ${deCableAmpacity.toFixed(1)}A < required ${loadCurrent}A`
    );
  }

  // Step 4: Select MCB
  // For motors: use Type D if no soft-starter; Type C with soft-starter
  let preferredMCBType = "Type C";
  if (applicationType === "motor" && !useStartingProtection) {
    preferredMCBType = "Type D";
  }
  if (applicationType === "chiller") {
    preferredMCBType = "Type D";
  }

  const pickMcb = (pool: MCBRating[]) => {
    const sorted = [...pool].sort((a, b) => a.capacity - b.capacity);
    const match = sorted.find((m) => m.capacity >= loadCurrent) || null;
    if (match) return match;
    return sorted.length ? sorted[sorted.length - 1] : null;
  };

  let mcb = pickMcb(
    MCB_RATINGS.filter((mcb) => mcb.voltage === systemVoltage && mcb.type === preferredMCBType)
  );

  if (!mcb) {
    // Practical fallback: some voltage tables may not contain Type D at 3-phase ratings.
    const fallbackType = preferredMCBType === "Type D" ? "Type C" : "Type B";
    mcb = pickMcb(
      MCB_RATINGS.filter((candidate) => candidate.voltage === systemVoltage && candidate.type === fallbackType)
    );
    if (mcb) {
      warnings.push(`Preferred ${preferredMCBType} not available at ${systemVoltage}V; selected ${fallbackType} as nearest practical option.`);
    }
  }

  if (!mcb) {
    // Last fallback: any breaker for this voltage so tool can still provide guidance.
    mcb = pickMcb(MCB_RATINGS.filter((candidate) => candidate.voltage === systemVoltage));
    if (mcb) {
      warnings.push(`Breaker curve fallback used at ${systemVoltage}V due to limited table availability.`);
    }
  }

  if (!mcb) {
    warnings.push(`No suitable MCB found for ${systemVoltage}V`);
    return null;
  }

  // Step 5: Calculate voltage drop
  let voltageDrop = 0;
  let voltageDropPercent = 0;
  if (cableLength > 0) {
    voltageDrop = calculateVoltageDrop(cable, loadCurrent, cableLength, material, ambientTemp);
    voltageDropPercent = calculateVoltagDropPercent(voltageDrop, systemVoltage);

    if (voltageDropPercent > allowableVoltageDropPercent) {
      warnings.push(
        `Voltage drop ${voltageDropPercent.toFixed(2)}% exceeds allowed ${allowableVoltageDropPercent}%`
      );
    }
  }

  // Step 6: Calculate safety margin
  const safetyMargin = ((deCableAmpacity - loadCurrent) / deCableAmpacity) * 100;

  // Step 7: Check compliance
  const isCompliant =
    deCableAmpacity >= loadCurrent &&
    mcb.capacity >= loadCurrent &&
    voltageDropPercent <= allowableVoltageDropPercent;

  // Step 8: Add advisory notes
  if (applicationType === "motor" || applicationType === "chiller") {
    if (useStartingProtection) {
      notes.push(
        `✓ Soft-starter or VFD recommended: reduces inrush to ~${(loadCurrent * 1.5).toFixed(1)}A, allows smaller cable`
      );
    } else {
      notes.push(
        `⚠ Without starting protection: high inrush (${inrushCurrent.toFixed(1)}A) causes voltage dip. Consider soft-starter.`
      );
    }
  }

  if (cableLength > profile.minCableLength) {
    notes.push(
      `Cable run length: ${cableLength}m (minimum recommended: ${profile.minCableLength}m for ${applicationType})`
    );
  }

  notes.push(`Protection: ${profile.recommendedProtection}`);
  notes.push(`Derating applied: ${(applicationDerating * 100).toFixed(0)}% (application-specific)`);

  return {
    selectedCable: cable,
    selectedAmpacity: ampacity,
    selectedMCB: mcb,
    voltageDrop: parseFloat(voltageDrop.toFixed(3)),
    safetyMargin: parseFloat(safetyMargin.toFixed(1)),
    isCompliant,
    warnings,
    notes,
    inrushCurrent: parseFloat(inrushCurrent.toFixed(1)),
    applicationType,
    startingMethod: profile.startingMethod,
  };
}

/**
 * Comprehensive cable & MCB sizing
 */
export function sizeCableAndMCB(
  loadCurrent: number, // A
  systemVoltage: number = 230, // V
  cableLength: number = 0, // m
  loadType: "resistive" | "inductive" | "mixed" = "mixed",
  ambientTemp: number = 30, // °C
  bundledCables: number = 1,
  allowableVoltageDropPercent: number = ELECTRICAL_CONSTANTS.ACCEPTABLE_VOLTAGE_DROP,
  material: "copper" | "aluminum" = "copper"
): CableSizingResult | null {
  const warnings: string[] = [];
  const notes: string[] = [];

  // Step 1: Select cable
  const cableSizingResult = selectCableSize(
    loadCurrent,
    systemVoltage,
    cableLength,
    ambientTemp,
    bundledCables,
    allowableVoltageDropPercent,
    material
  );

  if (!cableSizingResult) {
    warnings.push("No suitable cable found for given current and conditions");
    return null;
  }

  const { cable, ampacity, deratedAmpacity } = cableSizingResult;

  // Step 2: Select MCB
  const mcb = selectMCB(loadCurrent, loadType, systemVoltage);
  if (!mcb) {
    warnings.push("No suitable MCB found for circuit current");
    return null;
  }

  // Step 3: Calculate voltage drop
  let voltageDrop = 0;
  let voltagePropercent = 0;
  if (cableLength > 0) {
    voltageDrop = calculateVoltageDrop(
      cable,
      loadCurrent,
      cableLength,
      material,
      ambientTemp
    );
    voltagePropercent = calculateVoltagDropPercent(voltageDrop, systemVoltage);

    if (voltagePropercent > allowableVoltageDropPercent) {
      warnings.push(
        `Voltage drop ${voltagePropercent.toFixed(2)}% exceeds allowed ${allowableVoltageDropPercent}%`
      );
    }
  }

  // Step 4: Calculate safety margin
  const safetyMargin =
    ((deratedAmpacity - loadCurrent) / deratedAmpacity) * 100;

  // Step 5: Check compliance
  const isCompliant =
    deratedAmpacity >= loadCurrent &&
    mcb.capacity >= loadCurrent &&
    voltagePropercent <= allowableVoltageDropPercent;

  // Add advisory notes
  if (bundledCables > 1) {
    notes.push(
      `Cable is bundled with ${bundledCables} other cables; ampacity derated accordingly`
    );
  }

  if (ambientTemp > 30) {
    notes.push(
      `High ambient temperature (${ambientTemp}°C); ampacity derated for temperature`
    );
  }

  notes.push(
    `Safety factor applied: Cable sized for ${(loadCurrent * ELECTRICAL_CONSTANTS.SAFETY_FACTOR_CABLE).toFixed(1)}A (25% margin)`
  );

  return {
    selectedCable: cable,
    selectedAmpacity: ampacity,
    selectedMCB: mcb,
    voltageDrop: parseFloat(voltageDrop.toFixed(3)),
    safetyMargin: parseFloat(safetyMargin.toFixed(1)),
    isCompliant,
    warnings,
    notes,
  };
}

/**
 * Check if cable and MCB are properly coordinated
 * Cable should break before MCB on fault
 */
export function checkCoordination(
  cable: CableSize,
  mcb: MCBRating,
  systemVoltage: number
): {
  isCoordinated: boolean;
  message: string;
} {
  // For simplicity: MCB capacity should not exceed cable ampacity × 1.25 safety factor
  const ampacityRating = getAmpacityRating(cable.id);
  if (!ampacityRating) {
    return {
      isCoordinated: false,
      message: "Cable ampacity not found",
    };
  }

  const maxMCB = ampacityRating.ampacity * 1.25;

  if (mcb.capacity <= maxMCB) {
    return {
      isCoordinated: true,
      message: `MCB (${mcb.capacity}A) properly coordinated with cable (${ampacityRating.ampacity}A rated)`,
    };
  }

  return {
    isCoordinated: false,
    message: `MCB (${mcb.capacity}A) exceeds cable ampacity (${ampacityRating.ampacity}A); cable protection inadequate`,
  };
}
