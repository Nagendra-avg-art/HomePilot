import assert from "node:assert/strict";
import {
  extractIntentWithOllama,
  checkOllamaAvailability,
  getActiveOllamaModel,
  normalizeDeviceName,
} from "../src/ollama.js";

console.log("=== Running Ollama AI Integration Unit & Mock Tests ===\n");

// Helper mock fetch creator
function createMockFetch({ status = 200, responseJson = {}, delayMs = 0, shouldThrow = false }) {
  return async (url, options) => {
    if (delayMs > 0) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, delayMs);
        if (options?.signal) {
          options.signal.addEventListener("abort", () => {
            clearTimeout(timer);
            const err = new Error("The operation was aborted due to timeout");
            err.name = "TimeoutError";
            reject(err);
          });
        }
      });
    }

    if (shouldThrow) {
      throw new Error("ECONNREFUSED 127.0.0.1:11434");
    }

    let payload = { ...responseJson };
    if (url.includes("/api/generate") && payload.response === undefined) {
      if (payload.message?.content) {
        // Strip leading '{' since generate prompt ends with '{'
        payload.response = payload.message.content.trim().replace(/^\{/, "");
      }
    }

    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
    };
  };
}

// Test 1: Device name normalization
{
  console.log("Test 1: Canonical device name normalization");
  assert.equal(normalizeDeviceName("fridge"), "Refrigerator");
  assert.equal(normalizeDeviceName("air conditioner"), "Living Room AC");
  assert.equal(normalizeDeviceName("lights"), "Living Room Lights");
  assert.equal(normalizeDeviceName("washer"), "Washing Machine");
  console.log("  PASS: Aliases correctly mapped to canonical names.\n");
}

// Test 2: Mock Successful percentage goal
{
  console.log("Test 2: Mock Ollama percentage goal extraction");
  const mockFetch = createMockFetch({
    responseJson: {
      message: {
        content: JSON.stringify({
          intent: "PLAN_GOAL",
          targetReductionPercent: 25,
          maxKwhBudget: null,
          protectedDevices: ["fridge"],
        }),
      },
    },
  });

  const res = await extractIntentWithOllama("Save 25% energy, keep fridge safe", {
    fetchFn: mockFetch,
  });

  assert.equal(res.success, true);
  assert.equal(res.provider, "ollama");
  assert.equal(res.intentData.targetReductionPercent, 25);
  assert.ok(res.intentData.protectedDevices.includes("Refrigerator"));
  console.log("  PASS: Extracted percentage and normalized protected device.\n");
}

// Test 3: Mock kWh budget extraction
{
  console.log("Test 3: Mock Ollama kWh usage budget extraction");
  const mockFetch = createMockFetch({
    responseJson: {
      message: {
        content: JSON.stringify({
          intent: "PLAN_GOAL",
          targetReductionPercent: null,
          maxKwhBudget: 4.8,
          protectedDevices: ["refrigerator"],
        }),
      },
    },
  });

  const res = await extractIntentWithOllama("Keep household usage under 4.8 kWh", {
    fetchFn: mockFetch,
  });

  assert.equal(res.success, true);
  assert.equal(res.intentData.maxKwhBudget, 4.8);
  console.log("  PASS: Extracted kWh budget cap.\n");
}

// Test 4: Mock Ambiguous input handling
{
  console.log("Test 4: Mock Ambiguous goal query");
  const mockFetch = createMockFetch({
    responseJson: {
      message: {
        content: JSON.stringify({
          intent: "CLARIFICATION_NEEDED",
          targetReductionPercent: null,
          maxKwhBudget: null,
          clarificationQuestion: "Would you like a percentage reduction or budget limit?",
        }),
      },
    },
  });

  const res = await extractIntentWithOllama("Help me cut power", {
    fetchFn: mockFetch,
  });

  assert.equal(res.success, true);
  assert.equal(res.intentData.intent, "CLARIFICATION_NEEDED");
  assert.ok(res.intentData.clarificationQuestion.includes("percentage"));
  console.log("  PASS: Model recognized ambiguity and generated clarifying question.\n");
}

// Test 5: Mock Malformed JSON output
{
  console.log("Test 5: Malformed JSON output handling (triggers fallback)");
  const mockFetch = createMockFetch({
    responseJson: {
      message: {
        content: "Here is your plan: { intent: invalid_json...",
      },
    },
  });

  const res = await extractIntentWithOllama("Reduce by 15%", {
    fetchFn: mockFetch,
  });

  assert.equal(res.success, false);
  assert.equal(res.fallback, true);
  assert.ok(res.reason.includes("JSON"));
  console.log("  PASS: Malformed model output safely caught; fallback flagged.\n");
}

// Test 6: Mock Timeout handling
{
  console.log("Test 6: Timeout handling (triggers fallback)");
  const mockFetch = createMockFetch({
    delayMs: 300,
  });

  const res = await extractIntentWithOllama("Reduce by 15%", {
    timeoutMs: 50, // 50ms timeout to trigger abort
    fetchFn: mockFetch,
  });

  assert.equal(res.success, false);
  assert.equal(res.fallback, true);
  console.log("  PASS: Model timeout safely aborted; fallback flagged.\n");
}

// Test 7: Mock Ollama Unavailability (Connection Refused)
{
  console.log("Test 7: Ollama service offline handling (triggers fallback)");
  const mockFetch = createMockFetch({
    shouldThrow: true,
  });

  const res = await extractIntentWithOllama("Reduce by 15%", {
    fetchFn: mockFetch,
  });

  assert.equal(res.success, false);
  assert.equal(res.fallback, true);
  assert.ok(res.reason.includes("ECONNREFUSED"));
  console.log("  PASS: Connection refusal safely caught without crashing process.\n");
}

// Test 8: Safety Invariant (Refrigerator protection rule)
{
  console.log("Test 8: Safety Invariant: Food preservation protection");
  const mockFetch = createMockFetch({
    responseJson: {
      message: {
        content: JSON.stringify({
          intent: "PLAN_GOAL",
          targetReductionPercent: 20,
          protectedDevices: [], // Model omitted fridge
        }),
      },
    },
  });

  const res = await extractIntentWithOllama("Reduce by 20%", {
    fetchFn: mockFetch,
  });

  assert.ok(res.intentData.protectedDevices.includes("Refrigerator"));
  console.log("  PASS: Refrigerator protection automatically enforced by safety invariant.\n");
}

// Test 9: Real Local Ollama Call (if accessible)
console.log("=== Testing Real Local Ollama Service (127.0.0.1:11434) ===");
const availability = await checkOllamaAvailability({ timeoutMs: 1500 });

if (availability.available) {
  console.log("✓ Local Ollama detected! Available models:", availability.models.join(", "));

  const activeModel = await getActiveOllamaModel();
  console.log(`Sending real query to ${activeModel}: 'Reduce electricity by 20%, but keep the fridge safe.'`);
  const realResult = await extractIntentWithOllama(
    "Reduce electricity by 20%, but keep the fridge safe.",
    { model: activeModel, timeoutMs: 35000 }
  );

  if (!realResult.success) {
    console.error("Real Ollama call failed:", realResult.reason);
  }

  assert.equal(realResult.success, true, `Real Ollama call should succeed: ${realResult.reason}`);
  assert.equal(realResult.provider, "ollama");
  assert.equal(realResult.model, activeModel);
  assert.equal(realResult.intentData.targetReductionPercent, 20);
  assert.ok(realResult.intentData.protectedDevices.includes("Refrigerator"));

  console.log("✓ REAL LOCAL OLLAMA INTERACTION VERIFIED SUCCESSFULLY!");
  console.log("Extracted:", JSON.stringify(realResult.intentData, null, 2));
} else {
  console.log("ℹ Local Ollama is offline (" + availability.error + "). Fallback mode verified.");
}

console.log("\n>>> ALL OLLAMA AI TESTS PASSED SUCCESSFULLY! <<<");
