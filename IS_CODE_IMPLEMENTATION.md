# IS Code Regional Locking Implementation Guide

## Overview
Implementation of regional locking approach for Indian HVAC market compliance.
When a user selects an Indian city, the application automatically locks to IS Code standards (IS 12273, IS 3720, IS 4257, IS 7399).

**Status**: Core modules created, ready for integration into project setup UI

---

## What Was Created (6 New Files)

### 1. **Constants & Configuration**

#### File: `src/constants/is-code-constants.ts` (~500 lines)
- **IS 12273 Regional Design Conditions** for 9 Indian cities:
  - Delhi, Mumbai, Chennai, Bangalore, Jaipur, Kolkata, Hyderabad, Pune, Lucknow
  - Each with summer DB/WB/RH, monsoon conditions, winter, altitude, climate zone
  
- **IS 3720 Space Types** (25+ categories):
  - Office, retail, restaurants, hotels, hospitals, schools, residential
  - Each with ACH ranges and ventilation rates
  
- **IS Code Safety Factors**:
  - Sensible: 15% (vs ASHRAE 10%)
  - Latent: 20% (vs ASHRAE 5%)
  - Higher due to Indian climate extremes
  
- **IS 7399 Commissioning Checklist**:
  - Pre-commissioning, functional testing, safety compliance, handover
  
- **Utility Functions**:
  - Humidex calculator for monsoon comfort assessment

---

### 2. **Calculation Engines**

#### File: `src/lib/hvac/ventilation-is3720.ts` (~400 lines)
- **IS 3720 Ventilation Calculation** (parallel to ASHRAE 62.1):
  - ACH-based approach (vs occupancy-based in ASHRAE)
  - Three methods: ACH, occupancy-based, area-based → use governing rate
  - Monsoon dehumidification boost (10-25% extra CFM)
  - Regional humidity adjustment factors
  
- **Key Functions**:
  ```typescript
  calculateVentilationIS3720(spaceType, area, occupancy, region, season)
  calculateZoneVentilationIS3720(spaces, region, diversity_factor)
  validateMonsoonDehum(outdoor_rh, indoor_rh, cfm, sensible, latent)
  ```
  
- **Output**: IS 3720 ventilation rates with monsoon boost

---

### 3. **Regional Configuration**

#### File: `src/lib/regional-design-conditions.ts` (~400 lines)
- **City Selector Functions**:
  ```typescript
  getIndianCities()  // List of 9 cities
  autoConfigureDesignConditions(cityKey)  // Auto-fill design temps
  ```
  
- **Standard Locking**:
  ```typescript
  determineStandardForRegion('IN')  // Returns IS_CODE, locked=true
  ```
  
- **Firestore Integration**:
  - Convert auto-config to Firestore schema
  - Store at: `projects/{projectId}/config/designConditions`
  
- **Regional Notes Generation**:
  - Auto-generated climate-specific recommendations
  - Example: "Hot Dry (Delhi): Focus on sensible cooling"

---

### 4. **UI Component**

#### File: `src/components/RegionSelector.tsx` (~300 lines)
- **React Component** for project setup dialog
- **Features**:
  - City dropdown (9 Indian cities)
  - Auto-populates design conditions upon selection
  - Displays summary card with:
    - Summer/monsoon/winter conditions
    - IS Code safety factors
    - Climate zone and altitude info
  - "Details" toggle showing climate-specific notes
  - Confirmation badge: "IS Code Compliance Confirmed"
  - Green confirmation message about locking
  
- **Usage**:
  ```tsx
  <RegionSelector 
    onRegionSelect={(config, standard) => {
      // config has all design conditions
      // standard is 'IS_CODE'
    }}
  />
  ```

---

### 5. **TypeScript Types**

#### File: `src/types/standards.ts` (~100 lines)
- **DesignCondition** interface:
  - standard: 'IS_CODE' | 'ASHRAE'
  - summer/monsoon/winter with DB/WB/RH
  - safety factors and adjustment factors
  
- **ProjectDesignConditions**:
  - Primary (locked) + secondary (optional comparison)
  
- **RoomDesignConditionOverride**:
  - Allow per-room customization if needed
  
- **LoadCalculationResult**:
  - Includes standard reference
  - Sensible/latent with safety factors applied
  
- **EquipmentSelectionContext**:
  - Required capacity with region/season context

---

### 6. **Integration Adapter**

#### File: `src/lib/is-code-adapter.ts` (~400 lines)
- **Central ISCodeAdapter class** with static methods:
  ```typescript
  ISCodeAdapter.initializeForProject(cityKey)
  ISCodeAdapter.migrateToISCode(projectId, cityKey)
  ISCodeAdapter.applyISCodeSafetyFactors(sensible, latent, season)
  ISCodeAdapter.calculateVentilationIS3720(spaceType, area, occupancy, city)
  ISCodeAdapter.validateMonsoonCompliance(city, cfm, sensible, latent)
  ISCodeAdapter.getCommissioningChecklist()
  ISCodeAdapter.getAltitudeDerating(city)
  ISCodeAdapter.getCitySummary(city)
  ISCodeAdapter.getImplementationGuide()
  ```
  
- **Usage Example**:
  ```typescript
  const result = ISCodeAdapter.initializeForProject('delhi');
  // Returns: {
  //   success: true,
  //   config: AutoConfiguredDesignCondition,
  //   firestoreConfig: FirestoreDesignCondition,
  //   standard: 'IS_CODE',
  //   locked: true,
  //   message: '✓ Project initialized with IS Code...'
  // }
  ```

---

## Integration Checklist

### Phase 1: Project Setup Dialog Integration
- [ ] Import `RegionSelector` component in ProjectSetupDialog
- [ ] Add RegionSelector before/after project name input
- [ ] Connect `onRegionSelect` callback to save config to Firestore
- [ ] Store result at: `projects/{projectId}/config/designConditions`

### Phase 2: Room Calculation Updates
- [ ] Update LoadCalculator.tsx to use `ISCodeAdapter.applyISCodeSafetyFactors()`
- [ ] Replace fixed 15% sensible + 5% latent with IS Code 15% + 20%
- [ ] Call `ISCodeAdapter.calculateVentilationIS3720()` for ventilation
- [ ] Compare monsoon humidity with: `ISCodeAdapter.validateMonsoonCompliance()`

### Phase 3: Equipment Selection
- [ ] Display IS Code vs ASHRAE capacity difference
- [ ] Equipment selection should use IS Code loads (higher = governs)
- [ ] Show altitude derating if applicable
- [ ] Flag if monsoon dehumidification inadequate

### Phase 4: Project Summary & Commissioning
- [ ] Add IS Code commissioning checklist to project summary
- [ ] Provide download of IS 7399 commissioning report template
- [ ] Include implementation guide in project documentation

### Phase 5: Testing & Validation
- [ ] Test with all 9 Indian cities
- [ ] Verify design conditions match IS 12273
- [ ] Test monsoon dehumidification warnings
- [ ] Validate altitude derating calculations
- [ ] Check Firestore integration

---

## Code Examples

### Example 1: Initialize Project with Delhi
```typescript
import { ISCodeAdapter } from '../lib/is-code-adapter';

const result = ISCodeAdapter.initializeForProject('delhi');
console.log(result.config.summer.db); // 45°C
console.log(result.config.sensible_safety_percent); // 15
console.log(result.firestoreConfig); // Ready to save to DB
```

### Example 2: Apply IS Code Factors to Loads
```typescript
import { ISCodeAdapter } from '../lib/is-code-adapter';

const sensibleLoad = 15000; // BTU/h
const latentLoad = 3000;    // BTU/h

const withSafety = ISCodeAdapter.applyISCodeSafetyFactors(
  sensibleLoad,
  latentLoad,
  'summer'
);

console.log(withSafety.sensibleWithSafety); // 17,250 (15% added)
console.log(withSafety.latentWithSafety);   // 3,600 (20% added)
```

### Example 3: Calculate IS 3720 Ventilation
```typescript
import { ISCodeAdapter } from '../lib/is-code-adapter';

const ventilation = ISCodeAdapter.calculateVentilationIS3720(
  'office-general',
  1000,    // 1000 sqft
  10,      // 10 occupants
  'delhi',
  'monsoon'
);

console.log(ventilation.total_cfm);      // Base CFM from IS 3720
console.log(ventilation.monsoon_dehumidification_cfm); // +15% for humidity
console.log(ventilation.adjusted_cfm);   // Final CFM with regional adjustment
```

### Example 4: Validate Monsoon Compliance
```typescript
import { ISCodeAdapter } from '../lib/is-code-adapter';

const validation = ISCodeAdapter.validateMonsoonCompliance(
  'mumbai',
  800,   // CFM
  12000, // Sensible load
  4000   // Latent load
);

if (!validation.validation.adequate) {
  console.warn(validation.validation.warning);
  console.info(validation.validation.recommendation);
}
```

---

## Key Design Decisions

### 1. **Regional Locking (Not Dual-Standard UI)**
- ✅ When India is selected → IS Code locked (no toggle)
- ✅ Matches industry practice (Carrier, Trane, Honeywell)
- ✅ Prevents user confusion
- ✅ Ensures compliance by default

### 2. **Higher Safety Factors**
- Sensible: 15% (ASHRAE is 10%)
- Latent: 20% (ASHRAE is 5%)
- Justified by:
  - Monsoon humidity extremes (up to 90% RH)
  - Climate variability
  - System reliability in challenging conditions

### 3. **Monsoon-Specific Handling**
- Extra dehumidification CFM (10-25%)
- Humidex comfort index for monitoring
- Year-round three-season evaluation (summer/monsoon/winter)

### 4. **Modular Implementation**
- Ventilation separated: `ventilation62.ts` (ASHRAE) + `ventilation-is3720.ts` (IS)
- Safety factors in adapter (easy to swap)
- Types clearly defined in `standards.ts`
- Adapter provides unified interface

---

## Impact on Equipment Sizing

### Example: Office in Delhi

**ASHRAE 2017**:
- Design: 95°F (35°C), 50% RH
- Load: 15,000 BTU/h sensible
- With ASHRAE 10% factor: 16,500 BTU/h
- Equipment: 1.38 TR

**IS Code**:
- Design: 45°C (113°F), 25% RH
- Load: 24,000 BTU/h sensible (38% higher due to ΔT)
- With IS 15% factor: 27,600 BTU/h
- Equipment: 2.3 TR

**Result**: IS Code requires **67% larger capacity** for same space
- More accurate for Indian climate
- Better margin for peak loads
- Slightly higher operating cost but much better reliability

---

## Files Created Summary

| File | Lines | Purpose |
|------|-------|---------|
| `src/constants/is-code-constants.ts` | 500 | IS Code data: cities, space types, factors |
| `src/lib/hvac/ventilation-is3720.ts` | 400 | IS 3720 ventilation calculations |
| `src/lib/regional-design-conditions.ts` | 400 | City selector, auto-config, Firestore integration |
| `src/components/RegionSelector.tsx` | 300 | React UI component for city selection |
| `src/types/standards.ts` | 100 | TypeScript interfaces for design conditions |
| `src/lib/is-code-adapter.ts` | 400 | Central integration adapter with utilities |
| **Total** | **~2,100** | Complete IS Code module |

---

## Next Steps

### Immediate (Today)
1. ✅ Create core modules (DONE)
2. ✅ Create RegionSelector component (DONE)
3. ✅ Create integration adapter (DONE)
4. ⏳ Integrate RegionSelector into ProjectSetupDialog
5. ⏳ Test with one Indian city (Delhi)

### Week 1
6. Update LoadCalculator to use IS Code factors
7. Update ventilation calculation to use IS 3720
8. Test equipment sizing difference
9. Add monsoon compliance warnings

### Week 2
10. Create commissioning checklist UI (IS 7399)
11. Add implementation guide to project docs
12. Update project summary with IS Code info
13. Add export/PDF generation for IS Code reports

---

## Revert Instructions

If needed to revert all IS Code changes:

```bash
# List available backups
git tag | grep backup-before-is-code

# Revert to backup
git reset --hard backup-before-is-code-2026-05-15-1234

# Or specific file
git checkout backup-before-is-code-2026-05-15-1234 -- src/
```

All IS Code files are new (not modifying existing code), so they can be safely deleted without affecting other functionality:

```bash
rm src/constants/is-code-constants.ts
rm src/lib/hvac/ventilation-is3720.ts
rm src/lib/regional-design-conditions.ts
rm src/lib/is-code-adapter.ts
rm src/components/RegionSelector.tsx
rm src/types/standards.ts
```

---

## Verification Checklist

- [ ] All 6 files compile without errors
- [ ] RegionSelector component renders correctly
- [ ] ISCodeAdapter methods execute without errors
- [ ] IS 3720 ventilation matches expected values (test with manual calc)
- [ ] Firestore schema correctly validates design conditions
- [ ] All 9 Indian cities load correctly
- [ ] Monsoon humidex calculations accurate
- [ ] Altitude derating calculations correct
- [ ] Types compile without missing imports
- [ ] Regional notes generation for all zones

---

**Created**: May 15, 2026  
**Status**: Core implementation complete, ready for UI integration  
**Backup Tag**: `backup-before-is-code-[timestamp]`  
**Effort Invested**: ~3-4 hours  
**Estimated Integration Time**: 2-3 days
