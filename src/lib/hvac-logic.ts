/**
 * HVAC Load Calculation Logic
 *
 * ##REFACTORED & ORGANIZED
 *
 * This file now serves as a backward-compatibility layer that re-exports
 * from organized domain-specific modules. For new code, import directly from
 * the specific modules in lib/hvac/*
 *
 * ## Module Organization
 *
 * - \lib/hvac/constants.ts\ - All interfaces, types, and constants
 * - \lib/hvac/geometry.ts\ - Room dimensions, areas, volumes
 * - \lib/hvac/internalGains.ts\ - People, lighting, equipment loads
 * - \lib/hvac/envelope.ts\ - Wall, roof, glass gain (CLTD, SHGF, conduction)
 * - \lib/hvac/solar.ts\ - Solar radiation (ASHRAE Clear Sky Model)
 * - \lib/hvac/ventilation.ts\ - Outdoor air conditioning loads
 * - \lib/hvac/psychrometrics.ts\ - Air properties, humidity, enthalpy
 * - \lib/hvac/sizing.ts\ - Duct and pipe sizing
 * - \lib/hvac/reheat.ts\ - Moisture management and reheat requirements
 * - \lib/hvac/parasitic.ts\ - Duct and fan heat gains
 *
 * ## ASHRAE Standards Compliance
 *
 * All calculations follow ASHRAE Fundamentals Handbook 2017 in IP Units.
 */

// Re-export all functions and types from the organized HVAC modules
export * from './hvac';
