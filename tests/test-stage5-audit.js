/**
 * HomePilot Stage 5 — End-to-End Release Audit Verification Script
 * 
 * Verifies all required Stage 5 scenarios:
 * 1. 20% reduction with protected refrigerator
 * 2. Ambiguity handling (no invented preferences)
 * 3. Explainability grounded in actual plan & assumptions
 * 4. Ollama timeout/offline resilience with deterministic fallback
 * 5. Invalid input rejection and impossible target honesty
 * 6. Refrigerator protection preservation across all boundaries
 * 7. Arithmetic consistency of savings, proposed usage, and tariffs
 */

import assert from "node:assert/strict";
import { extractIntentWithOllama } from "../src/ollama.js";
import { calculateEnergyPlan } from "../src/planner.js";
import { explainPlanDecision, formatGroundedPlanResponse } from "../client/src/assistant.js";

const API_BASE = "http://localhost:3001/api";

console.log("============================================================");
console.log("       HOMEPILOT - STAGE 5 RELEASE AUDIT VERIFICATION       ");
console.log("============================================================\n");

async function runScenarioA() {
  console.log("--- Scenario A: 20% Reduction with Protected Refrigerator ---");
  const res = await fetch(`${API_BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "Reduce electricity use by 20% while protecting the refrigerator",
      tariffPerKwh: 0.15,
      currency: "$",
    }),
  });

  assert.equal(res.status, 200, "Scenario A must return HTTP 200");
  const data = await res.json();

  console.log(`  Engine used: ${data.engine}`);
  assert.ok(
    data.engine === "ollama:qwen3:4b" || data.engine === "deterministic-fallback",
    "Engine must be explicitly identified"
  );
  assert.equal(data.intent, "PLAN_GOAL");
  assert.ok(data.plan, "Plan object must be present");
  assert.equal(data.plan.status, "achieved");
  assert.equal(data.plan.targetMet, true);

  // Check Refrigerator preservation
  const fridge = data.plan.proposed.devices.find((d) => d.name === "Refrigerator");
  assert.ok(fridge, "Refrigerator must exist in device list");
  assert.equal(fridge.baselineKwh, 1.8);
  assert.equal(fridge.proposedKwh, 1.8);
  assert.equal(fridge.kwhSaved, 0);
  assert.equal(fridge.isProtected, true);

  // Check arithmetic consistency
  assert.equal(data.plan.baseline.totalKwh, 6.3);
  assert.equal(
    Number((data.plan.baseline.totalKwh - data.plan.savings.estimatedKwhSaved).toFixed(2)),
    data.plan.proposed.totalKwh,
    "Baseline - Savings must equal Proposed usage"
  );

  console.log("  PASS: 20% reduction achieved, Refrigerator safe, arithmetically consistent.\n");
  return data;
}

async function runScenarioB() {
  console.log("--- Scenario B: Ambiguity Handling (No Invented Preferences) ---");
  const res = await fetch(`${API_BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "Help me save electricity",
    }),
  });

  assert.equal(res.status, 200, "Scenario B must return HTTP 200");
  const data = await res.json();

  console.log(`  Engine: ${data.engine}`);
  console.log(`  Intent: ${data.intent}`);
  console.log(`  Clarification: "${data.text}"`);

  assert.equal(data.intent, "CLARIFICATION_NEEDED");
  assert.equal(data.plan, null, "Ambiguous query must NOT invent an unconfirmed plan");
  assert.ok(
    data.text.toLowerCase().includes("percentage") ||
    data.text.toLowerCase().includes("budget") ||
    data.text.toLowerCase().includes("how much") ||
    data.text.toLowerCase().includes("target"),
    "Clarification must ask for a specific target"
  );

  console.log("  PASS: Ambiguous query cleanly asks clarifying question without hallucinating goals.\n");
}

async function runScenarioC(scenarioAPlan) {
  console.log("--- Scenario C: Grounded Explainability Query ---");
  const res = await fetch(`${API_BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "Why was Thermostat Eco Setpoint selected?",
      currentPlan: scenarioAPlan.plan,
    }),
  });

  assert.equal(res.status, 200, "Scenario C must return HTTP 200");
  const data = await res.json();

  console.log(`  Explanation: "${data.text}"`);
  assert.ok(
    data.text.includes("Thermostat Eco Setpoint") || data.text.includes("Living Room AC"),
    "Explanation must reference the inquired action or appliance"
  );
  assert.ok(
    data.text.includes("kWh") || data.text.includes("compressor"),
    "Explanation must cite physical assumptions or trade-offs"
  );

  // Also test impossible target explainability
  const impossibleExplain = explainPlanDecision(
    "Why couldn't you achieve an 85% reduction target?",
    {
      status: "partial",
      targetMet: false,
      target: { requestedPercent: 85 },
      baseline: { totalKwh: 6.3 },
      savings: { estimatedKwhSaved: 1.36, estimatedPercentSaved: 21.6 },
      actionsApplied: [{ name: "Thermostat Eco Setpoint", kwhSaved: 0.8 }],
      protectedDevices: ["Refrigerator"],
      assumptions: ["All available non-protected actions applied"],
    }
  );

  console.log(`  Impossible Target Explanation:\n  ${impossibleExplain.replace(/\n/g, "\n  ")}`);
  assert.ok(impossibleExplain.includes("85%"), "Explanation must cite requested target");
  assert.ok(impossibleExplain.includes("21.6%"), "Explanation must cite actual planned reduction");
  assert.ok(impossibleExplain.includes("Refrigerator"), "Explanation must cite protected devices");

  console.log("  PASS: Explainability responses are grounded in actual plan facts, assumptions, and constraints.\n");
}

async function runScenarioD() {
  console.log("--- Scenario D: Ollama Offline/Timeout Resilience with Deterministic Fallback ---");
  
  // Test fallback extraction directly with mock unreachable Ollama URL
  const fallbackResult = await extractIntentWithOllama("Reduce my power by 15%", {
    baseUrl: "http://127.0.0.1:9999", // Intentional offline port
    timeoutMs: 500,
  });

  assert.equal(fallbackResult.success, false);
  assert.equal(fallbackResult.fallback, true);
  assert.equal(fallbackResult.provider, "fallback");

  // Test API endpoint behavior when deterministic fallback is used
  // (Sending a query that exercises the fallback path or verifies server graceful handling)
  const res = await fetch(`${API_BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "Reduce electricity by 15%",
      tariffPerKwh: 0.15,
      currency: "$",
    }),
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(
    data.engine === "ollama:qwen3:4b" || data.engine === "deterministic-fallback",
    "Engine tag must be either real Ollama or deterministic fallback"
  );
  assert.notEqual(data.engine, "openai", "No external paid AI may ever be labeled");
  assert.notEqual(data.engine, "anthropic", "No external paid AI may ever be labeled");

  console.log(`  Engine verified: ${data.engine}`);
  console.log("  PASS: Offline/timeout conditions degrade gracefully to deterministic parser with accurate badging.\n");
}

async function runScenarioE() {
  console.log("--- Scenario E: Safe Handling of Invalid Inputs and Impossible Targets ---");

  // 1. Invalid input: Empty message
  const emptyRes = await fetch(`${API_BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "   " }),
  });
  assert.equal(emptyRes.status, 400, "Empty message must return HTTP 400");
  const emptyJson = await emptyRes.json();
  assert.ok(emptyJson.error.includes("message"), "Error message must cite required field");
  console.log("  PASS: Empty message rejected with HTTP 400.");

  // 2. Invalid input: Negative target reduction percent
  const invalidPlanRes = await fetch(`${API_BASE}/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetReductionPercent: -25 }),
  });
  assert.equal(invalidPlanRes.status, 400, "Negative target percentage must return HTTP 400");
  console.log("  PASS: Negative reduction percentage rejected with HTTP 400.");

  // 3. Impossible target: 90% reduction with Refrigerator protected
  const impossibleRes = await fetch(`${API_BASE}/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      targetReductionPercent: 90,
      protectedDevices: ["Refrigerator"],
    }),
  });
  assert.equal(impossibleRes.status, 200, "Impossible target must compute feasible ceiling without crashing");
  const impossibleData = await impossibleRes.json();
  assert.equal(impossibleData.status, "partial");
  assert.equal(impossibleData.targetMet, false);
  assert.ok(impossibleData.explanation.includes("could not be fully met"));
  assert.ok(impossibleData.savings.estimatedPercentSaved < 90);
  console.log(`  Feasible ceiling achieved: ${impossibleData.savings.estimatedPercentSaved}% (requested 90%)`);
  console.log("  PASS: Impossible targets return honest 'partial' status and explanation.\n");
}

async function runScenarioF() {
  console.log("--- Scenario F: Refrigerator Protection Preserved Across All Boundaries ---");

  // Test across AI, API, and Planner boundaries
  // 1. Ollama safety invariant (even if user query does not explicitly mention fridge)
  const aiExtraction = await extractIntentWithOllama("Reduce my bill by 10%");
  if (aiExtraction.success) {
    assert.ok(
      aiExtraction.intentData.protectedDevices.includes("Refrigerator"),
      "Safety invariant: Refrigerator must be protected in AI output"
    );
    console.log("  ✓ Boundary 1 (AI Intent): Refrigerator included in protectedDevices");
  }

  // 2. API Gateway & MCP Planner Boundary
  const res = await fetch(`${API_BASE}/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      targetReductionPercent: 50,
      protectedDevices: ["refrigerator"],
    }),
  });
  assert.equal(res.status, 200);
  const plan = await res.json();

  const fridgeDevice = plan.proposed.devices.find((d) => d.name === "Refrigerator");
  assert.equal(fridgeDevice.baselineKwh, 1.8);
  assert.equal(fridgeDevice.proposedKwh, 1.8, "Refrigerator proposed kWh must remain untouched");
  assert.equal(fridgeDevice.kwhSaved, 0, "Refrigerator must have 0 saved kWh");
  assert.equal(fridgeDevice.isProtected, true, "Refrigerator must be marked isProtected: true");

  // Verify Planner decision log
  const protectionLogEntry = plan.decisionLog.find(
    (e) => e.type === "protected" && e.deviceName === "Refrigerator"
  );
  assert.ok(protectionLogEntry, "Decision log must document Refrigerator protection exclusion");
  console.log(`  ✓ Boundary 2 (MCP Planner Audit): "${protectionLogEntry.message}"`);

  console.log("  PASS: Refrigerator protection strictly maintained end-to-end.\n");
}

function runScenarioG() {
  console.log("--- Scenario G: Mathematical & Arithmetic Consistency Audit ---");

  const simulatedHousehold = {
    devices: [
      { name: "Living Room AC", kwh: 3.2, status: "running" },
      { name: "Refrigerator", kwh: 1.8, status: "running" },
      { name: "Washing Machine", kwh: 0.9, status: "idle" },
      { name: "Living Room Lights", kwh: 0.4, status: "on" },
    ],
  };

  const testCases = [
    { targetPercent: 10, tariff: 0.15, currency: "$" },
    { targetPercent: 25, tariff: 8.50, currency: "₹" },
    { targetPercent: 50, tariff: 0.22, currency: "€" },
    { budgetKwh: 4.8, tariff: 0.15, currency: "$" },
  ];

  for (const tc of testCases) {
    const plan = calculateEnergyPlan({
      household: simulatedHousehold,
      targetReductionPercent: tc.targetPercent,
      maxKwhBudget: tc.budgetKwh,
      protectedDevices: ["Refrigerator"],
      tariffPerKwh: tc.tariff,
      currency: tc.currency,
    });

    // Invariant 1: Sum of baseline device kWh == baseline.totalKwh
    const sumDeviceBaseline = Number(
      plan.baseline.devices.reduce((acc, d) => acc + d.baselineKwh, 0).toFixed(2)
    );
    assert.equal(sumDeviceBaseline, plan.baseline.totalKwh, "Sum of baseline devices == baseline total");

    // Invariant 2: Sum of proposed device kWh == proposed.totalKwh
    const sumDeviceProposed = Number(
      plan.proposed.devices.reduce((acc, d) => acc + d.proposedKwh, 0).toFixed(2)
    );
    assert.equal(sumDeviceProposed, plan.proposed.totalKwh, "Sum of proposed devices == proposed total");

    // Invariant 3: baseline.totalKwh - savings.estimatedKwhSaved == proposed.totalKwh
    const expectedProposed = Number((plan.baseline.totalKwh - plan.savings.estimatedKwhSaved).toFixed(2));
    assert.equal(expectedProposed, plan.proposed.totalKwh, "Baseline - Saved == Proposed");

    // Invariant 4: Cost calculation matches tariff
    const expectedCostSavings = Number((plan.savings.estimatedKwhSaved * tc.tariff).toFixed(2));
    assert.equal(plan.savings.estimatedCostSaved, expectedCostSavings, "Cost savings == Saved kWh * tariff");

    // Invariant 5: Refrigerator never reduced
    const fridge = plan.proposed.devices.find((d) => d.name === "Refrigerator");
    assert.equal(fridge.proposedKwh, fridge.baselineKwh, "Fridge never curtailed");
  }

  console.log("  PASS: 100% mathematical consistency verified across all test scenarios.\n");
}

async function main() {
  const planData = await runScenarioA();
  await runScenarioB();
  await runScenarioC(planData);
  await runScenarioD();
  await runScenarioE();
  await runScenarioF();
  runScenarioG();

  console.log("============================================================");
  console.log("   ALL STAGE 5 RELEASE AUDIT CHECKS PASSED SUCCESSFULLY!    ");
  console.log("============================================================\n");
}

main().catch((err) => {
  console.error("\nSTAGE 5 AUDIT FAILED:", err);
  process.exitCode = 1;
});
