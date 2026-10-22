
import express from "express";
import cors from "cors";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  extractIntentWithOllama,
  getActiveOllamaModel,
} from "./ollama.js";
import {
  parseAssistantIntent,
  explainPlanDecision,
  formatGroundedPlanResponse,
} from "../client/src/assistant.js";
import {
  validateHousehold,
  DEFAULT_HOUSEHOLD,
  resolveProtectedDeviceNames,
} from "./planner.js";

const app = express();
const PORT = 3001;
const MCP_URL = "http://localhost:3000/mcp";

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:4173",
    ],
  })
);
app.use(express.json());

async function callHomePilotTool(name, args = {}) {
  const client = new Client({
    name: "homepilot-dashboard",
    version: "1.0.0",
  });

  const transport = new StreamableHTTPClientTransport(
    new URL(MCP_URL)
  );

  try {
    await client.connect(transport);

    const result = await client.callTool({
      name,
      arguments: args,
    });

    if (result.isError) {
      throw new Error(`MCP tool failed: ${name}`);
    }

    const textContent = result.content.find(
      (item) => item.type === "text"
    );

    if (!textContent) {
      throw new Error("MCP tool returned no text result.");
    }

    return JSON.parse(textContent.text);
  } finally {
    await client.close().catch(() => {});
  }
}

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "HomePilot API" });
});

app.get("/api/energy", async (_req, res) => {
  try {
    res.json(await callHomePilotTool("get_energy_usage"));
  } catch (error) {
    console.error("Energy API error:", error);
    res.status(502).json({ error: "Could not retrieve energy usage." });
  }
});

app.get("/api/devices", async (_req, res) => {
  try {
    res.json(await callHomePilotTool("get_device_status"));
  } catch (error) {
    console.error("Device API error:", error);
    res.status(502).json({ error: "Could not retrieve device status." });
  }
});

app.get("/api/summary", async (_req, res) => {
  try {
    res.json(await callHomePilotTool("get_energy_summary"));
  } catch (error) {
    console.error("Summary API error:", error);
    res.status(502).json({ error: "Could not retrieve energy summary." });
  }
});

function validatePlanInputs(input) {
  const errors = [];
  const args = {};

  if (input.targetReductionPercent !== undefined && input.targetReductionPercent !== null && input.targetReductionPercent !== "") {
    const val = Number(input.targetReductionPercent);
    if (isNaN(val) || val < 0 || val > 100) {
      errors.push("targetReductionPercent must be a number between 0 and 100.");
    } else {
      args.targetReductionPercent = val;
    }
  }

  if (input.maxKwhBudget !== undefined && input.maxKwhBudget !== null && input.maxKwhBudget !== "") {
    const val = Number(input.maxKwhBudget);
    if (isNaN(val) || val < 0) {
      errors.push("maxKwhBudget must be a non-negative number.");
    } else {
      args.maxKwhBudget = val;
    }
  }

  if (input.protectedDevices !== undefined && input.protectedDevices !== null) {
    if (Array.isArray(input.protectedDevices)) {
      if (!input.protectedDevices.every((d) => typeof d === "string")) {
        errors.push("protectedDevices must be an array of string device names.");
      } else {
        args.protectedDevices = input.protectedDevices;
      }
    } else if (typeof input.protectedDevices === "string") {
      args.protectedDevices = input.protectedDevices
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else {
      errors.push("protectedDevices must be an array of device names or a comma-separated string.");
    }
  }

  if (input.tariffPerKwh !== undefined && input.tariffPerKwh !== null && input.tariffPerKwh !== "") {
    const val = Number(input.tariffPerKwh);
    if (isNaN(val) || val < 0) {
      errors.push("tariffPerKwh must be a non-negative number.");
    } else {
      args.tariffPerKwh = val;
    }
  }

  if (input.currency !== undefined && input.currency !== null) {
    if (typeof input.currency !== "string") {
      errors.push("currency must be a string symbol (e.g. '$' or '₹').");
    } else {
      args.currency = input.currency.trim();
    }
  }

  if (input.household !== undefined && input.household !== null) {
    const val = validateHousehold(input.household);
    if (!val.valid) {
      errors.push(`Household validation error: ${val.error}`);
    } else {
      args.household = val.household;
    }
  }

  // Resolve protected device names against household devices if provided
  if (args.protectedDevices && Array.isArray(args.protectedDevices)) {
    const hhDevices = (args.household && Array.isArray(args.household.devices))
      ? args.household.devices
      : DEFAULT_HOUSEHOLD.devices;
    const resolved = resolveProtectedDeviceNames(args.protectedDevices, hhDevices).matched;
    if (resolved.length > 0) {
      args.protectedDevices = resolved;
    }
  }

  return { errors, args };
}

app.get("/api/household/default", (_req, res) => {
  res.json({
    status: "ok",
    household: DEFAULT_HOUSEHOLD,
    metadata: {
      formula: "daily kWh = quantity * ratedWatts * dailyHours * dutyCycle / 1000",
      dutyFactorAssumptions: {
        ac: "0.57 (compressor cycles ~57% of runtime)",
        refrigerator: "0.50 (compressor runs ~50% of the day)",
        washing_machine: "0.75 (motor and fill cycling)",
        standard: "1.00 (continuous operational draw)",
      },
    },
  });
});

app.post("/api/plan", async (req, res) => {
  const { errors, args } = validatePlanInputs(req.body || {});
  if (errors.length > 0) {
    return res.status(400).json({
      error: "Invalid planning parameters.",
      details: errors,
    });
  }

  try {
    const plan = await callHomePilotTool("plan_energy_reduction", args);
    res.json(plan);
  } catch (error) {
    console.error("Plan API error:", error);
    res.status(502).json({
      error: "Could not generate energy plan via MCP server.",
      details: error.message,
    });
  }
});

app.get("/api/plan", async (req, res) => {
  const { errors, args } = validatePlanInputs(req.query || {});
  if (errors.length > 0) {
    return res.status(400).json({
      error: "Invalid planning parameters.",
      details: errors,
    });
  }

  try {
    const plan = await callHomePilotTool("plan_energy_reduction", args);
    res.json(plan);
  } catch (error) {
    console.error("Plan API error:", error);
    res.status(502).json({
      error: "Could not generate energy plan via MCP server.",
      details: error.message,
    });
  }
});

app.post("/api/chat", async (req, res) => {
  const {
    message,
    tariffPerKwh = 0.15,
    currency = "$",
    currentPlan = null,
    protectedDevices = ["Refrigerator"],
    household = null,
  } = req.body || {};

  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "A non-empty 'message' string is required." });
  }

  let activeHousehold = null;
  if (household) {
    const val = validateHousehold(household);
    if (val.valid) activeHousehold = val.household;
  }

  const query = message.trim();
  let intentData = null;
  let engine = "deterministic-fallback";

  // 1. Attempt genuine local AI intent extraction with Ollama (qwen3:4b)
  try {
    const activeModel = await getActiveOllamaModel();
    const aiResult = await extractIntentWithOllama(query, {
      model: activeModel,
      timeoutMs: 30000,
      household: activeHousehold,
    });

    if (aiResult.success && aiResult.intentData) {
      engine = `ollama:${aiResult.model}`;
      intentData = aiResult.intentData;
    }
  } catch (err) {
    console.warn("Ollama extraction encountered an error; falling back to deterministic parser:", err.message);
  }

  // 2. Deterministic fallback if Ollama was unavailable, timed out, or returned malformed output
  if (!intentData) {
    engine = "deterministic-fallback";
    const fallbackParsed = parseAssistantIntent(query, {
      currentPlan,
      tariff: tariffPerKwh,
      currency,
      household: activeHousehold,
    });

    if (fallbackParsed.type === "PLAN_GOAL") {
      intentData = {
        intent: "PLAN_GOAL",
        targetReductionPercent: fallbackParsed.targetReductionPercent ?? null,
        maxKwhBudget: fallbackParsed.maxKwhBudget ?? null,
        protectedDevices: Array.isArray(fallbackParsed.protectedDevices) ? fallbackParsed.protectedDevices : [],
        targetDevice: null,
        clarificationQuestion: null,
      };
    } else if (fallbackParsed.type === "EXPLAIN_WHY") {
      intentData = {
        intent: "EXPLAIN_WHY",
        targetReductionPercent: null,
        maxKwhBudget: null,
        protectedDevices: [],
        targetDevice: fallbackParsed.targetDevice || null,
        clarificationQuestion: null,
      };
    } else if (fallbackParsed.type === "CLARIFICATION_NEEDED") {
      intentData = {
        intent: "CLARIFICATION_NEEDED",
        targetReductionPercent: null,
        maxKwhBudget: null,
        protectedDevices: [],
        targetDevice: null,
        clarificationQuestion: fallbackParsed.message,
      };
    } else if (fallbackParsed.type === "DEVICE_STATUS") {
      intentData = {
        intent: "DEVICE_STATUS",
        targetReductionPercent: null,
        maxKwhBudget: null,
        protectedDevices: [],
        targetDevice: fallbackParsed.deviceName || null,
        clarificationQuestion: null,
      };
    } else if (fallbackParsed.type === "DEVICE_ENERGY") {
      intentData = {
        intent: "DEVICE_ENERGY",
        targetReductionPercent: null,
        maxKwhBudget: null,
        protectedDevices: [],
        targetDevice: fallbackParsed.deviceName || null,
        clarificationQuestion: null,
      };
    } else if (fallbackParsed.type === "UNSUPPORTED") {
      intentData = {
        intent: "UNSUPPORTED",
        targetReductionPercent: null,
        maxKwhBudget: null,
        protectedDevices: [],
        targetDevice: null,
        clarificationQuestion: fallbackParsed.message,
      };
    } else {
      intentData = {
        intent: "HOUSEHOLD_SUMMARY",
        targetReductionPercent: null,
        maxKwhBudget: null,
        protectedDevices: [],
        targetDevice: null,
        clarificationQuestion: null,
      };
    }
  }

  // 3. Action Execution & MCP Grounding
  try {
    switch (intentData.intent) {
      case "PLAN_GOAL": {
        const householdDevices = (activeHousehold && Array.isArray(activeHousehold.devices))
          ? activeHousehold.devices
          : DEFAULT_HOUSEHOLD.devices;

        const queryLower = query.toLowerCase();
        const explicitlyAllowsFridge =
          /\b(allow|unprotect|include|turn off|shut off|adjust|modify|cut)\s+(?:the\s+)?(?:fridge|refrigerator|freezer|food storage)\b/i.test(queryLower) ||
          queryLower.includes("don't protect the fridge") ||
          queryLower.includes("do not protect the fridge") ||
          queryLower.includes("don't protect the refrigerator") ||
          queryLower.includes("do not protect the refrigerator");

        // 1. Resolve UI requested protections
        const uiRequested = Array.isArray(protectedDevices) ? protectedDevices : [];
        const uiResolved = resolveProtectedDeviceNames(uiRequested, householdDevices).matched;

        // 2. Resolve Chat requested protections
        const chatRequested = Array.isArray(intentData.protectedDevices) ? intentData.protectedDevices : [];
        const chatResolution = resolveProtectedDeviceNames(chatRequested, householdDevices);

        // Clarification invariant: If user asked to protect an unresolvable device name, ask for clarification
        if (chatResolution.unmatched.length > 0) {
          const unknownDevice = chatResolution.unmatched[0];
          const availableNames = householdDevices.map((d) => d.name).join(", ");
          return res.json({
            text: `I noticed you asked to protect "${unknownDevice}", but I couldn't find an appliance matching that in your household inventory. Your configured appliances are: ${availableNames}. Which appliance would you like to protect?`,
            plan: null,
            engine,
            intent: "CLARIFICATION_NEEDED",
            intentData: {
              ...intentData,
              intent: "CLARIFICATION_NEEDED",
              clarificationQuestion: `I couldn't find an appliance matching "${unknownDevice}" in your household inventory.`,
            },
          });
        }

        // 3. Merge UI protections + Chat protections
        const mergedSet = new Set([...uiResolved, ...chatResolution.matched]);

        // 4. Default safety invariant: Protect refrigerators unless explicitly allowed/unprotected
        if (!explicitlyAllowsFridge) {
          householdDevices.forEach((d) => {
            if (d.category === "refrigerator" || /fridge|refrigerator|freezer/i.test(d.name) || d.isProtected) {
              mergedSet.add(d.name);
            }
          });
        } else {
          householdDevices.forEach((d) => {
            if (d.category === "refrigerator" || /fridge|refrigerator|freezer/i.test(d.name)) {
              mergedSet.delete(d.name);
            }
          });
        }

        const finalProtected = Array.from(mergedSet);

        const planArgs = {
          tariffPerKwh: Number(tariffPerKwh) || 0.15,
          currency: String(currency || "$"),
          protectedDevices: finalProtected,
        };
        if (intentData.targetReductionPercent !== null && intentData.targetReductionPercent !== undefined) {
          planArgs.targetReductionPercent = Number(intentData.targetReductionPercent);
        }
        if (intentData.maxKwhBudget !== null && intentData.maxKwhBudget !== undefined) {
          planArgs.maxKwhBudget = Number(intentData.maxKwhBudget);
        }
        if (activeHousehold) {
          planArgs.household = activeHousehold;
        }

        const plan = await callHomePilotTool("plan_energy_reduction", planArgs);
        const text = formatGroundedPlanResponse(plan);

        return res.json({
          text,
          plan,
          engine,
          intent: intentData.intent,
          intentData: {
            ...intentData,
            protectedDevices: finalProtected,
          },
        });
      }

      case "EXPLAIN_WHY": {
        const text = explainPlanDecision(query, currentPlan);
        return res.json({
          text,
          plan: null,
          engine,
          intent: intentData.intent,
          intentData,
        });
      }

      case "CLARIFICATION_NEEDED": {
        const text =
          intentData.clarificationQuestion ||
          "To generate an energy plan, please provide a reduction target (e.g. 'reduce by 15%') or a usage budget limit (e.g. 'keep under 5 kWh').";
        return res.json({
          text,
          plan: null,
          engine,
          intent: intentData.intent,
          intentData,
        });
      }

      case "DEVICE_STATUS": {
        let text = "";
        const targetDevName =
          intentData.targetDevice ||
          (activeHousehold
            ? activeHousehold.devices.find(
                (d) =>
                  query.toLowerCase().includes(d.name.toLowerCase()) ||
                  (d.category && query.toLowerCase().includes(d.category.toLowerCase().replace(/_/g, " ")))
              )?.name
            : null);

        if (activeHousehold && targetDevName) {
          const matched = activeHousehold.devices.find(
            (d) =>
              d.name.toLowerCase() === targetDevName.toLowerCase() ||
              d.name.toLowerCase().includes(targetDevName.toLowerCase()) ||
              targetDevName.toLowerCase().includes(d.name.toLowerCase())
          );
          if (matched) {
            text = `${matched.name} (${matched.room}): Configured status is "${matched.status}" (${matched.isProtected ? "🛡️ Protected against curtailment" : "Standard load"}).`;
          }
        }

        if (!text) {
          const deviceData = await callHomePilotTool("get_device_status");
          if (targetDevName) {
            const matched = deviceData.devices.find(
              (d) => d.name.toLowerCase() === targetDevName.toLowerCase()
            );
            text = matched
              ? `${matched.name} reported simulated status: ${matched.status}.`
              : `Device status for ${targetDevName} was not found.`;
          } else {
            text =
              "Household Device Telemetry (Simulated):\n" +
              deviceData.devices.map((d) => `• ${d.name}: ${d.status}`).join("\n");
          }
        }

        return res.json({
          text,
          plan: null,
          engine,
          intent: intentData.intent,
          intentData,
        });
      }

      case "DEVICE_ENERGY": {
        let text = "";
        const targetDevName =
          intentData.targetDevice ||
          (activeHousehold
            ? activeHousehold.devices.find(
                (d) =>
                  query.toLowerCase().includes(d.name.toLowerCase()) ||
                  (d.category && query.toLowerCase().includes(d.category.toLowerCase().replace(/_/g, " ")))
              )?.name
            : null);

        if (activeHousehold && targetDevName) {
          const matched = activeHousehold.devices.find(
            (d) =>
              d.name.toLowerCase() === targetDevName.toLowerCase() ||
              d.name.toLowerCase().includes(targetDevName.toLowerCase()) ||
              targetDevName.toLowerCase().includes(d.name.toLowerCase())
          );
          if (matched) {
            const cost = (matched.kwh * (Number(tariffPerKwh) || 0.15)).toFixed(2);
            text = `${matched.name} (${matched.room}): Rated ${matched.ratedWatts}W × ${matched.dailyHours} hrs/day (${Math.round((matched.dutyCycle || 1) * 100)}% duty cycle) = ${matched.kwh} kWh/day estimated baseline (~${currency}${cost}/day at ${currency}${tariffPerKwh}/kWh).\n\n(Calculated from your configured household twin parameters.)`;
          }
        }

        if (!text) {
          const energyData = await callHomePilotTool("get_energy_usage");
          if (targetDevName) {
            const matched = energyData.devices.find(
              (d) => d.name.toLowerCase() === targetDevName.toLowerCase()
            );
            text = matched
              ? `${matched.name} consumed ${matched.kwh} kWh in simulated telemetry for ${energyData.date}.`
              : `Energy reading for ${targetDevName} was not found.`;
          } else {
            text = `Total simulated energy reading: ${energyData.totalKwh} kWh on ${energyData.date}.`;
          }
        }

        return res.json({
          text,
          plan: null,
          engine,
          intent: intentData.intent,
          intentData,
        });
      }

      case "UNSUPPORTED": {
        return res.json({
          text:
            intentData.clarificationQuestion ||
            "HomePilot specializes in household energy management, smart device telemetry, and curtailment planning. I cannot answer queries unrelated to home operations.",
          plan: null,
          engine,
          intent: intentData.intent,
          intentData,
        });
      }

      case "HOUSEHOLD_SUMMARY":
      default: {
        let text = "";
        if (activeHousehold && activeHousehold.devices && activeHousehold.devices.length > 0) {
          const totalKwh = Number(activeHousehold.devices.reduce((s, d) => s + d.kwh, 0).toFixed(2));
          const sorted = [...activeHousehold.devices].sort((a, b) => b.kwh - a.kwh);
          const top = sorted[0];
          const topShare = totalKwh > 0 ? ((top.kwh / totalKwh) * 100).toFixed(1) : 0;
          const rooms = [...new Set(activeHousehold.devices.map((d) => d.room))].join(", ");
          const cost = (totalKwh * (Number(tariffPerKwh) || 0.15)).toFixed(2);
          const protectedList = activeHousehold.devices.filter((d) => d.isProtected).map((d) => d.name).join(", ");
          text =
            `Configured Household Twin Overview:\n` +
            `• Baseline Usage: ${totalKwh} kWh/day across ${activeHousehold.devices.length} appliances in ${rooms} (~${currency}${cost}/day at ${currency}${tariffPerKwh}/kWh).\n` +
            `• Highest Consumer: ${top.name} in ${top.room} (${top.kwh} kWh/day, ${topShare}% of household total).\n` +
            `• Protected Devices: ${protectedList || "None"}.\n\n` +
            `Recommended Next Action: Try setting a 15% reduction goal in the Energy Plan tab to formulate a safe curtailment plan.`;
        } else {
          const summary = await callHomePilotTool("get_energy_summary");
          text =
            `Total household usage: ${summary.totalKwh} kWh.\n` +
            `Highest consumer: ${summary.highestConsumer.name} (${summary.highestConsumer.sharePercent}% of total).\n` +
            `${summary.recommendation}\n\n` +
            `Data source: ${summary.dataSource}.`;
        }

        return res.json({
          text,
          plan: null,
          engine,
          intent: "HOUSEHOLD_SUMMARY",
          intentData,
        });
      }
    }
  } catch (toolErr) {
    console.error("Chat tool execution error:", toolErr);
    return res.status(502).json({
      error: "Error executing MCP tool for request.",
      details: toolErr.message,
      engine,
    });
  }
});

app.listen(PORT, () => {
  console.log(`HomePilot API running at http://localhost:${PORT}`);
});
