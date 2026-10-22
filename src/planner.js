/**
 * HomePilot Energy Planning Engine
 * 
 * Deterministic, constraint-aware household energy reduction calculations.
 * Uses explicit physical assumptions and reproducible arithmetic.
 */

export const DEFAULT_HOUSEHOLD = {
  date: "2026-10-13",
  devices: [
    {
      id: "dev_ac_living",
      name: "Living Room AC",
      category: "ac",
      room: "Living Room",
      quantity: 1,
      ratedWatts: 1400,
      dailyHours: 4,
      dutyCycle: 0.57,
      kwh: 3.2,
      status: "running",
      isProtected: false,
    },
    {
      id: "dev_fridge_kitchen",
      name: "Refrigerator",
      category: "refrigerator",
      room: "Kitchen",
      quantity: 1,
      ratedWatts: 150,
      dailyHours: 24,
      dutyCycle: 0.50,
      kwh: 1.8,
      status: "running",
      isProtected: true,
    },
    {
      id: "dev_washer_utility",
      name: "Washing Machine",
      category: "washing_machine",
      room: "Utility",
      quantity: 1,
      ratedWatts: 1200,
      dailyHours: 1,
      dutyCycle: 0.75,
      kwh: 0.9,
      status: "idle",
      isProtected: false,
    },
    {
      id: "dev_lights_living",
      name: "Living Room Lights",
      category: "light",
      room: "Living Room",
      quantity: 4,
      ratedWatts: 10,
      dailyHours: 10,
      dutyCycle: 1.0,
      kwh: 0.4,
      status: "on",
      isProtected: false,
    },
  ],
};

export function calculateDeviceDailyKwh({
  quantity = 1,
  ratedWatts = 0,
  dailyHours = 0,
  dutyCycle = 1.0,
}) {
  const qty = Math.max(1, Math.round(Number(quantity) || 1));
  const watts = Math.max(0, Number(ratedWatts) || 0);
  const hours = Math.min(24, Math.max(0, Number(dailyHours) || 0));
  const duty = Math.min(1.0, Math.max(0.01, Number(dutyCycle) || 1.0));
  return Number(((qty * watts * hours * duty) / 1000).toFixed(2));
}

export const ACTION_TEMPLATES = {
  light: [
    {
      actionType: "lights_dim_zone",
      name: "Dimming & Zone Shutoff",
      fractionReduction: 0.5,
      tradeOff: "Reduced ambient brightness in living areas.",
      assumption: "Lighting assumption: Dimming active fixtures to 50% and turning off secondary decorative lighting saves 50% of lighting circuit power.",
      priority: 1,
    },
  ],
  washing_machine: [
    {
      actionType: "washer_cold_water_defer",
      name: "Cold-Water Wash / Cycle Deferral",
      fractionReduction: 0.4,
      tradeOff: "Laundry wash deferred or run using cold water instead of heated wash.",
      assumption: "Appliance assumption: Washing on cold water eliminates heating coil load, cutting cycle consumption by ~40%.",
      priority: 2,
    },
  ],
  fan: [
    {
      actionType: "fan_eco_speed",
      name: "Eco Speed / Circulation Mode",
      fractionReduction: 0.25,
      tradeOff: "Air circulation operates at low/medium speed instead of maximum.",
      assumption: "Fan assumption: Lowering speed by 1 setting cuts aerodynamic drag and motor power by ~25%.",
      priority: 2,
    },
  ],
  tv: [
    {
      actionType: "tv_eco_standby",
      name: "Auto-Sleep & Brightness Optimization",
      fractionReduction: 0.20,
      tradeOff: "Screen operates with ambient brightness sensor; shuts off after 15 min idle.",
      assumption: "Display assumption: Eco-sensor dimming and eliminating standby idle drain saves ~20% daily power.",
      priority: 2,
    },
  ],
  computer: [
    {
      actionType: "computer_power_save",
      name: "Aggressive Sleep & Display Standby",
      fractionReduction: 0.30,
      tradeOff: "Monitors sleep after 5 min inactivity; background compute throttled.",
      assumption: "Computing assumption: Aggressive sleep states avoid full idle draw, reducing daily energy by ~30%.",
      priority: 2,
    },
  ],
  water_heater: [
    {
      actionType: "water_heater_temp_timer",
      name: "Thermostat Setpoint (-5°C) & Timer Scheduling",
      fractionReduction: 0.30,
      tradeOff: "Water temperature kept at 50°C instead of 55°C; heating active only during morning/evening windows.",
      assumption: "Water heater assumption: Lowering tank setpoint by 5°C reduces standby thermal losses and heating run-time by ~30%.",
      priority: 3,
    },
  ],
  ac: [
    {
      actionType: "ac_eco_setpoint",
      name: "Thermostat Eco Setpoint (+1.5°C)",
      fractionReduction: 0.25,
      tradeOff: "Room will feel slightly warmer; compressor cycles less frequently.",
      assumption: "Thermostat assumption: Raising cooling setpoint by 1.5°C (~3°F) reduces compressor run-time by ~25%.",
      priority: 3,
      group: "ac_control",
    },
    {
      actionType: "ac_peak_curtail",
      name: "Peak-Hour Fan Curtailment",
      fractionReduction: 0.50,
      tradeOff: "Substantial cooling reduction; fans run without active compressor during peak hours.",
      assumption: "HVAC curtailment assumption: Cycling off compressor during peak afternoon hours and using circulation fans cuts AC daily load by 50%.",
      priority: 4,
      group: "ac_control",
      replaces: "ac_eco_setpoint",
    },
  ],
  refrigerator: [
    {
      actionType: "fridge_eco_cycle",
      name: "Defrost Cycle Optimization",
      fractionReduction: 0.10,
      tradeOff: "Defrost heater runs less frequently; requires door to remain firmly closed.",
      assumption: "Refrigeration assumption: Optimizing defrost heater timing saves ~10% without impacting food safety (only if unprotected).",
      priority: 5,
      requiresUnprotected: true,
    },
  ],
  other: [
    {
      actionType: "other_runtime_cut",
      name: "Scheduled Runtime Curtailment",
      fractionReduction: 0.20,
      tradeOff: "Daily operating window shortened.",
      assumption: "General appliance assumption: Reducing operational hours by 20% saves 20% of device baseline energy.",
      priority: 4,
    },
  ],
};

export function inferDeviceCategory(device) {
  if (device && device.category && ACTION_TEMPLATES[device.category]) {
    return device.category;
  }
  const name = ((device && device.name) || "").toLowerCase();
  if (/\b(ac|a\/c)\b/i.test(name) || name.includes("air condition") || name.includes("cooling")) return "ac";
  if (name.includes("refrigerator") || name.includes("fridge") || name.includes("freezer")) return "refrigerator";
  if (name.includes("washing") || name.includes("washer") || name.includes("laundry")) return "washing_machine";
  if (name.includes("light") || name.includes("lamp") || name.includes("bulb")) return "light";
  if (name.includes("fan")) return "fan";
  if (name.includes("water heater") || name.includes("geyser") || name.includes("boiler")) return "water_heater";
  if (/\b(tv)\b/i.test(name) || name.includes("television")) return "tv";
  if (/\b(pc)\b/i.test(name) || name.includes("computer") || name.includes("laptop")) return "computer";
  return "other";
}

export function validateHousehold(data) {
  if (!data || typeof data !== "object") {
    return { valid: false, error: "Household data must be an object." };
  }
  if (!Array.isArray(data.devices) || data.devices.length === 0) {
    return { valid: false, error: "Household must contain a non-empty 'devices' array." };
  }

  const cleanedDevices = [];
  for (let i = 0; i < data.devices.length; i++) {
    const d = data.devices[i];
    if (!d || typeof d !== "object" || !d.name || typeof d.name !== "string" || !d.name.trim()) {
      return { valid: false, error: `Device at index ${i} must have a valid non-empty 'name'.` };
    }

    const name = d.name.trim();
    const category = inferDeviceCategory(d);
    const room = typeof d.room === "string" && d.room.trim() ? d.room.trim() : "Main";
    const quantity = Math.max(1, Math.round(Number(d.quantity) || 1));
    const ratedWatts = Math.max(0, Number(d.ratedWatts) || 0);
    const dailyHours = Math.min(24, Math.max(0, Number(d.dailyHours) || 0));
    const dutyCycle = Math.min(
      1.0,
      Math.max(
        0.01,
        Number(d.dutyCycle) ||
          (category === "refrigerator" ? 0.5 : category === "ac" ? 0.57 : 1.0)
      )
    );

    let kwh = 0;
    if (ratedWatts > 0 && dailyHours > 0) {
      kwh = calculateDeviceDailyKwh({ quantity, ratedWatts, dailyHours, dutyCycle });
    } else if (typeof d.kwh === "number" && !isNaN(d.kwh) && d.kwh >= 0) {
      kwh = Number(d.kwh.toFixed(2));
    } else {
      kwh = 0.5;
    }

    const status = ["running", "idle", "on", "off"].includes(d.status) ? d.status : "running";
    const isProtected = Boolean(d.isProtected || category === "refrigerator");

    cleanedDevices.push({
      id: d.id || `dev_${category}_${i}_${Date.now()}`,
      name,
      category,
      room,
      quantity,
      ratedWatts,
      dailyHours,
      dutyCycle,
      kwh,
      status,
      isProtected,
    });
  }

  const totalKwh = Number(cleanedDevices.reduce((sum, d) => sum + d.kwh, 0).toFixed(2));

  return {
    valid: true,
    household: {
      date: data.date || "2026-10-13",
      devices: cleanedDevices,
      totalKwh,
    },
  };
}

export const ACTION_CATALOG = [
  {
    id: "lights_dim_zone",
    deviceName: "Living Room Lights",
    name: "Dimming & Zone Shutoff",
    fractionReduction: 0.5,
    tradeOff: "Reduced ambient brightness in living areas.",
    assumption: "Lighting assumption: Dimming active fixtures to 50% and turning off secondary decorative lighting saves 50% of lighting circuit power.",
    priority: 1, // Lowest disruption first
  },
  {
    id: "washer_cold_water_defer",
    deviceName: "Washing Machine",
    name: "Cold-Water Wash / Cycle Deferral",
    fractionReduction: 0.4,
    tradeOff: "Laundry wash deferred or run using cold water instead of heated wash.",
    assumption: "Appliance assumption: Washing on cold water eliminates heating coil load, cutting cycle consumption by ~40%.",
    priority: 2,
  },
  {
    id: "ac_eco_setpoint",
    deviceName: "Living Room AC",
    name: "Thermostat Eco Setpoint (+1.5°C)",
    fractionReduction: 0.25,
    tradeOff: "Room will feel slightly warmer; compressor cycles less frequently.",
    assumption: "Thermostat assumption: Raising cooling setpoint by 1.5°C (~3°F) reduces compressor run-time by ~25%.",
    priority: 3,
    group: "ac_control",
  },
  {
    id: "ac_peak_curtail",
    deviceName: "Living Room AC",
    name: "Peak-Hour Fan Curtailment",
    fractionReduction: 0.50,
    tradeOff: "Substantial cooling reduction; fans run without active compressor during peak hours.",
    assumption: "HVAC curtailment assumption: Cycling off compressor during peak afternoon hours and using circulation fans cuts AC daily load by 50%.",
    priority: 4,
    group: "ac_control",
    replaces: "ac_eco_setpoint",
  },
  {
    id: "fridge_eco_cycle",
    deviceName: "Refrigerator",
    name: "Defrost Cycle Optimization",
    fractionReduction: 0.10,
    tradeOff: "Defrost heater runs less frequently; requires door to remain firmly closed.",
    assumption: "Refrigeration assumption: Optimizing defrost heater timing saves ~10% without impacting food safety (only if unprotected).",
    priority: 5,
    requiresUnprotected: true,
  },
];

export function generateCandidateActions(baselineDevices, deviceProtectionMap) {
  const candidateActions = [];

  for (const device of baselineDevices) {
    if (deviceProtectionMap[device.name]) continue;

    const category = inferDeviceCategory(device);
    const exactCatalogActions = ACTION_CATALOG.filter(
      (a) => a.deviceName.toLowerCase() === device.name.toLowerCase()
    );

    if (exactCatalogActions.length > 0) {
      for (const act of exactCatalogActions) {
        candidateActions.push({
          ...act,
          deviceName: device.name,
        });
      }
    } else {
      const templates = ACTION_TEMPLATES[category] || ACTION_TEMPLATES.other;
      for (const t of templates) {
        if (
          t.requiresUnprotected &&
          (category === "refrigerator" || deviceProtectionMap[device.name])
        ) {
          continue;
        }

        const safeId = `${t.actionType}_${device.name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
        candidateActions.push({
          id: safeId,
          deviceName: device.name,
          name: t.name,
          fractionReduction: t.fractionReduction,
          tradeOff: t.tradeOff,
          assumption: t.assumption,
          priority: t.priority,
          group: t.group ? `${t.group}_${device.name}` : undefined,
          replaces: t.replaces
            ? `${t.replaces}_${device.name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`
            : undefined,
        });
      }
    }
  }

  return candidateActions.sort((a, b) => a.priority - b.priority);
}

export const CATEGORY_ALIASES = {
  refrigerator: [
    "refrigerator",
    "fridge",
    "freezer",
    "food storage",
    "food",
    "food spoilage",
    "deep freeze",
    "cooler",
    "icebox",
  ],
  ac: [
    "ac",
    "air conditioner",
    "air conditioning",
    "cooling",
    "hvac",
    "chiller",
  ],
  washing_machine: [
    "washing machine",
    "washer",
    "laundry",
    "wash",
  ],
  light: [
    "light",
    "lights",
    "lighting",
    "lamp",
    "lamps",
    "bulb",
    "bulbs",
    "fixture",
    "fixtures",
  ],
  fan: [
    "fan",
    "ceiling fan",
    "circulation fan",
  ],
  water_heater: [
    "water heater",
    "geyser",
    "boiler",
    "hot water",
  ],
  tv: [
    "tv",
    "television",
    "display",
  ],
  computer: [
    "computer",
    "pc",
    "laptop",
    "workstation",
  ],
};

function matchesAliasToken(text, alias) {
  if (alias.length <= 3) {
    return new RegExp("(?:^|[^a-z0-9])" + alias + "(?:$|[^a-z0-9])", "i").test(text);
  }
  return text.toLowerCase().includes(alias.toLowerCase());
}

export function deviceMatchesProtectionQuery(device, query) {
  if (!query || typeof query !== "string") return false;
  const q = query.trim().toLowerCase();
  if (!q) return false;

  const devName = typeof device === "string" ? device : (device?.name || "");
  const devId = typeof device === "object" ? (device?.id || "") : "";
  const devCategory = typeof device === "object" && device?.category
    ? device.category
    : inferDeviceCategory({ name: devName });

  const nameLower = devName.toLowerCase();
  const idLower = devId.toLowerCase();

  // 1. Exact string match against name or ID
  if (nameLower === q || idLower === q) return true;

  // 2. Direct name containment (ignoring purely generic room prefixes)
  if (q.length > 3 && (nameLower.includes(q) || q.includes(nameLower))) {
    const nonRoom = nameLower
      .replace(/\b(living|room|kitchen|utility|bedroom|bathroom|basement|study|main|garage|attic|hall|porch|dining)\b/gi, "")
      .trim();
    if (nonRoom.length > 2 && (q.includes(nonRoom) || nonRoom.includes(q))) {
      return true;
    }
  }

  // 3. Category alias matching: query refers to this device's specific category
  const categoryAliases = CATEGORY_ALIASES[devCategory] || [];
  if (categoryAliases.some((alias) => matchesAliasToken(q, alias))) {
    return true;
  }

  return false;
}

export function isDeviceProtected(deviceNameOrObj, protectedList = []) {
  if (!Array.isArray(protectedList) || protectedList.length === 0) return false;
  return protectedList.some((p) => deviceMatchesProtectionQuery(deviceNameOrObj, p));
}

export function resolveProtectedDeviceNames(protectedList = [], devices = []) {
  if (!Array.isArray(protectedList) || protectedList.length === 0) {
    return { matched: [], unmatched: [] };
  }
  const matched = new Set();
  const unmatched = [];

  for (const query of protectedList) {
    if (typeof query !== "string" || !query.trim()) continue;
    const q = query.trim();
    let found = false;
    for (const dev of devices) {
      if (deviceMatchesProtectionQuery(dev, q)) {
        matched.add(dev.name);
        found = true;
      }
    }
    if (!found) {
      unmatched.push(q);
    }
  }

  return {
    matched: Array.from(matched),
    unmatched,
  };
}

/**
 * Calculates a feasible, deterministic energy reduction plan.
 *
 * @param {Object} params
 * @param {Object} params.household - Household data containing devices and date
 * @param {number} [params.targetReductionPercent] - Desired % reduction (0-100)
 * @param {number} [params.maxKwhBudget] - Desired maximum total kWh
 * @param {string[]} [params.protectedDevices] - Device names that MUST NOT be reduced
 * @param {number} [params.tariffPerKwh=0.15] - Utility rate per kWh
 * @param {string} [params.currency="$"] - Currency symbol for display
 * @returns {Object} Deterministic plan result
 */
export function calculateEnergyPlan({
  household,
  targetReductionPercent,
  maxKwhBudget,
  protectedDevices = ["refrigerator"], // Safe default: protect food storage
  tariffPerKwh = 0.15,
  currency = "$",
}) {
  if (!household || !Array.isArray(household.devices)) {
    throw new Error("Invalid household data provided to planning engine.");
  }

  // Sanitize numeric inputs
  const tariff = typeof tariffPerKwh === "number" && !isNaN(tariffPerKwh) && tariffPerKwh >= 0
    ? tariffPerKwh
    : 0.15;

  const baselineDevices = household.devices.map((d) => {
    let kwh = d.kwh;
    if (kwh === undefined || kwh === null || isNaN(Number(kwh))) {
      kwh = calculateDeviceDailyKwh({
        quantity: d.quantity,
        ratedWatts: d.ratedWatts,
        dailyHours: d.dailyHours,
        dutyCycle: d.dutyCycle,
      });
    }
    return {
      id: d.id,
      name: d.name,
      category: d.category || inferDeviceCategory(d),
      room: d.room || "Main",
      isProtected: Boolean(d.isProtected),
      baselineKwh: Number(Number(kwh).toFixed(2)),
      status: d.status || "running",
    };
  });

  const baselineTotalKwh = Number(
    baselineDevices.reduce((sum, d) => sum + d.baselineKwh, 0).toFixed(2)
  );

  const baselineEstimatedCost = Number((baselineTotalKwh * tariff).toFixed(2));

  // Determine target reduction in kWh
  let targetKwhNeeded = 0;
  let targetType = "none";
  let targetDescription = "No specific target specified.";

  const hasPercentTarget =
    typeof targetReductionPercent === "number" &&
    !isNaN(targetReductionPercent) &&
    targetReductionPercent > 0;

  const hasBudgetTarget =
    typeof maxKwhBudget === "number" &&
    !isNaN(maxKwhBudget) &&
    maxKwhBudget > 0;

  if (hasPercentTarget && hasBudgetTarget) {
    const kwhFromPercent = (baselineTotalKwh * targetReductionPercent) / 100;
    const kwhFromBudget = Math.max(0, baselineTotalKwh - maxKwhBudget);
    // Take the stricter (larger reduction) constraint
    targetKwhNeeded = Math.max(kwhFromPercent, kwhFromBudget);
    targetType = "combined";
    targetDescription = `Reduce by ${targetReductionPercent}% or stay under ${maxKwhBudget} kWh (stricter target: save ${targetKwhNeeded.toFixed(2)} kWh)`;
  } else if (hasPercentTarget) {
    targetKwhNeeded = (baselineTotalKwh * targetReductionPercent) / 100;
    targetType = "percentage";
    targetDescription = `Reduce household usage by ${targetReductionPercent}% (${targetKwhNeeded.toFixed(2)} kWh)`;
  } else if (hasBudgetTarget) {
    targetKwhNeeded = Math.max(0, baselineTotalKwh - maxKwhBudget);
    targetType = "budget";
    targetDescription = `Cap household usage at ${maxKwhBudget} kWh (save ${targetKwhNeeded.toFixed(2)} kWh)`;
  }

  // Identify protected devices
  const protectedNormalized = (Array.isArray(protectedDevices) ? protectedDevices : [])
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean);

  const deviceProtectionMap = {};
  baselineDevices.forEach((d) => {
    // 1. Device matches explicit protected list (via aliases, name, ID, or category)
    const isExplicitlyProtected = isDeviceProtected(d, protectedNormalized);

    // 2. Household device setting (d.isProtected === true)
    // If protectedDevices parameter was omitted or provided with items, household d.isProtected is preserved.
    // If protectedDevices was explicitly passed as empty [] (e.g. Deep Eco mode with 0 protections), honor that.
    const isHouseholdProtected = Boolean(d.isProtected && protectedNormalized.length > 0);

    deviceProtectionMap[d.name] = isExplicitlyProtected || isHouseholdProtected;
  });

  // Evaluate candidate actions
  const appliedActions = [];
  const decisionLog = [];
  const proposedDeviceMap = {};

  baselineDevices.forEach((d) => {
    proposedDeviceMap[d.name] = {
      name: d.name,
      baselineKwh: d.baselineKwh,
      proposedKwh: d.baselineKwh,
      kwhSaved: 0,
      percentReduction: 0,
      status: d.status,
      isProtected: deviceProtectionMap[d.name],
    };
  });

  // Log protected status
  baselineDevices.forEach((d) => {
    if (deviceProtectionMap[d.name]) {
      decisionLog.push({
        type: "protected",
        deviceName: d.name,
        message: `${d.name} is marked as protected. All reduction actions on this device are strictly excluded.`,
      });
    }
  });

  // If target is 0 or negative
  if (targetKwhNeeded <= 0) {
    return {
      status: "no_action_needed",
      targetMet: true,
      target: {
        type: targetType,
        description: targetDescription,
        requestedPercent: targetReductionPercent ?? 0,
        requestedBudgetKwh: maxKwhBudget ?? null,
        targetKwhNeeded: 0,
      },
      baseline: {
        date: household.date,
        totalKwh: baselineTotalKwh,
        estimatedCost: baselineEstimatedCost,
        devices: baselineDevices,
      },
      proposed: {
        totalKwh: baselineTotalKwh,
        estimatedCost: baselineEstimatedCost,
        devices: Object.values(proposedDeviceMap),
      },
      savings: {
        estimatedKwhSaved: 0,
        estimatedPercentSaved: 0,
        estimatedCostSaved: 0,
        tariffPerKwh: tariff,
        currency,
      },
      actionsApplied: [],
      protectedDevices: Object.keys(deviceProtectionMap).filter((k) => deviceProtectionMap[k]),
      decisionLog: [
        ...decisionLog,
        {
          type: "info",
          message: "Current baseline already meets or exceeds the specified target. No load shedding required.",
        },
      ],
      assumptions: [],
      disclaimer: "Simulated baseline and deterministic calculations. Not verified physical measurements.",
    };
  }

  // Filter actions to permissible candidates (non-protected, device exists in household)
  const candidateActions = generateCandidateActions(baselineDevices, deviceProtectionMap);

  // Greedily apply actions by priority until target is satisfied
  let currentAccumulatedSaved = 0;
  const appliedGroups = new Map(); // Track mutually exclusive groups like ac_control

  for (const action of candidateActions) {
    if (currentAccumulatedSaved >= targetKwhNeeded) {
      break; // Target achieved
    }

    const device = baselineDevices.find((d) => d.name === action.deviceName);
    const potentialSavings = Number((device.baselineKwh * action.fractionReduction).toFixed(2));

    // Handle replacement within a group (e.g. ac_peak_curtail replaces ac_eco_setpoint)
    if (action.group && appliedGroups.has(action.group)) {
      const previousAction = appliedGroups.get(action.group);
      const netAdditionalSavings = Number((potentialSavings - previousAction.kwhSaved).toFixed(2));

      if (netAdditionalSavings > 0) {
        // Remove previous action
        const prevIndex = appliedActions.findIndex((a) => a.id === previousAction.id);
        if (prevIndex !== -1) {
          appliedActions.splice(prevIndex, 1);
        }
        currentAccumulatedSaved -= previousAction.kwhSaved;

        // Apply new higher-impact action
        appliedActions.push({
          id: action.id,
          deviceName: action.deviceName,
          name: action.name,
          kwhSaved: potentialSavings,
          percentReduction: Math.round(action.fractionReduction * 100),
          tradeOff: action.tradeOff,
          assumption: action.assumption,
        });

        currentAccumulatedSaved += potentialSavings;
        appliedGroups.set(action.group, { id: action.id, kwhSaved: potentialSavings });

        proposedDeviceMap[action.deviceName].proposedKwh = Number(
          Math.max(0, device.baselineKwh - potentialSavings).toFixed(2)
        );
        proposedDeviceMap[action.deviceName].kwhSaved = potentialSavings;
        proposedDeviceMap[action.deviceName].percentReduction = Math.round(
          (potentialSavings / device.baselineKwh) * 100
        );

        decisionLog.push({
          type: "action_upgrade",
          deviceName: action.deviceName,
          actionName: action.name,
          kwhSaved: potentialSavings,
          message: `Upgraded ${action.deviceName} control to '${action.name}' to gain an extra ${netAdditionalSavings} kWh savings.`,
        });
      }
    } else {
      // Normal application
      appliedActions.push({
        id: action.id,
        deviceName: action.deviceName,
        name: action.name,
        kwhSaved: potentialSavings,
        percentReduction: Math.round(action.fractionReduction * 100),
        tradeOff: action.tradeOff,
        assumption: action.assumption,
      });

      currentAccumulatedSaved += potentialSavings;
      if (action.group) {
        appliedGroups.set(action.group, { id: action.id, kwhSaved: potentialSavings });
      }

      proposedDeviceMap[action.deviceName].proposedKwh = Number(
        Math.max(0, device.baselineKwh - potentialSavings).toFixed(2)
      );
      proposedDeviceMap[action.deviceName].kwhSaved = potentialSavings;
      proposedDeviceMap[action.deviceName].percentReduction = Math.round(
        (potentialSavings / device.baselineKwh) * 100
      );

      decisionLog.push({
        type: "action_applied",
        deviceName: action.deviceName,
        actionName: action.name,
        kwhSaved: potentialSavings,
        message: `Applied '${action.name}' on ${action.deviceName}: estimated -${potentialSavings} kWh.`,
      });
    }
  }

  // Calculate final proposed totals
  const proposedTotalKwh = Number(
    Object.values(proposedDeviceMap)
      .reduce((sum, d) => sum + d.proposedKwh, 0)
      .toFixed(2)
  );

  const totalKwhSaved = Number(Math.max(0, baselineTotalKwh - proposedTotalKwh).toFixed(2));
  const percentSaved = baselineTotalKwh > 0
    ? Number(((totalKwhSaved / baselineTotalKwh) * 100).toFixed(1))
    : 0;

  const proposedEstimatedCost = Number((proposedTotalKwh * tariff).toFixed(2));
  const estimatedCostSaved = Number((totalKwhSaved * tariff).toFixed(2));

  const targetMet = totalKwhSaved >= Number(targetKwhNeeded.toFixed(2));

  let status = "achieved";
  let explanation = `Target requested: ${targetDescription}. Planned reduction: ${totalKwhSaved} kWh (${percentSaved}%), achieving your reduction goal while preserving protected devices.`;

  if (!targetMet) {
    status = "partial";
    explanation = `Target requested: ${targetDescription}. Maximum feasible planned reduction: ${totalKwhSaved} kWh (${percentSaved}%). Target of ${targetKwhNeeded.toFixed(2)} kWh reduction could not be fully met because protected devices were preserved and maximum permissible actions were reached.`;
    decisionLog.push({
      type: "target_gap",
      shortfallKwh: Number((targetKwhNeeded - totalKwhSaved).toFixed(2)),
      message: explanation,
    });
  }

  const distinctAssumptions = Array.from(
    new Set(appliedActions.map((a) => a.assumption))
  );

  return {
    status,
    targetMet,
    explanation,
    target: {
      type: targetType,
      description: targetDescription,
      requestedPercent: targetReductionPercent ?? null,
      requestedBudgetKwh: maxKwhBudget ?? null,
      targetKwhNeeded: Number(targetKwhNeeded.toFixed(2)),
      requestedTargetLabel: `Target Requested: ${targetDescription}`,
    },
    baseline: {
      date: household.date,
      totalKwh: baselineTotalKwh,
      estimatedCost: baselineEstimatedCost,
      devices: baselineDevices,
    },
    proposed: {
      totalKwh: proposedTotalKwh,
      estimatedCost: proposedEstimatedCost,
      devices: Object.values(proposedDeviceMap),
    },
    savings: {
      estimatedKwhSaved: totalKwhSaved,
      estimatedPercentSaved: percentSaved,
      estimatedCostSaved: estimatedCostSaved,
      plannedReductionLabel: `Planned Reduction: ${totalKwhSaved} kWh (${percentSaved}%)`,
      tariffPerKwh: tariff,
      currency,
    },
    actionsApplied: appliedActions,
    protectedDevices: Object.keys(deviceProtectionMap).filter((k) => deviceProtectionMap[k]),
    decisionLog,
    assumptions: distinctAssumptions,
    disclaimer: "Simulated baseline and deterministic estimates. Not verified real-world savings.",
    dataSource: "simulated_baseline_and_estimated_model",
  };
}
