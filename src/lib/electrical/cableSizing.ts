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
 * True for Indian/IEC three-phase voltages (e.g. 415 V, 400 V).
 * Used to switch the voltage-drop formula between 1-phase (loop) and 3-phase (line-to-line).
 */
export function isThreePhaseVoltage(systemVoltage: number): boolean {
  return systemVoltage >= 380;
}

/**
 * MCB/MCCB tables are catalogued at 400 V. Indian nameplate is 415 V.
 * Normalise only for MCB table lookup — VD %, VD calc and UI display must use the actual voltage.
 */
export function normalizeVoltageForMCBLookup(systemVoltage: number): number {
  if (systemVoltage === 415) return 400;
  return systemVoltage;
}

/**
 * Calculate voltage drop for a cable run.
 *   1-phase: VD = 2 × L × I × R         (go + return loop)
 *   3-phase: VD = √3 × L × I × R        (line-to-line, balanced)
 *
 * R = ρ(1 + α·ΔT) / A   [Ω/m]   where ρ in Ω·mm²/m and A in mm²
 * So 2·L·I·R is already in volts — no /1000 division.
 */
export function calculateVoltageDrop(
  cableSize: CableSize,
  loadCurrent: number, // Amps
  cableLength: number, // meters (one-way run length)
  material: "copper" | "aluminum" = "copper",
  ambientTemp: number = 20, // °C
  isThreePhase: boolean = false
): number {
  const resistivity =
    material === "copper"
      ? ELECTRICAL_CONSTANTS.COPPER_RESISTIVITY
      : ELECTRICAL_CONSTANTS.ALUMINUM_RESISTIVITY;

  const tempCoeff =
    material === "copper"
      ? ELECTRICAL_CONSTANTS.TEMP_COEFFICIENT_COPPER
      : ELECTRICAL_CONSTANTS.TEMP_COEFFICIENT_ALUMINUM;
  const tempFactor = 1 + tempCoeff * (ambientTemp - 20);

  // Resistance per metre of one conductor at operating temperature (Ω/m)
  const resistance = (resistivity * tempFactor) / cableSize.metric;

  const phaseFactor = isThreePhase ? Math.sqrt(3) : 2;
  return phaseFactor * cableLength * loadCurrent * resistance;
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
 * IS 3043 protective-earth (PE) conductor sizing rule, snapped to next standard IEC size.
 *   Phase ≤ 16 mm²       → PE = phase size
 *   16 < Phase ≤ 35 mm²  → PE = 16 mm²
 *   Phase > 35 mm²       → PE = phase / 2 (rounded up to next standard cross-section)
 */
export function is3043EarthConductorMm2(phaseMm2: number): number {
  const standardSizes = [1, 1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300, 400];
  const snapUp = (raw: number) => standardSizes.find((s) => s >= raw) ?? standardSizes[standardSizes.length - 1];

  if (phaseMm2 <= 16) return phaseMm2;
  if (phaseMm2 <= 35) return 16;
  return snapUp(phaseMm2 / 2);
}

/**
 * IS 732 minimum phase-conductor cross-section for fixed wiring.
 *   Lighting final sub-circuit: 1.5 mm² Cu
 *   Power / socket / general:   2.5 mm² Cu
 *   Aluminium fixed wiring:     16  mm² minimum
 */
export function is732MinimumPhaseMm2(
  application: ApplicationType,
  material: "copper" | "aluminum"
): number {
  if (material === "aluminum") return 16; // IS 732 Cl 16.2.1
  if (application === "lighting") return 1.5;
  return 2.5; // power / motor / heater / general
}

/**
 * IS 7098 Pt.1 ambient-temperature correction factors for XLPE (90°C) conductors.
 * Reference ambient: 40°C (factor 1.00). XLPE is more tolerant of high ambient than PVC.
 */
function is7098TempFactor(ambient: number): number {
  const tbl: Array<[number, number]> = [
    [25, 1.04],
    [30, 1.03],
    [35, 1.02],
    [40, 1.00], // reference
    [45, 0.96],
    [50, 0.91],
    [55, 0.87],
    [60, 0.82],
    [65, 0.76],
    [70, 0.71],
    [75, 0.65],
    [80, 0.58],
  ];
  if (ambient <= tbl[0][0]) return tbl[0][1];
  if (ambient >= tbl[tbl.length - 1][0]) return tbl[tbl.length - 1][1];
  for (let i = 0; i < tbl.length - 1; i++) {
    const [t0, f0] = tbl[i];
    const [t1, f1] = tbl[i + 1];
    if (ambient >= t0 && ambient <= t1) {
      const frac = (ambient - t0) / (t1 - t0);
      return f0 + frac * (f1 - f0);
    }
  }
  return 1.0;
}

/**
 * IS 3961 Pt.2 ambient-temperature correction factors for PVC (70°C) conductors.
 * Reference ambient: 40°C (factor 1.00). Values below 40°C may *uprate*; above 40°C derate.
 * Linear interpolation between tabulated points.
 */
function is3961TempFactor(ambient: number): number {
  // (ambient °C, factor)
  const tbl: Array<[number, number]> = [
    [25, 1.06],
    [30, 1.04],
    [35, 1.02],
    [40, 1.00], // reference
    [45, 0.95],
    [50, 0.89],
    [55, 0.84],
    [60, 0.77],
    [65, 0.71],
    [70, 0.63],
  ];
  if (ambient <= tbl[0][0]) return tbl[0][1];
  if (ambient >= tbl[tbl.length - 1][0]) return tbl[tbl.length - 1][1];
  for (let i = 0; i < tbl.length - 1; i++) {
    const [t0, f0] = tbl[i];
    const [t1, f1] = tbl[i + 1];
    if (ambient >= t0 && ambient <= t1) {
      const frac = (ambient - t0) / (t1 - t0);
      return f0 + frac * (f1 - f0);
    }
  }
  return 1.0;
}

/**
 * IS 3961 Pt.2 Table 5 grouping (bundling) derating factors for cables
 * installed bunched in conduit or on a tray.
 */
function is3961BundlingFactor(bundledCables: number): number {
  if (bundledCables <= 1) return 1.0;
  if (bundledCables === 2) return 0.80;
  if (bundledCables === 3) return 0.70;
  if (bundledCables === 4) return 0.65;
  if (bundledCables === 5) return 0.60;
  if (bundledCables === 6) return 0.57;
  if (bundledCables === 7) return 0.54;
  if (bundledCables === 8) return 0.52;
  if (bundledCables <= 11) return 0.50;
  return 0.45; // 12 cables and above
}

/**
 * Apply derating factors to ampacity.
 *   Temperature correction: IS 3961 Pt.2 for PVC (70°C), IS 7098 Pt.1 for XLPE (90°C)
 *   Bundling: IS 3961 Pt.2 Table 5
 *   Reference ambient: 40°C (Indian convention)
 */
export function applyDeratingFactors(
  baseAmpacity: number,
  ambientTemp: number = 40, // °C — IS 3961 / IS 7098 reference ambient
  bundledCables: number = 1, // Number of cables in same conduit / tray
  conduitFillPercentage: number = 40, // % (IS 732 / NEC limit: 40%)
  insulationType: 'PVC' | 'XLPE' = 'PVC'
): { deratedAmpacity: number; factors: { [key: string]: number } } {
  const factors: { [key: string]: number } = {};

  let deratedAmpacity = baseAmpacity;

  // Temperature correction — table depends on insulation conductor max temp.
  if (ambientTemp !== 40) {
    const tempFactor = insulationType === 'XLPE'
      ? is7098TempFactor(ambientTemp)
      : is3961TempFactor(ambientTemp);
    factors.temperature = Math.max(tempFactor, 0.5);
    deratedAmpacity *= factors.temperature;
  }

  // Bundling/grouping derating — IS 3961 Pt.2 Table 5
  const bundlingFactor = is3961BundlingFactor(bundledCables);
  if (bundlingFactor < 1.0) {
    factors.bundling = bundlingFactor;
    deratedAmpacity *= bundlingFactor;
  }

  // Conduit fill derating (if exceeding 40%) per IS 732
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
 * XLPE 90°C cables carry ~25% more current than equivalent PVC 70°C cables
 * (IS 7098 Pt.1 vs IS 3961 Pt.2 ratio for same Cu cross-section).
 */
const XLPE_AMPACITY_UPLIFT = 1.25;

/**
 * Find best cable size for a given load current.
 *
 * Honours:
 *   • IS 732 minimum phase cross-section (1.5 mm² lighting, 2.5 mm² power, 16 mm² Al)
 *   • Insulation uplift for XLPE vs PVC (IS 7098 vs IS 3961)
 */
export function selectCableSize(
  loadCurrent: number, // A
  systemVoltage: number = 230, // V (230V single-phase or 400V 3-phase)
  cableLength: number = 0, // m (optional, for voltage drop check)
  ambientTemp: number = 40,
  bundledCables: number = 1,
  allowableVoltageDropPercent: number = ELECTRICAL_CONSTANTS.ACCEPTABLE_VOLTAGE_DROP,
  material: "copper" | "aluminum" = "copper",
  insulationType: 'PVC' | 'XLPE' = 'PVC',
  is732MinMm2: number = 0
): { cable: CableSize; ampacity: AmpacityRating; deratedAmpacity: number } | null {
  // Apply safety factor to load current
  const requiredCurrent = loadCurrent * ELECTRICAL_CONSTANTS.SAFETY_FACTOR_CABLE;
  // Practical rule: for same cross-section, aluminum carries less current than copper.
  const materialAmpacityFactor = material === "aluminum" ? 0.8 : 1.0;
  // XLPE ampacity uplift over PVC base table values
  const insulationFactor = insulationType === 'XLPE' ? XLPE_AMPACITY_UPLIFT : 1.0;

  // Prefer IEC metric sizes first for IS/IEC workflows; fallback to full catalog if needed.
  const iecCatalog = CABLE_SIZES.filter((cable) => cable.awg == null && cable.id.endsWith("mm2"));
  const catalogs: CableSize[][] = [iecCatalog, CABLE_SIZES];

  for (const catalog of catalogs) {
    if (!catalog.length) continue;
    for (const cable of catalog) {
      // IS 732 minimum cross-section guard
      if (cable.metric < is732MinMm2) continue;

      const ampacityRating = getAmpacityRating(cable.id);
      if (!ampacityRating) continue;

      const { deratedAmpacity } = applyDeratingFactors(
        ampacityRating.ampacity * materialAmpacityFactor * insulationFactor,
        ambientTemp,
        bundledCables,
        40,
        insulationType
      );

      if (deratedAmpacity < requiredCurrent) continue;

      if (cableLength > 0) {
        const vd = calculateVoltageDrop(
          cable,
          requiredCurrent,
          cableLength,
          material,
          ambientTemp,
          isThreePhaseVoltage(systemVoltage)
        );
        const vdPercent = calculateVoltagDropPercent(vd, systemVoltage);

        if (vdPercent > allowableVoltageDropPercent) continue;
      }

      return { cable, ampacity: ampacityRating, deratedAmpacity };
    }
  }

  return null;
}

/**
 * Find best MCB for a given circuit current.
 *
 * IS 8544 / IS 13947 motor branch rule: MCB rating ≥ 1.25 × motor FLA
 * to prevent nuisance trip during continuous duty and short start transient.
 * Resistive / mixed loads use MCB ≥ FLA.
 */
export function selectMCB(
  circuitCurrent: number, // A — motor FLA or load rated current
  loadType: "resistive" | "inductive" | "mixed" = "mixed",
  systemVoltage: number = 230 // V
): MCBRating | null {
  // Curve selection by load type (IEC 60898 / IS 13947)
  let preferredType = "Type C"; // mixed loads
  if (loadType === "resistive") preferredType = "Type B";
  if (loadType === "inductive") preferredType = "Type D";

  // Continuous-duty / motor branch margin
  const motorMargin = loadType === "inductive" ? 1.25 : 1.0;
  const minCapacity = circuitCurrent * motorMargin;

  // Find breakers matching voltage and type (normalise 415 V → 400 V for table lookup only)
  const mcbLookupVoltage = normalizeVoltageForMCBLookup(systemVoltage);
  const candidateMCBs = MCB_RATINGS.filter(
    (mcb) => mcb.voltage === mcbLookupVoltage && mcb.type === preferredType
  );

  // Select smallest MCB ≥ minCapacity
  for (const mcb of candidateMCBs.sort((a, b) => a.capacity - b.capacity)) {
    if (mcb.capacity >= minCapacity) {
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
    // DOL motor / direct-start: IS 8544 motor branch rule = 125% × FLA for cable continuous ampacity.
    // Peak inrush (5–8× FLA, 200 ms) is handled by breaker curve (Type D / MCCB Im setting),
    // not by oversizing the cable.
    effectiveCurrent = ratedCurrent * 1.25;
    recommendation = `DOL / direct-start: cable sized at 1.25 × FLA = ${effectiveCurrent.toFixed(1)}A per IS 8544. Peak inrush ${inrushCurrent.toFixed(1)}A is handled by breaker curve, not cable.`;
  }

  return {
    effectiveCurrent,
    inrushCurrent,
    recommendation,
  };
}

/**
 * Comprehensive cable & MCB sizing considering application type and inrush.
 *
 * Indian standards honoured:
 *   IS 3961 Pt.2 — PVC cable ampacity + temperature/bundling derating
 *   IS 7098 Pt.1 — XLPE cable ampacity uplift + temperature derating
 *   IS 8544 / IS 13947 — motor branch sizing (cable ≥ 1.25 × FLA, MCB ≥ 1.25 × FLA)
 *   IS 732 — minimum cross-section, voltage-drop limits, coordination
 *   IS 3043 — PE / earth conductor sizing
 *   IS 13947-2 — MCCB breaking-capacity (Icu) coordination
 */
export function sizeCableAndMCBWithApplication(
  loadCurrent: number, // A — rated/design current per phase
  applicationType: ApplicationType = 'general',
  systemVoltage: number = 230, // V
  cableLength: number = 0, // m
  ambientTemp: number = 40, // °C — IS reference 40°C
  bundledCables: number = 1,
  allowableVoltageDropPercent: number = ELECTRICAL_CONSTANTS.ACCEPTABLE_VOLTAGE_DROP,
  material: "copper" | "aluminum" = "copper",
  useStartingProtection: boolean = false,
  customInrushMultiplier?: number,
  insulationType: 'PVC' | 'XLPE' = 'PVC',
  diversityFactor: number = 1.0,
  prospectiveFaultKA: number = 10
): CableSizingResult | null {
  const profile = getApplicationProfile(applicationType);
  const warnings: string[] = [];
  const notes: string[] = [];

  // Apply diversity factor to design current (IS 732 Sec. 8 / IEC 60364-1)
  const diversityClamped = Math.max(0.1, Math.min(1.0, diversityFactor));
  const designCurrent = loadCurrent * diversityClamped;
  if (diversityClamped < 1.0) {
    notes.push(`Diversity factor ${diversityClamped.toFixed(2)} applied: design current ${loadCurrent.toFixed(1)}A → ${designCurrent.toFixed(1)}A.`);
  }

  // Step 1: Calculate inrush and effective sizing current
  const inrushCalcs = calculateInrushBasedSizing(
    designCurrent,
    applicationType,
    useStartingProtection,
    customInrushMultiplier
  );
  const inrushCurrent = inrushCalcs.inrushCurrent;
  const effectiveCurrentForCable = inrushCalcs.effectiveCurrent;

  notes.push(`Application: ${profile.label}`);
  notes.push(`Insulation: ${insulationType === 'XLPE' ? 'XLPE 90°C (IS 7098 Pt.1)' : 'PVC 70°C (IS 3961 Pt.2)'}`);
  if (material === "aluminum") {
    notes.push("Aluminium conductor: ampacity ~80% of equivalent Cu; IS 732 fixed-wiring minimum cross-section = 16 mm².");
  }
  notes.push(`Inrush: ${inrushCurrent.toFixed(1)}A (${profile.inrushMultiplier}× rated), Duration: ~${profile.inrushDuration}ms`);
  notes.push(inrushCalcs.recommendation);

  // Step 2: Select cable based on effective current
  const is732Min = is732MinimumPhaseMm2(applicationType, material);
  const cableSizingResult = selectCableSize(
    effectiveCurrentForCable,
    systemVoltage,
    cableLength,
    ambientTemp,
    bundledCables,
    allowableVoltageDropPercent,
    material,
    insulationType,
    is732Min
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
        const insulationFactor = insulationType === 'XLPE' ? XLPE_AMPACITY_UPLIFT : 1.0;
        const nextDeratedAmpacity = applyDeratingFactors(
          nextAmpacity.ampacity * materialAmpacityFactor * insulationFactor,
          ambientTemp,
          bundledCables,
          40,
          insulationType
        ).deratedAmpacity;

        const previousMetric = cable.metric;
        cable = nextCable;
        ampacity = nextAmpacity;
        deratedAmpacity = nextDeratedAmpacity;

        notes.push(
          `DOL motor size jump applied: ${previousMetric} mm² → ${cable.metric} mm² (engineering practice to limit starting voltage dip).`
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
          const insulationFactor = insulationType === 'XLPE' ? XLPE_AMPACITY_UPLIFT : 1.0;
          const minDeratedAmpacity = applyDeratingFactors(
            minAmpacity.ampacity * materialAmpacityFactor * insulationFactor,
            ambientTemp,
            bundledCables,
            40,
            insulationType
          ).deratedAmpacity;

          const previousMetric = cable.metric;
          cable = minCable;
          ampacity = minAmpacity;
          deratedAmpacity = minDeratedAmpacity;

          notes.push(
            `DOL motor minimum floor applied: ${previousMetric} mm² → ${cable.metric} mm² (minimum ${dolMinMetric} mm²).`
          );
        }
      }
    }
  }

  // Step 3: Apply application-specific derating
  const applicationDerating = profile.derating;
  const deCableAmpacity = deratedAmpacity * applicationDerating;

  if (deCableAmpacity < designCurrent) {
    warnings.push(
      `After ${applicationType} derating (${(applicationDerating * 100).toFixed(0)}%): available capacity ${deCableAmpacity.toFixed(1)}A < required ${designCurrent.toFixed(1)}A`
    );
  }

  // Step 4: Select MCB
  // Curve: Type D for DOL motor / chiller, Type C otherwise (IS 13947 / IEC 60898)
  let preferredMCBType = "Type C";
  if (applicationType === "motor" && !useStartingProtection) {
    preferredMCBType = "Type D";
  }
  if (applicationType === "chiller") {
    preferredMCBType = "Type D";
  }

  // IS 8544 / IS 13947 motor branch rule: MCB rating ≥ 1.25 × motor FLA.
  // Heater / lighting / general loads: MCB ≥ design current (no continuous-motor margin needed).
  const isMotorLike =
    applicationType === "motor" ||
    applicationType === "chiller" ||
    applicationType === "pump";
  const mcbMinCurrent = isMotorLike ? designCurrent * 1.25 : designCurrent;

  // Find smallest breaker in pool that meets minCapacity. Returns null if none adequate.
  const pickAdequate = (pool: MCBRating[]) => {
    const sorted = [...pool].sort((a, b) => a.capacity - b.capacity);
    return sorted.find((m) => m.capacity >= mcbMinCurrent) || null;
  };

  // MCB catalog is indexed at 230 V / 400 V — normalise Indian 415 V to 400 V for lookup only.
  const mcbLookupVoltage = normalizeVoltageForMCBLookup(systemVoltage);
  let mcb: MCBRating | null = pickAdequate(
    MCB_RATINGS.filter((m) => m.voltage === mcbLookupVoltage && m.type === preferredMCBType)
  );

  // Escalate to MCCB tier when the MCB curve cannot meet the rating
  // (typical break-points: Type D MCB tops out at 63A 3P; Type C MCB at 160A 3P).
  if (!mcb) {
    mcb = pickAdequate(
      MCB_RATINGS.filter((m) => m.voltage === mcbLookupVoltage && m.type === "MCCB")
    );
    if (mcb) {
      const imHint = preferredMCBType === "Type D"
        ? "Set Im (magnetic trip) to 8–10× In for motor inrush ride-through (IS 13947-2)."
        : "Set Im (magnetic trip) to 5–7× In for general distribution loads (IS 13947-2).";
      notes.push(
        `MCCB selected (${mcb.capacity}A): ${preferredMCBType} MCB tier exhausted at this rating. ${imHint}`
      );
    }
  }

  // Same-tier curve fallback (e.g., Type D unavailable → try Type C).
  if (!mcb) {
    const fallbackType = preferredMCBType === "Type D" ? "Type C" : "Type B";
    mcb = pickAdequate(
      MCB_RATINGS.filter((m) => m.voltage === mcbLookupVoltage && m.type === fallbackType)
    );
    if (mcb) {
      warnings.push(`Preferred ${preferredMCBType} not available at ${systemVoltage}V; selected ${fallbackType} as nearest practical option.`);
    }
  }

  // Last resort: largest breaker on this voltage rail, with explicit warning that it is undersized.
  if (!mcb) {
    const anyPool = MCB_RATINGS.filter((m) => m.voltage === mcbLookupVoltage).sort((a, b) => a.capacity - b.capacity);
    if (anyPool.length) {
      mcb = anyPool[anyPool.length - 1];
      warnings.push(
        `No breaker in catalog meets the required ${mcbMinCurrent.toFixed(0)}A at ${systemVoltage}V. ` +
        `Largest available (${mcb.capacity}A) selected as a placeholder — specify a higher-rating MCCB / ACB from the manufacturer catalog.`
      );
    }
  }

  if (!mcb) {
    warnings.push(`No suitable MCB found for ${systemVoltage}V`);
    return null;
  }

  if (isMotorLike) {
    notes.push(
      `MCB sized at ≥1.25× FLA per IS 8544 / IS 13947 motor branch rule (min ${mcbMinCurrent.toFixed(1)}A → ${mcb.capacity}A ${mcb.type}).`
    );
  }

  // IS 732 / IEC 60364-4-43 coordination: I_n (MCB rating) ≤ I_z (cable derated ampacity).
  // If the selected MCB exceeds cable ampacity, escalate the cable.
  if (mcb.capacity > deratedAmpacity) {
    const materialAmpacityFactor = material === "aluminum" ? 0.8 : 1.0;
    const insulationFactor = insulationType === 'XLPE' ? XLPE_AMPACITY_UPLIFT : 1.0;
    const iecCatalog = CABLE_SIZES
      .filter((candidate) => candidate.awg == null && candidate.id.endsWith("mm2"))
      .sort((a, b) => a.metric - b.metric);

    let upsizedCable: CableSize | undefined;
    let upsizedAmpacity: AmpacityRating | undefined;
    let upsizedDeratedAmpacity = 0;

    for (const candidate of iecCatalog) {
      if (candidate.metric <= cable.metric) continue;
      const candAmpacity = getAmpacityRating(candidate.id);
      if (!candAmpacity) continue;
      const candDerated = applyDeratingFactors(
        candAmpacity.ampacity * materialAmpacityFactor * insulationFactor,
        ambientTemp,
        bundledCables,
        40,
        insulationType
      ).deratedAmpacity;
      if (candDerated >= mcb.capacity) {
        upsizedCable = candidate;
        upsizedAmpacity = candAmpacity;
        upsizedDeratedAmpacity = candDerated;
        break;
      }
    }

    if (upsizedCable && upsizedAmpacity) {
      const previousMetric = cable.metric;
      cable = upsizedCable;
      ampacity = upsizedAmpacity;
      deratedAmpacity = upsizedDeratedAmpacity;
      notes.push(
        `Cable escalated ${previousMetric} mm² → ${cable.metric} mm² to honour I_n ≤ I_z (IS 732 / IEC 60364-4-43).`
      );
    } else {
      warnings.push(
        `Coordination violated: MCB ${mcb.capacity}A > cable ampacity ${deratedAmpacity.toFixed(1)}A. Increase cable size or step down MCB.`
      );
    }
  }

  // Step 5: Calculate voltage drop (at design current)
  let voltageDrop = 0;
  let voltageDropPercent = 0;
  if (cableLength > 0) {
    voltageDrop = calculateVoltageDrop(
      cable,
      designCurrent,
      cableLength,
      material,
      ambientTemp,
      isThreePhaseVoltage(systemVoltage)
    );
    voltageDropPercent = calculateVoltagDropPercent(voltageDrop, systemVoltage);

    if (voltageDropPercent > allowableVoltageDropPercent) {
      warnings.push(
        `Voltage drop ${voltageDropPercent.toFixed(2)}% exceeds allowed ${allowableVoltageDropPercent}%`
      );
    }
  }

  // Step 6: Calculate safety margin
  const safetyMargin = ((deCableAmpacity - designCurrent) / deCableAmpacity) * 100;

  // Step 7: PE / earth conductor sizing per IS 3043
  const earthConductorMm2 = is3043EarthConductorMm2(cable.metric);
  notes.push(
    `PE / earth conductor (IS 3043): ${earthConductorMm2} mm² Cu for ${cable.metric} mm² phase.`
  );

  // Step 8: IS 13947-2 breaking-capacity (Icu) coordination
  let icuCheckPassed: boolean | undefined;
  let icuRequiredKA: number | undefined;
  if (mcb.breakingCapacityKA != null) {
    icuRequiredKA = prospectiveFaultKA;
    icuCheckPassed = mcb.breakingCapacityKA >= prospectiveFaultKA;
    if (!icuCheckPassed) {
      warnings.push(
        `Breaking capacity inadequate: breaker Icu ${mcb.breakingCapacityKA}kA < prospective fault ${prospectiveFaultKA}kA. ` +
        `Select a higher Icu frame from the manufacturer catalog or add a current-limiting upstream device (IS 13947-2).`
      );
    } else {
      notes.push(
        `Breaking capacity OK: breaker Icu ${mcb.breakingCapacityKA}kA ≥ prospective fault ${prospectiveFaultKA}kA (IS 13947-2).`
      );
    }
  } else {
    // MCB without catalogued Icu — typical commercial MCBs are 6–10 kA per IS/IEC 60898.
    notes.push(
      `Breaking capacity: confirm MCB Icu ≥ ${prospectiveFaultKA}kA from manufacturer datasheet (typical IS/IEC 60898 MCBs: 6–10 kA).`
    );
  }

  // Step 9: Check compliance — coordination, ampacity, MCB, voltage drop, and Icu
  const isCompliant =
    deCableAmpacity >= designCurrent &&
    mcb.capacity >= mcbMinCurrent &&
    mcb.capacity <= deratedAmpacity &&
    voltageDropPercent <= allowableVoltageDropPercent &&
    (icuCheckPassed !== false);

  // Step 10: Add advisory notes
  if (applicationType === "motor" || applicationType === "chiller") {
    if (useStartingProtection) {
      notes.push(
        `✓ Soft-starter or VFD recommended: reduces inrush to ~${(designCurrent * 1.5).toFixed(1)}A, allows smaller cable.`
      );
    } else {
      notes.push(
        `⚠ Without starting protection: high inrush (${inrushCurrent.toFixed(1)}A) causes voltage dip. Consider soft-starter.`
      );
    }
  }

  if (cableLength > profile.minCableLength) {
    notes.push(
      `Cable run length: ${cableLength}m (minimum recommended: ${profile.minCableLength}m for ${applicationType}).`
    );
  }

  notes.push(`Protection: ${profile.recommendedProtection}`);
  notes.push(`Application-specific derating applied: ${(applicationDerating * 100).toFixed(0)}%.`);

  return {
    selectedCable: cable,
    selectedAmpacity: ampacity,
    deratedAmpacity: parseFloat(deratedAmpacity.toFixed(1)),
    selectedMCB: mcb,
    voltageDrop: parseFloat(voltageDrop.toFixed(3)),
    safetyMargin: parseFloat(safetyMargin.toFixed(1)),
    isCompliant,
    warnings,
    notes,
    inrushCurrent: parseFloat(inrushCurrent.toFixed(1)),
    applicationType,
    startingMethod: profile.startingMethod,
    earthConductorMm2,
    insulationType,
    diversityFactorApplied: diversityClamped,
    icuRequiredKA,
    icuCheckPassed,
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
      ambientTemp,
      isThreePhaseVoltage(systemVoltage)
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
    deratedAmpacity: parseFloat(deratedAmpacity.toFixed(1)),
    selectedMCB: mcb,
    voltageDrop: parseFloat(voltageDrop.toFixed(3)),
    safetyMargin: parseFloat(safetyMargin.toFixed(1)),
    isCompliant,
    warnings,
    notes,
  };
}

/**
 * Verify IS 732 / IEC 60364-4-43 coordination between cable and MCB.
 *   Rule: I_B ≤ I_n ≤ I_z
 *     I_B = design (load) current
 *     I_n = MCB rated current (must not exceed cable continuous ampacity)
 *     I_z = cable continuous current-carrying capacity at site conditions
 *
 * Pass deratedAmpacity (I_z) when available — that is the value to compare against.
 * Falls back to base table ampacity if not supplied.
 */
export function checkCoordination(
  cable: CableSize,
  mcb: MCBRating,
  _systemVoltage: number,
  deratedAmpacity?: number
): {
  isCoordinated: boolean;
  message: string;
} {
  const ampacityRating = getAmpacityRating(cable.id);
  if (!ampacityRating) {
    return {
      isCoordinated: false,
      message: "Cable ampacity not found",
    };
  }

  const Iz = deratedAmpacity ?? ampacityRating.ampacity;
  const IzSource = deratedAmpacity != null ? "derated I_z" : "base table ampacity";

  if (mcb.capacity <= Iz) {
    return {
      isCoordinated: true,
      message: `Coordinated per IS 732 / IEC 60364-4-43: MCB ${mcb.capacity}A ≤ cable ${Iz.toFixed(1)}A (${IzSource}).`,
    };
  }

  return {
    isCoordinated: false,
    message: `Coordination violated: MCB ${mcb.capacity}A > cable ${Iz.toFixed(1)}A (${IzSource}). Increase cable size or step down MCB.`,
  };
}
