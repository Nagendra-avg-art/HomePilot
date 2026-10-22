/**
 * HomePilot Goal-Driven Assistant Module
 * 
 * Extracts energy goals, parses constraints, handles explainability queries,
 * and formats grounded responses based on real MCP tool and API results.
 */

export const KNOWN_DEVICES = [
  { canonical: "Living Room AC", aliases: ["living room ac", "ac", "air conditioner", "air conditioning", "cooling"] },
  { canonical: "Refrigerator", aliases: ["refrigerator", "fridge", "freezer"] },
  { canonical: "Washing Machine", aliases: ["washing machine", "washer", "laundry", "washing"] },
  { canonical: "Living Room Lights", aliases: ["living room lights", "lights", "light", "lighting", "bulbs", "lamp"] },
];

/**
 * Returns canonical and alias list merged with any configured household devices.
 * If household devices are provided, they take priority over default mock appliances.
 */
export function getKnownDevices(context = {}) {
  const result = [];
  const householdDevs = context?.household?.devices;

  if (Array.isArray(householdDevs) && householdDevs.length > 0) {
    for (const dev of householdDevs) {
      const words = dev.name.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
      const aliases = [dev.name.toLowerCase(), ...words];
      if (dev.category) {
        aliases.push(dev.category.toLowerCase().replace(/_/g, " "));
      }
      if (dev.category === "refrigerator" || /fridge|refrigerator|freezer/i.test(dev.name)) {
        aliases.push("refrigerator", "fridge", "freezer", "food storage", "food", "food spoilage");
      } else if (dev.category === "ac" || /ac|air condition|cooling/i.test(dev.name)) {
        aliases.push("ac", "air conditioner", "air conditioning", "cooling");
      } else if (dev.category === "washing_machine" || /washer|washing|laundry/i.test(dev.name)) {
        aliases.push("washer", "washing machine", "laundry");
      } else if (dev.category === "light" || /light|lamp|bulb/i.test(dev.name)) {
        aliases.push("lights", "light", "lighting", "lamp", "bulbs");
      } else if (dev.category === "water_heater" || /water heater|geyser|boiler/i.test(dev.name)) {
        aliases.push("water heater", "geyser", "boiler");
      } else if (dev.category === "fan" || /fan/i.test(dev.name)) {
        aliases.push("fan", "ceiling fan");
      } else if (dev.category === "tv" || /tv|television/i.test(dev.name)) {
        aliases.push("tv", "television");
      } else if (dev.category === "computer" || /computer|laptop|pc/i.test(dev.name)) {
        aliases.push("computer", "pc", "laptop");
      }

      result.push({
        canonical: dev.name,
        aliases: [...new Set(aliases)],
        category: dev.category,
        room: dev.room,
      });
    }
  }

  // Include known generic defaults if not already shadowed by household
  for (const kd of KNOWN_DEVICES) {
    if (!result.some((d) => d.canonical.toLowerCase() === kd.canonical.toLowerCase())) {
      result.push(kd);
    }
  }

  return result;
}

/**
 * Matches a word or alias to a known canonical device name.
 */
export function matchDeviceName(query, context = {}) {
  if (!query) return null;
  const q = query.trim().toLowerCase();
  const devices = getKnownDevices(context);
  for (const device of devices) {
    if (device.canonical.toLowerCase() === q) return device.canonical;
    for (const alias of device.aliases) {
      if (q === alias || q.includes(alias) || alias.includes(q)) return device.canonical;
    }
  }
  return null;
}

/**
 * Parses user input to extract intent, parameters, and constraints.
 * 
 * @param {string} text - Raw user input
 * @param {Object} [context] - Current dashboard context (devices, currentPlan, tariff, currency)
 * @returns {Object} Parsed intent object
 */
export function parseAssistantIntent(text, context = {}) {
  const input = (text || "").trim();
  const lower = input.toLowerCase();
  const activePlan = context?.currentPlan || null;

  if (!input) {
    return { type: "EMPTY" };
  }

  const knownDevices = getKnownDevices(context);

  // 1. Check for explainability queries ("why...", "how come...")
  const isExplainQuery =
    /^(why|how come|explain why|what is the reason)/i.test(lower) ||
    lower.includes("why couldn't") ||
    lower.includes("why was") ||
    lower.includes("why did you") ||
    lower.includes("why is");

  if (isExplainQuery) {
    return {
      type: "EXPLAIN_WHY",
      rawQuery: input,
      currentPlan: activePlan,
      targetDevice: knownDevices.find((d) =>
        d.aliases.some((a) => lower.includes(a))
      )?.canonical,
      asksAboutTarget:
        lower.includes("target") ||
        lower.includes("goal") ||
        lower.includes("achieve") ||
        lower.includes("infeasible") ||
        lower.includes("impossible") ||
        lower.includes("could not") ||
        lower.includes("couldn't") ||
        /\b\d+%\b/.test(lower),
    };
  }

  // 2. Check for "Cheapest feasible plan" / "maximum savings" request
  if (
    lower.includes("cheapest") ||
    lower.includes("maximum savings") ||
    lower.includes("most efficient") ||
    lower.includes("best plan")
  ) {
    const fridgeDevs = context?.household?.devices?.filter(
      (d) => d.category === "refrigerator" || /fridge|refrigerator|freezer/i.test(d.name)
    );
    const protectedList = fridgeDevs && fridgeDevs.length > 0
      ? fridgeDevs.map((d) => d.name)
      : ["Refrigerator"];

    return {
      type: "PLAN_GOAL",
      isCheapestRequest: true,
      targetReductionPercent: 35, // High feasible optimization
      protectedDevices: protectedList, // Keep safety invariant
    };
  }

  // 3. Check for reduction goal / budget intent
  const hasPlanKeywords =
    /\b(reduce|reduction|cut|save|saving|goal|budget|cap|limit|below|under|stay under|plan|curtail)\b/i.test(lower) &&
    /\b(energy|electricity|kwh|usage|power|consumption|bill|percent|%|food spoilage)\b/i.test(lower);

  const hasPercentage = /(\d+(?:\.\d+)?)\s*%/i.test(lower) || /(\d+(?:\.\d+)?)\s*percent/i.test(lower);
  const hasKwhBudget = /(?:under|below|cap at|max|limit to|budget of)?\s*(\d+(?:\.\d+)?)\s*kwh/i.test(lower);

  if (hasPlanKeywords || hasPercentage || (hasKwhBudget && !lower.includes("used") && !lower.includes("consume"))) {
    // Extract target percentage
    let targetPercent = null;
    const pctMatch = lower.match(/(\d+(?:\.\d+)?)\s*%/i) || lower.match(/(\d+(?:\.\d+)?)\s*percent/i);
    if (pctMatch) {
      targetPercent = Number(pctMatch[1]);
    }

    // Extract kWh usage budget
    let budgetKwh = null;
    const budgetMatch =
      lower.match(/(?:below|under|cap at|max|limit of|budget of)\s*(\d+(?:\.\d+)?)\s*(?:kwh)?/i) ||
      lower.match(/(\d+(?:\.\d+)?)\s*kwh\s*(?:budget|cap|limit)/i) ||
      (lower.includes("below") || lower.includes("under") ? lower.match(/(\d+(?:\.\d+)?)\s*kwh/i) : null);

    if (budgetMatch) {
      budgetKwh = Number(budgetMatch[1]);
    }

    // If both missing, check if it's an ambiguous goal request
    if (targetPercent === null && budgetKwh === null) {
      const mentionsFood = lower.includes("food") || lower.includes("spoilage") || lower.includes("fridge") || lower.includes("refrigerator");
      const message = mentionsFood
        ? "I can help you build an energy-saving plan while keeping your food storage safely protected! Would you like to target a percentage reduction (e.g. 15% or 20%) or set a usage budget cap (e.g. 5.0 kWh)?"
        : "I can help you build an energy-saving plan! Would you like to target a percentage reduction (e.g. 15% or 20%) or set a usage budget cap (e.g. 5.0 kWh)? You can also mention which devices to keep protected.";

      return {
        type: "CLARIFICATION_NEEDED",
        message,
      };
    }

    // Check if user explicitly asked to protect a specific unknown appliance
    let unknownProtectedDevice = null;
    const explicitProtectPattern = /(?:keep|protect|don't turn off|do not turn off)\s+(?:the\s+)?([a-z0-9\s]+?)(?:\s+(?:safe|on|running|from)|\.|$|,)/gi;
    let pMatch;
    while ((pMatch = explicitProtectPattern.exec(lower)) !== null) {
      const candidate = pMatch[1].trim();
      if (
        candidate &&
        !["electricity", "power", "energy", "usage", "bill", "money", "food", "food storage", "fridge", "refrigerator", "freezer"].includes(candidate)
      ) {
        const resolved = matchDeviceName(candidate, context);
        if (!resolved && context?.household?.devices?.length > 0) {
          unknownProtectedDevice = candidate;
          break;
        }
      }
    }

    if (unknownProtectedDevice) {
      const knownList = context.household.devices.map((d) => d.name).join(", ");
      return {
        type: "CLARIFICATION_NEEDED",
        message: `I noticed you asked to keep "${unknownProtectedDevice}" safe, but I couldn't find an appliance matching that in your household inventory. Configured appliances are: ${knownList}. Which appliance would you like to protect?`,
      };
    }

    // Extract protected-device constraints
    // Rule: Refrigerator is protected by default unless explicitly permitted to curtail
    const allowsFridgeModification =
      lower.includes("allow fridge") ||
      lower.includes("unprotect fridge") ||
      lower.includes("include fridge") ||
      lower.includes("turn off fridge") ||
      lower.includes("adjust fridge") ||
      lower.includes("allow refrigerator") ||
      lower.includes("unprotect refrigerator");

    const protectedList = [];
    if (!allowsFridgeModification) {
      // Find all refrigerator devices in the household context
      const fridgeDevs = context?.household?.devices?.filter(
        (d) => d.category === "refrigerator" || /fridge|refrigerator|freezer/i.test(d.name)
      );
      if (fridgeDevs && fridgeDevs.length > 0) {
        fridgeDevs.forEach((d) => {
          if (!protectedList.includes(d.name)) protectedList.push(d.name);
        });
      } else {
        protectedList.push("Refrigerator");
      }
    }

    // Check if other devices are explicitly marked for protection
    const protectionRegex = /(?:keep|protect|don't turn off|do not turn off|save|exclude|preserve)\s+(?:the\s+)?([a-z\s]+?)(?:safe|on|running|from|\.|$|,)/gi;
    let match;
    while ((match = protectionRegex.exec(lower)) !== null) {
      const phrase = match[1].trim();
      if (!phrase) continue;
      if (/fridge|refrigerator|freezer|food storage|food spoilage/i.test(phrase)) {
        const fridgeDevs = context?.household?.devices?.filter(
          (d) => d.category === "refrigerator" || /fridge|refrigerator|freezer/i.test(d.name)
        );
        if (fridgeDevs && fridgeDevs.length > 0) {
          fridgeDevs.forEach((d) => {
            if (!protectedList.includes(d.name)) protectedList.push(d.name);
          });
        } else if (!protectedList.includes("Refrigerator")) {
          protectedList.push("Refrigerator");
        }
      } else {
        const matchedCanonical = matchDeviceName(phrase, context);
        if (matchedCanonical && !protectedList.includes(matchedCanonical)) {
          protectedList.push(matchedCanonical);
        }
      }
    }

    return {
      type: "PLAN_GOAL",
      targetReductionPercent: targetPercent,
      maxKwhBudget: budgetKwh,
      protectedDevices: protectedList,
      rawQuery: input,
    };
  }

  // 4. Existing Appliance specific status or energy
  const matchedDevice = knownDevices.find((d) =>
    d.aliases.some((a) => {
      const wordBoundary = new RegExp(`\\b${a}\\b`, "i");
      return wordBoundary.test(lower);
    })
  );

  const asksForEnergy = /\b(energy|usage|consumption|consume|consumes|kwh|electricity|power)\b/i.test(lower);
  const asksForStatus = /\b(status|running|on|off|idle|working|operating|turned)\b/i.test(lower);

  if (matchedDevice && asksForEnergy) {
    return {
      type: "DEVICE_ENERGY",
      deviceName: matchedDevice.canonical,
    };
  }

  if (matchedDevice) {
    return {
      type: "DEVICE_STATUS",
      deviceName: matchedDevice.canonical,
      asksForStatus,
    };
  }

  // 5. General devices list
  if (
    lower.includes("device") ||
    lower.includes("appliances") ||
    lower.includes("all devices") ||
    lower.includes("everything")
  ) {
    return { type: "ALL_DEVICES" };
  }

  // 6. General summary
  if (
    lower.includes("summary") ||
    lower.includes("overview") ||
    lower.includes("highest") ||
    lower.includes("top consumer") ||
    lower.includes("total") ||
    lower.includes("home")
  ) {
    return { type: "HOUSEHOLD_SUMMARY" };
  }

  // 7. Unsupported query (out of scope)
  return {
    type: "UNSUPPORTED",
    message:
      "I am HomePilot, focused specifically on household energy operations and MCP goal-based planning. I can help inspect simulated appliance usage, check device status, or formulate energy reduction plans (e.g. 'Reduce electricity by 15%, but keep the fridge safe').",
  };
}

/**
 * Formats a grounded conversational explanation for an energy plan returned by POST /api/plan.
 */
export function formatGroundedPlanResponse(plan) {
  if (!plan || !plan.status) {
    return "Error: Received an invalid or empty plan from the MCP server.";
  }

  const {
    status,
    explanation,
    target,
    baseline,
    proposed,
    savings,
    actionsApplied,
    protectedDevices,
    dataSource,
  } = plan;

  const currency = savings.currency || "$";
  const lines = [];

  // 1. Feasibility & Main outcome
  if (status === "achieved") {
    lines.push(`✅ ${explanation}`);
  } else if (status === "partial") {
    lines.push(`⚠️ ${explanation}`);
  } else {
    lines.push(`ℹ️ Current baseline already satisfies your goal. No device adjustments required.`);
  }

  // 2. Baseline vs Proposed Metrics
  lines.push("");
  lines.push(`📊 Scenario Overview:`);
  if (target && (target.requestedTargetLabel || target.description)) {
    lines.push(`• Target: ${target.requestedTargetLabel || target.description}`);
  }
  lines.push(`• Baseline Usage: ${baseline.totalKwh} kWh (${currency}${baseline.estimatedCost})`);
  lines.push(`• Proposed Usage: ${proposed.totalKwh} kWh (${currency}${proposed.estimatedCost})`);
  lines.push(
    `• Estimated Savings: ${savings.estimatedKwhSaved} kWh (${savings.estimatedPercentSaved}%), saving approx. ${currency}${savings.estimatedCostSaved} (at ${currency}${savings.tariffPerKwh}/kWh).`
  );

  // 3. Actions Applied
  lines.push("");
  if (actionsApplied && actionsApplied.length > 0) {
    lines.push(`🔧 Selected Operational Actions:`);
    actionsApplied.forEach((a) => {
      lines.push(`• ${a.name} on ${a.deviceName}: -${a.kwhSaved} kWh`);
      lines.push(`   Trade-off: ${a.tradeOff}`);
      lines.push(`   Assumption: ${a.assumption}`);
    });
  } else {
    lines.push(`🔧 No device curtailments selected.`);
  }

  // 4. Protected Devices Invariant
  lines.push("");
  const pList = Array.isArray(protectedDevices) ? protectedDevices : [];
  lines.push(
    `🛡️ Protected Devices: ${pList.length > 0 ? pList.join(", ") : "None"}`
  );
  const hasFridgeProtected = pList.some((d) =>
    /refrigerator|fridge|freezer/i.test(d)
  );
  if (hasFridgeProtected) {
    lines.push(`   (Preserved strictly against curtailment for food safety.)`);
  }

  // 5. Transparent Disclaimer
  lines.push("");
  lines.push(
    `Transparency Notice: Household baseline is simulated prototype data. Savings are deterministic mathematical estimates, not guaranteed physical measurements. (${dataSource})`
  );

  return lines.join("\n");
}

/**
 * Explains why a target was unachieved or why an action was selected based on plan context.
 */
export function explainPlanDecision(query, currentPlan, context = {}) {
  if (!currentPlan) {
    return (
      "No energy plan has been calculated yet in your session. Please specify a goal first (for example: 'Reduce electricity by 15%, but keep the fridge safe') so I can evaluate the options and explain the reasoning."
    );
  }

  const lower = query.toLowerCase();
  const knownDevices = getKnownDevices(context);

  // Explain why target was infeasible or partially met
  if (
    lower.includes("target") ||
    lower.includes("achieve") ||
    lower.includes("impossible") ||
    lower.includes("infeasible") ||
    lower.includes("shortfall") ||
    lower.includes("could not") ||
    lower.includes("couldn't") ||
    /\d+%/.test(lower)
  ) {
    if (currentPlan.status === "achieved") {
      return (
        `Your requested target (${currentPlan.target.requestedTargetLabel}) was completely achieved! The engine found feasible physical actions on non-protected devices saving ${currentPlan.savings.estimatedKwhSaved} kWh (${currentPlan.savings.estimatedPercentSaved}%), exceeding the required threshold without violating your safety constraints.`
      );
    }

    const protectedList = currentPlan.protectedDevices.join(", ") || "none";
    const appliedList = currentPlan.actionsApplied.map((a) => a.name).join(", ") || "no actions";
    const targetLabel = currentPlan.target?.requestedTargetLabel ||
      (currentPlan.target?.requestedPercent ? `${currentPlan.target.requestedPercent}% reduction` : "requested goal");

    return (
      `Here is why your requested target (${targetLabel}) could not be fully met:\n\n` +
      `1. Safety Invariants: ${protectedList} is marked as protected. In accordance with safety rules, the engine will never turn off or curtail protected appliances to hit a mathematical target.\n` +
      `2. Physical Limits: Even after applying all available non-intrusive actions (${appliedList}), the maximum feasible reduction achievable was ${currentPlan.savings.estimatedKwhSaved} kWh (${currentPlan.savings.estimatedPercentSaved}%).\n` +
      `3. Transparency: HomePilot reports real physical feasibility instead of inventing fabricated savings.`
    );
  }

  // Explain specific device action (e.g. "why the AC?", "why lights?")
  const matchedDevice = knownDevices.find((d) =>
    d.aliases.some((a) => lower.includes(a))
  );

  if (matchedDevice) {
    const action = currentPlan.actionsApplied.find(
      (a) => a.deviceName.toLowerCase() === matchedDevice.canonical.toLowerCase()
    );

    if (action) {
      return (
        `Action explanation for ${matchedDevice.canonical}:\n\n` +
        `• Selected Action: ${action.name}\n` +
        `• Reduction: -${action.kwhSaved} kWh (${action.percentReduction}%)\n` +
        `• Trade-off: ${action.tradeOff}\n` +
        `• Engineering Assumption: ${action.assumption}\n\n` +
        `This action was prioritized because it delivered the needed reduction with minimal disruption to household operations.`
      );
    } else {
      const isProt = currentPlan.protectedDevices.includes(matchedDevice.canonical);
      if (isProt) {
        return `${matchedDevice.canonical} was not modified because it is on your Protected Devices list.`;
      }
      return `${matchedDevice.canonical} was not modified because the target reduction was already met using higher-priority or less disruptive adjustments.`;
    }
  }

  // General audit explanation
  const decisionLogLines = currentPlan.decisionLog.map((e) => `• [${e.type.toUpperCase()}] ${e.message}`);
  return (
    `Here is the decision audit trail from the planning engine:\n\n` +
    decisionLogLines.join("\n")
  );
}
