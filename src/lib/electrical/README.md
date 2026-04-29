# Cable & MCB Sizing Tool - Electrical Engineering Module

## Overview

The **Cable & MCB Sizing Tool** is a professional-grade electrical design calculator that sizes cables and circuit breakers for various HVAC and building system applications. It accounts for inrush current, practical derating factors, and international standards.

---

## Features

### 1. **Application-Type Based Sizing**

The tool provides pre-configured profiles for common HVAC applications:

| Application | Inrush Multiplier | Duration | Starting Method | Protection |
|---|---|---|---|---|
| **Motor (3-Phase AC)** | 5-8× | ~200ms | DOL (Direct-On-Line) | Type D MCB or Motor Contactor |
| **Chiller (Compressor)** | 5.5× | ~300ms | Star-Delta or Soft-Starter | Type D MCB or Electronic Overload |
| **Pump / Fan** | 3× | ~50ms | Soft-Starter (Recommended) | Type C MCB |
| **Electric Heater** | 1.2× | ~10ms | Direct (No Starter) | Type B/C MCB |
| **Lighting** | 1.8× | ~20ms | Direct | Type B/C MCB |
| **General Purpose** | 2.5× | ~100ms | Direct | Type C MCB |
| **Custom / Other** | User-defined | Custom | Manual | Manual |

**Inrush Multiplier**: Peak instantaneous current = Rated Current × Multiplier

### 2. **Inrush Current Analysis**

**Inrush current** (also called starting current or in-rush current) is the peak electrical current drawn when equipment first starts. This is critical because:

- **Motors**: 5-8× rated current for ~200ms due to zero-speed induced torque
- **Chillers**: High inrush from compressor motor + additional fans
- **Soft-Starters**: Dramatically reduce inrush (1-3×) via controlled voltage ramp-up
- **Heaters**: Minimal inrush (≤20% above rated) - purely resistive

**Design Philosophy**:
- Cable must handle inrush thermal stress
- Breaker protects against sustained overload (not inrush transients)
- Starting method (soft-starter, VFD, star-delta) reduces inrush and allows smaller cables

### 3. **Practical Derating Factors**

Cables are derated for:

- **Temperature**: -5% per 10°C above 30°C reference
- **Bundling**: Multiple cables in same conduit share heat
  - 2 cables: -20%
  - 3 cables: -30%
  - 4+ cables: -40%
- **Conduit Fill**: Exceeding 40% conduit fill derated
- **Application-Specific**: Motor loads get additional -15% margin for thermal stability

### 4. **Voltage Drop Calculation**

**Voltage Drop Formula**:
```
VD(%) = (2 × L × I × R) / (V × 1000)
```

Where:
- L = Cable length (m)
- I = Load current (A)
- R = Wire resistance (Ω/km) at operating temperature
- V = System voltage (V)

**Standards**:
- General circuits: ≤3% VD
- Feeder circuits: ≤3% VD
- Branch circuits: ≤2% VD
- Total system: ≤5% VD

Long cable runs to remote equipment (motors, chillers) require larger cables to minimize voltage sag.

### 5. **Cable Standards**

- **NEC (USA)**: Chapter 3 - Ampacity tables; Chapter 2 - Overcurrent Protection
- **IEC 60364 (International)**: Electric installations in buildings
- **BS 7909 (UK)**: Temporary electrical systems for entertainment/events

---

## Practical Examples

### Example 1: Chiller Unit (Soft-Starter Case)

**Inputs:**
- Application: Chiller (Compressor + Fan motors)
- Rated Current: 50A at 400V 3-phase
- Cable Length: 75m to roof location
- Ambient: 35°C (outdoor installation)
- Starting Protection: **Yes** (Soft-Starter engaged)

**What the Tool Calculate**:
1. **Inrush Analysis**:
   - Inrush multiplier: 5.5× (typical for chillers)
   - Peak inrush: 50A × 5.5 = **275A** for ~300ms
   - With soft-starter: Reduced to ~120A over 2 seconds

2. **Cable Sizing**:
   - Effective current for sizing: 50A × 1.25 (soft-start margin) = 62.5A
   - At 35°C ambient & conduit grouping: Derated to ~55A usable capacity
   - Selection: **25mm² cable** (base 85A, derated ~70A with factors)

3. **Voltage Drop Check**:
   - VD from 50A over 75m: ~1.8% ✓ (within 3% limit)

4. **MCB Selection**:
   - *Without soft-starter*: Type D 63A (to handle inrush)
   - *With soft-starter*: Type C 63A (soft-starter protects)

5. **Recommendations**:
   - Soft-starter allows **2-3 cable sizes smaller** than DOL
   - Star-delta alternative: 1-2 sizes smaller than DOL
   - VFD: Most efficient, allows 1×A sizing but requires shielded cable

---

### Example 2: Electric Heater Resistance Load

**Inputs:**
- Application: Electric Heater (Reheat Coil)
- Rated Current: 32A at 230V 1-phase
- Cable Length: 40m
- Ambient: 30°C
- Starting Protection: Not applicable (resistive load)

**What the Tool Calculates**:
1. **Inrush Analysis**:
   - Inrush multiplier: 1.2× (resistance has minimal inrush)
   - Peak inrush: 32A × 1.2 = **38.4A** for ~10ms
   - No protection needed for inrush transients

2. **Cable Sizing**:
   - Effective current: 32A × 1.25 (safety) = 40A
   - Application derating (heater): ×0.95 = usable 38A
   - Selection: **10mm² cable** (base 48A, derated ~38A)

3. **Voltage Drop Check**:
   - VD from 32A over 40m: ~0.9% ✓ (very safe)

4. **MCB Selection**:
   - Type B 40A (3-5× rated for resistive loads)
   - Heaters: Typically Type B MCBs are acceptable

5. **Recommendation**:
   - Very straightforward sizing—minimal design complexity
   - Common for terminal units and reheat coils in HVAC

---

### Example 3: Three-Phase Motor Without Starting Protection

**Inputs:**
- Application: Motor (3-Phase AC)
- Rated Current: 45A at 400V 3-phase
- Cable Length: 100m
- Ambient: 40°C (warm environment)
- Starting Protection: **None** (DOL starter)

**What the Tool Calculates**:
1. **Inrush Analysis**:
   - Inrush multiplier: 7× (typical DOL inrush)
   - Peak inrush: 45A × 7 = **315A** for ~200ms
   - ⚠️ Large voltage dip (315A on 100m cable = ~11% VD)

2. **Cable Sizing**:
   - Without soft-start: Must size for thermal stress of high inrush
   - Effective current: ~45A × 1.5 (large margin for DOL) = 67.5A
   - At 40°C + derating: ~60A usable capacity
   - Selection: **35mm² cable** (base 108A, derated ~60A with all factors)

3. **Voltage Drop Check**:
   - VD from 45A over 100m: ~2.4% ✓ (acceptable)

4. **MCB Selection**:
   - Type D 50A MCB (handles 7× inrush, won't nuisance trip)
   - Must coordinate with cable ampacity

5. **Comparison with Soft-Starter**:
   - DOL sizing: 35mm² cable
   - Soft-start sizing: 16-25mm² cable (1-2 sizes smaller!)
   - Cost savings: Often justifies soft-starter investment

---

## Technical Deep Dive

### Cable Ampacity Selection Process

1. **Base Ampacity** (from NEC Table 310):
   - Determined by cable size and insulation temperature rating
   - Typically in conduit (grouped cables, restricted air flow)
   - Assumes 30°C ambient reference temperature

2. **Temperature Derating** (IEC 60364):
   - Each 10°C above reference: -5% ampacity loss
   - Formula: `Derating_factor = 1 - 0.05 × (T_ambient - 30) / 10`
   - Example: At 50°C → 1 - 0.05×(50-30)/10 = **0.90** (90% of base)

3. **Grouping Derating** (Cable bundling):
   - Cables share conduit space and heat
   - Reduces cooling efficiency
   - Standards: IEC 60364 Table C.52-1

4. **Application-Specific Derating**:
   - Motors: Additional -15% for motor duty thermal stability
   - Heaters: -5% (less conservative—predictable load)
   - Motors w/ soft-starter: Only -5% (inrush controlled)

### MCB Trip Characteristics

**Type B MCBs** (Thermal-Magnetic):
- Trip range: 3-5× rated current
- Use: Resistive loads (heaters, lighting)
- Example: 20A Type B trips at 60-100A

**Type C MCBs** (Thermal-Magnetic):
- Trip range: 5-10× rated current
- Use: General/mixed loads, some motors with soft-starters
- Example: 20A Type C trips at 100-200A

**Type D MCBs** (Thermal-Magnetic):
- Trip range: 10-20× rated current
- Use: Motor starting (DOL), high-inrush loads
- Example: 20A Type D trips at 200-400A
- ⚠️ Less sensitive—risks nuisance trips during steady-state overloads

**VFD-Rated Breakers**: Specialized for variable frequency drive applications

---

## Module Architecture

### Files

**`lib/electrical/constants.ts`** (600+ lines)
- All interfaces and types
- CABLE_SIZES catalog (14 AWG - 150mm²)
- AMPACITY_TABLE (NEC & IEC ratings)
- MCB_RATINGS (10A - 800A range, Types B/C/D)
- APPLICATION_PROFILES (motor, chiller, pump, heater, etc.)
- ELECTRICAL_CONSTANTS (resistivity, safety factors, voltage drop limits)

**`lib/electrical/cableSizing.ts`** (350+ lines)
- `calculateVoltageDrop()` — Cable voltage drop calculation
- `getAmpacityRating()` — Lookup ampacity for cable size
- `applyDeratingFactors()` — Temperature, bundling, fill derating
- `selectCableSize()` — Find minimum cable for current
- `selectMCB()` — Find minimum MCB for load type
- `calculateInrushCurrent()` — Inrush from application profile
- `calculateInrushBasedSizing()` — Size considering inrush effects
- `sizeCableAndMCBWithApplication()` — **Comprehensive sizing function**
- `checkCoordination()` — Verify cable-breaker coordination

**`components/ElectricalTools/CableMCBSelectorV2.tsx`** (600 lines)
- React component with interactive UI
- Real-time calculation and visualization
- Inrush current display
- Soft-starter checkbox for motors
- CSV export functionality
- Application selection dropdown

### Calculation Flow

```
User Input (I, V, L, App Type)
    ↓
Get Application Profile (inrush multiplier, derating factor)
    ↓
Calculate Inrush Current (I_peak = I_rated × multiplier)
    ↓
Determine Effective Cable Current
  (considering soft-starter or DOL method)
    ↓
Select Cable Size
  (base on ampacity + derating)
    ↓
Check Voltage Drop
  (must be within limit for cable length)
    ↓
Select Appropriate MCB Type
  (Type B for heaters, Type C for mixed, Type D for motors)
    ↓
Apply Application-Specific Derating
    ↓
Calculate Safety Margin & Compliance
    ↓
Return: Cable size, MCB rating, inrush info, warnings/notes
```

---

## Standards Compliance

### NEC (National Electrical Code) - USA

- **Table 310.15(B)(1)(1)**: Allowable ampacities for 1-3 RHW-2, XHHW-2, THW-2 in conduit
- **Table 430.148-150**: Motor full-load currents (for motor circuit calculations)
- **Article 410**: Branch circuits and components (motor starting methods)
- **Chapter 450**: Capacitors (soft-starters, VFDs)

### IEC 60364 - International

- **Section 5**: Power supply, earthing, and safety
- **Section 7**: Requirements for special installations (HVAC systems)
- **Table C.52**: Grouping derating factors (multiple cables in conduit)

### BS 7909 - UK Temporary Systems

- Used for event power distributions and temporary HVAC installations
- More stringent than permanent installations
- Higher safety margins for unpredictable loads

---

## Practical Design Tips

### 1. **Motor Starting Strategy**

**Direct-On-Line (DOL)**: Simplest but requires largest cable
- No soft-starter or VFD
- Inrush = 6-8× for AC motors
- Cable sizing: Conservative (large safety margin)
- Best for: Small motors, short cable runs

**Soft-Starter**: Recommended for HVAC  systems
- Controlled voltage ramp (0V → nominal over 2-5s)
- Inrush = 1-3× (smooth acceleration)
- Cable sizing: 2-3 sizes smaller than DOL
- Best for: Chillers, large pump/fan motors, long cable runs
- Cost impact: ~$2-5k for soft-starter, saves cable/breaker costs

**VFD (Variable Frequency Drive)**: Most efficient but complex
- PWM control of motor frequency
- Allows 1× rated current sizing
- Requires shielded cable to prevent EMI
- Best for: Energy-critical applications, wide load range required
- Cost impact: $5-15k for industrial VFD

### 2. **Cable Routing**

- **Single cable**: Rated ampacity at reference conditions
- **Bundled cables** (2-10 in conduit): Apply derating factors
- **Separated** (individual conduits or trays): Minimum derating
- **Above suspended ceilings**: High ambient temperature—extra derating
- **Outdoor installations**: Weather protection, UV resistance, larger conduit

### 3. **Cost Optimization**

| Scenario | Strategy | Savings |
|---|---|---|
| 40A motor, 100m run | Use soft-starter | Cable: 2 sizes smaller (~60% cost); Breaker: smaller Type C |
| Distributed loads (5+ circuits) | Soft-starters on 3-phase motors | Total cable: ~30-40% reduction |
| High ambient (50°C+) | Oversizing cable | Efficiency: Less heat loss, longer lifespan |
| Frequent start-stop duty | VFD + shielded cable | Lifespan: Reduces mechanical wear 10×; Energy: 20-30% savings |

### 4. **Safety Considerations**

- **Inrush voltage dip**: Minimize by using soft-starters or oversizing cables
- **Cable temperature rise**: Bundled cables heat faster—don't overload
- **MCB coordination**: Breaker should trip before cable insulation fails
- **Short-circuit protection**: Both cable and breaker rated for Isc (fault current)
- **Earthing**: Proper grounding critical for safety; often overlooked in HVAC design

---

## Future Enhancements

1. **Three-Phase Imbalance Analysis**: Detect under-loading of one phase
2. **Harmonic Distortion**: Impact of VFDs on power quality and cable heating
3. **Transient Overvoltage**: Cable inductance during motor switching
4. **Cost Optimization**: Life-cycle cost comparison (initial cable cost vs. energy loss)
5. **Code Compliance Checker**: Verify against specific country codes (NEC, IEC, AS/NZS, etc.)
6. **Cable Ampacity Summer/Winter**: Seasonal derating factors
7. **Generator Sizing**: Back-up power for critical HVAC loads

---

## References

- **IEEE 835**: Standard for In-Situ Determination of Moisture Content and Dielectric Loss of Solid Electrical Insulation
- **NFPA 70** (NEC): National Electrical Code
- **IEC 60364-5-52**: Low-voltage electrical installations - Selection and erection of electrical equipment - Wiring systems
- **IEC 60898-1**: Electrical accessories - Circuit-breakers for overcurrent protection - Part 1: MCBs
- **ASHRAE 90.1**: Energy Standard for Buildings
- **Motor Soft-Starters**: ABB, Siemens, Schneider Electric technical guides
