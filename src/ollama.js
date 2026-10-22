/**
 * HomePilot Local AI Client (Ollama Integration)
 * 
 * Provides genuine local LLM intent extraction using Ollama.
 * Strict JSON schema mode, timeout safety, parameter validation,
 * and seamless fallback handling.
 */

export const OLLAMA_DEFAULT_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
export const OLLAMA_DEFAULT_MODEL = process.env.OLLAMA_MODEL || "qwen3:4b";
export const OLLAMA_DEFAULT_TIMEOUT_MS = 25000;

const KNOWN_DEVICE_CANONICALS = {
  ac: "Living Room AC",
  "air conditioner": "Living Room AC",
  "air conditioning": "Living Room AC",
  cooling: "Living Room AC",
  "living room ac": "Living Room AC",
  refrigerator: "Refrigerator",
  fridge: "Refrigerator",
  freezer: "Refrigerator",
  washer: "Washing Machine",
  "washing machine": "Washing Machine",
  laundry: "Washing Machine",
  lights: "Living Room Lights",
  light: "Living Room Lights",
  lighting: "Living Room Lights",
  lamp: "Living Room Lights",
  "living room lights": "Living Room Lights",
};

export function normalizeDeviceName(rawName, household = null) {
  if (!rawName || typeof rawName !== "string") return null;
  const cleaned = rawName.trim().toLowerCase();
  if (!cleaned) return null;

  // 1. Check household devices if provided
  if (household && Array.isArray(household.devices)) {
    for (const dev of household.devices) {
      const devNameLower = dev.name.toLowerCase();
      if (devNameLower === cleaned) return dev.name;
      if (devNameLower.includes(cleaned) || cleaned.includes(devNameLower)) return dev.name;
      if (
        (dev.category === "refrigerator" || /fridge|refrigerator|freezer/i.test(dev.name)) &&
        ["fridge", "refrigerator", "freezer", "food storage", "food", "food spoilage"].some((a) => cleaned === a || cleaned.includes(a) || a.includes(cleaned))
      ) {
        return dev.name;
      }
    }
  }

  // 2. Canonical mapping for default appliances
  if (KNOWN_DEVICE_CANONICALS[cleaned]) {
    return KNOWN_DEVICE_CANONICALS[cleaned];
  }
  for (const [alias, canonical] of Object.entries(KNOWN_DEVICE_CANONICALS)) {
    if (cleaned === alias || cleaned.includes(alias) || alias.includes(cleaned)) {
      return canonical;
    }
  }

  // 3. Return trimmed rawName as valid device name candidate
  return rawName.trim();
}

/**
 * Checks whether the local Ollama instance is accessible.
 */
export async function checkOllamaAvailability({
  baseUrl = OLLAMA_DEFAULT_URL,
  timeoutMs = 1500,
} = {}) {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      return { available: false, models: [], error: `HTTP ${res.status}` };
    }
    const data = await res.json();
    const models = Array.isArray(data.models) ? data.models.map((m) => m.name) : [];
    return { available: true, models, error: null };
  } catch (err) {
    return { available: false, models: [], error: err.message };
  }
}

/**
 * Determines the best installed model. Prioritizes qwen3:4b or llama3.2 if present.
 */
export async function getActiveOllamaModel(baseUrl = OLLAMA_DEFAULT_URL) {
  if (process.env.OLLAMA_MODEL) {
    return process.env.OLLAMA_MODEL;
  }
  const check = await checkOllamaAvailability({ baseUrl });
  if (check.available && check.models.length > 0) {
    if (check.models.some((m) => m.startsWith("qwen3:4b"))) return "qwen3:4b";
    if (check.models.some((m) => m.startsWith("llama3.2"))) return "llama3.2:latest";
    return check.models[0];
  }
  return OLLAMA_DEFAULT_MODEL;
}

const SYSTEM_PROMPT = `You are HomePilot's AI Energy Intent Extractor.
Extract the user's intent into a STRICT JSON object with these keys ONLY:
- "intent": one of ["PLAN_GOAL", "DEVICE_STATUS", "DEVICE_ENERGY", "EXPLAIN_WHY", "CLARIFICATION_NEEDED", "HOUSEHOLD_SUMMARY", "UNSUPPORTED"]
- "targetReductionPercent": number (0-100) or null
- "maxKwhBudget": number (positive kWh limit) or null
- "protectedDevices": array of strings (e.g. ["Refrigerator", "Living Room AC"])
- "targetDevice": string (canonical device name) or null
- "clarificationQuestion": string or null (only if intent is CLARIFICATION_NEEDED)

Known appliances:
1. "Living Room AC" (aliases: ac, air conditioner)
2. "Refrigerator" (aliases: fridge)
3. "Washing Machine" (aliases: washer, laundry)
4. "Living Room Lights" (aliases: lights)

RULES FOR INTENT:
1. "PLAN_GOAL": Use whenever the user asks to reduce, cut, or save energy, specifies a percentage (e.g. 20%), or sets a budget (e.g. 5 kWh).
2. "DEVICE_STATUS": ONLY for asking if an appliance is running or on/off (e.g. "Is the AC on?").
3. "DEVICE_ENERGY": ONLY for asking how much energy an appliance consumes (e.g. "How much power does the fridge use?").
4. "EXPLAIN_WHY": Whenever user asks why a target was unachieved or why an action was chosen.
5. "CLARIFICATION_NEEDED": When user wants to save energy but specifies NEITHER a percentage nor a budget limit.
6. "UNSUPPORTED": Out of scope questions (weather, music, sports).

PROTECTION RULES:
- ALWAYS protect "Refrigerator" by default unless the user explicitly asks to allow or unprotect the fridge.
- If user mentions keeping any other appliance safe/on/running, include it in "protectedDevices".

Return raw JSON only. Do not add markdown fences or explanation.`;

/**
 * Extracts structured intent from a user prompt using local Ollama.
 */
export async function extractIntentWithOllama(
  userQuery,
  {
    baseUrl = OLLAMA_DEFAULT_URL,
    model = OLLAMA_DEFAULT_MODEL,
    timeoutMs = OLLAMA_DEFAULT_TIMEOUT_MS,
    fetchFn = fetch, // Allows injection for mocking/testing
    household = null,
  } = {}
) {
  if (!userQuery || typeof userQuery !== "string" || !userQuery.trim()) {
    return {
      success: false,
      fallback: true,
      reason: "Empty or invalid query.",
    };
  }

  try {
    let cleanJson = "";

    // If qwen3 (which generates thinking tokens by default), use ChatML format with pre-closed think tag for fast CPU inference
    if (model.includes("qwen3")) {
      const prompt = `<|im_start|>system
You are HomePilot's AI Energy Intent Extractor.
Extract user's intent into a raw JSON object with these keys:
- "intent": "PLAN_GOAL" | "DEVICE_STATUS" | "DEVICE_ENERGY" | "EXPLAIN_WHY" | "CLARIFICATION_NEEDED" | "UNSUPPORTED"
- "targetReductionPercent": number (0-100) or null
- "maxKwhBudget": number (positive kWh limit) or null
- "protectedDevices": array of strings (e.g. ["Refrigerator"])
- "targetDevice": string or null
- "clarificationQuestion": string or null

Rules:
- If user wants to save or reduce power with a percentage or kWh budget, use "PLAN_GOAL".
- If user wants to save power but specifies no number, use "CLARIFICATION_NEEDED" and provide a helpful "clarificationQuestion".
- If user asks if a device is on/off, use "DEVICE_STATUS".
- If user asks how much energy/power a device uses, use "DEVICE_ENERGY".
- Protect "Refrigerator" by default.
<|im_end|>
<|im_start|>user
${userQuery.trim()}
<|im_end|>
<|im_start|>assistant
<think>
Done.
</think>
{`;

      const response = await fetchFn(`${baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          prompt,
          raw: true,
          stream: false,
          options: {
            num_predict: 200,
            temperature: 0.1,
          },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        throw new Error(`Ollama returned HTTP ${response.status}`);
      }

      const data = await response.json();
      const rawText = data?.response || "";
      cleanJson = ("{" + rawText).trim();
    } else {
      // Standard chat endpoint for llama3.2 and other non-thinking instruction models
      const response = await fetchFn(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userQuery.trim() },
          ],
          format: "json",
          stream: false,
          options: {
            num_ctx: 1024,
            temperature: 0.1,
          },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        throw new Error(`Ollama returned HTTP ${response.status}`);
      }

      const data = await response.json();
      const rawContent = data?.message?.content || "";
      if (!rawContent) {
        throw new Error("Ollama returned an empty message content.");
      }
      cleanJson = rawContent.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    }

    if (cleanJson.startsWith("```")) {
      cleanJson = cleanJson.replace(/^```[a-z]*\n?/i, "").replace(/```$/, "").trim();
    }

    let parsed;
    try {
      parsed = JSON.parse(cleanJson);
    } catch (parseErr) {
      throw new Error(`Ollama JSON parse error: ${parseErr.message}`);
    }

    // Validate and sanitize parsed fields
    const validIntents = [
      "PLAN_GOAL",
      "DEVICE_STATUS",
      "DEVICE_ENERGY",
      "EXPLAIN_WHY",
      "CLARIFICATION_NEEDED",
      "HOUSEHOLD_SUMMARY",
      "UNSUPPORTED",
    ];

    const intent = validIntents.includes(parsed.intent) ? parsed.intent : "PLAN_GOAL";

    let targetReductionPercent = null;
    if (
      typeof parsed.targetReductionPercent === "number" &&
      !isNaN(parsed.targetReductionPercent) &&
      parsed.targetReductionPercent >= 0 &&
      parsed.targetReductionPercent <= 100
    ) {
      targetReductionPercent = parsed.targetReductionPercent;
    }

    let maxKwhBudget = null;
    if (
      typeof parsed.maxKwhBudget === "number" &&
      !isNaN(parsed.maxKwhBudget) &&
      parsed.maxKwhBudget >= 0
    ) {
      maxKwhBudget = parsed.maxKwhBudget;
    }

    // Normalize protected devices to canonical names or custom household names
    const protectedDevices = [];
    if (Array.isArray(parsed.protectedDevices)) {
      for (const d of parsed.protectedDevices) {
        if (!d || typeof d !== "string") continue;
        const canonical = normalizeDeviceName(d, household);
        if (canonical && !protectedDevices.includes(canonical)) {
          protectedDevices.push(canonical);
        } else if (d.trim() && !protectedDevices.includes(d.trim())) {
          protectedDevices.push(d.trim());
        }
      }
    }

    // Safety Invariant: Protect Refrigerator unless user explicitly allowed modification
    const queryLower = userQuery.toLowerCase();
    const explicitlyAllowsFridge =
      queryLower.includes("allow fridge") ||
      queryLower.includes("unprotect fridge") ||
      queryLower.includes("include fridge") ||
      queryLower.includes("turn off fridge") ||
      queryLower.includes("adjust fridge") ||
      queryLower.includes("allow refrigerator") ||
      queryLower.includes("unprotect refrigerator");

    if (!explicitlyAllowsFridge) {
      const fridgeDevs = household?.devices?.filter(
        (dev) => dev.category === "refrigerator" || /fridge|refrigerator|freezer/i.test(dev.name)
      );
      if (fridgeDevs && fridgeDevs.length > 0) {
        fridgeDevs.forEach((dev) => {
          if (!protectedDevices.includes(dev.name)) {
            protectedDevices.push(dev.name);
          }
        });
      } else if (!protectedDevices.includes("Refrigerator")) {
        protectedDevices.push("Refrigerator");
      }
    }

    let finalIntent = intent;
    let clarificationQuestion = parsed.clarificationQuestion || null;

    // Safety & Clarification Invariant:
    // If user wants to save or reduce power without specifying percentage or budget
    // (e.g. "Save electricity without risking food spoilage")
    if (
      finalIntent === "PLAN_GOAL" &&
      targetReductionPercent === null &&
      maxKwhBudget === null
    ) {
      finalIntent = "CLARIFICATION_NEEDED";
      const mentionsFood =
        queryLower.includes("food") ||
        queryLower.includes("spoilage") ||
        queryLower.includes("fridge") ||
        queryLower.includes("refrigerator");
      clarificationQuestion = mentionsFood
        ? "I can help you build an energy-saving plan while keeping your food storage safely protected! What percentage reduction (e.g. 15% or 20%) or kWh usage budget (e.g. 5.0 kWh) would you like to target?"
        : "I can help you build an energy-saving plan! What percentage reduction (e.g. 15% or 20%) or kWh usage budget (e.g. 5.0 kWh) would you like to target?";
    }

    const targetDevice = normalizeDeviceName(parsed.targetDevice, household);

    return {
      success: true,
      provider: "ollama",
      model,
      intentData: {
        intent: finalIntent,
        targetReductionPercent,
        maxKwhBudget,
        protectedDevices,
        targetDevice,
        clarificationQuestion,
        rawQuery: userQuery,
      },
    };
  } catch (err) {
    return {
      success: false,
      fallback: true,
      reason: err.message,
      provider: "fallback",
    };
  }
}
