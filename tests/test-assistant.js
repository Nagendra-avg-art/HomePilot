import assert from "node:assert/strict";
import {
  parseAssistantIntent,
  explainPlanDecision,
  formatGroundedPlanResponse,
} from "../client/src/assistant.js";

console.log("=== Running Goal-Driven Assistant Unit Tests ===\n");

// Test 1: Percentage reduction with protected device
{
  console.log("Test 1: Parsing percentage goal with protected device");
  const parsed = parseAssistantIntent("Reduce my electricity usage by 20%, but keep the fridge safe.");
  assert.equal(parsed.type, "PLAN_GOAL");
  assert.equal(parsed.targetReductionPercent, 20);
  assert.ok(parsed.protectedDevices.includes("Refrigerator"));
  console.log("  PASS: Extracted 20% target and Refrigerator protection.\n");
}

// Test 2: kWh usage budget
{
  console.log("Test 2: Parsing kWh usage budget (below 5 kWh)");
  const parsed = parseAssistantIntent("Keep household usage below 5 kWh.");
  assert.equal(parsed.type, "PLAN_GOAL");
  assert.equal(parsed.maxKwhBudget, 5.0);
  assert.ok(parsed.protectedDevices.includes("Refrigerator"));
  console.log("  PASS: Extracted 5.0 kWh budget cap.\n");
}

// Test 3: Cheapest feasible plan request
{
  console.log("Test 3: Parsing 'What is the cheapest feasible plan?'");
  const parsed = parseAssistantIntent("What is the cheapest feasible plan?");
  assert.equal(parsed.type, "PLAN_GOAL");
  assert.equal(parsed.isCheapestRequest, true);
  console.log("  PASS: Recognized cheapest plan intent.\n");
}

// Test 4: Ambiguous input returns clarifying question
{
  console.log("Test 4: Ambiguous input handling (missing target numbers)");
  const parsed = parseAssistantIntent("I want to save power and reduce energy.");
  assert.equal(parsed.type, "CLARIFICATION_NEEDED");
  assert.ok(parsed.message.includes("Would you like to target a percentage reduction"));
  console.log("  PASS: Prompted user with clarifying question instead of inventing targets.\n");
}

// Test 5: Explainability queries
{
  console.log("Test 5: Explainability queries parsing");
  const parsedTarget = parseAssistantIntent("Why couldn't you achieve my 85% reduction target?");
  assert.equal(parsedTarget.type, "EXPLAIN_WHY");
  assert.equal(parsedTarget.asksAboutTarget, true);

  const parsedDevice = parseAssistantIntent("Why did you pick the AC for reduction?");
  assert.equal(parsedDevice.type, "EXPLAIN_WHY");
  assert.equal(parsedDevice.targetDevice, "Living Room AC");
  console.log("  PASS: Recognized explainability questions for target gap and device actions.\n");
}

// Test 6: Explainability grounding logic with mock plan
{
  console.log("Test 6: Grounded explanation generation");
  const mockPlan = {
    status: "partial",
    targetMet: false,
    target: { requestedTargetLabel: "Target Requested: Reduce by 85%" },
    baseline: { totalKwh: 6.3, estimatedCost: 0.95 },
    proposed: { totalKwh: 4.14, estimatedCost: 0.62 },
    savings: { estimatedKwhSaved: 2.16, estimatedPercentSaved: 34.3, estimatedCostSaved: 0.32, currency: "$" },
    protectedDevices: ["Refrigerator"],
    actionsApplied: [
      {
        id: "ac_peak_curtail",
        deviceName: "Living Room AC",
        name: "Peak-Hour Fan Curtailment",
        kwhSaved: 1.6,
        percentReduction: 50,
        tradeOff: "Noticeable cooling reduction during warmest hours.",
        assumption: "Cycling off compressor saves 50% AC daily energy.",
      },
    ],
    decisionLog: [
      { type: "protected", message: "Refrigerator is marked as protected." },
      { type: "target_gap", message: "Target could not be fully met." },
    ],
    dataSource: "simulated_baseline_and_estimated_model",
  };

  const targetExplanation = explainPlanDecision("Why couldn't you achieve 85%?", mockPlan);
  assert.ok(targetExplanation.includes("Safety Invariants"));
  assert.ok(targetExplanation.includes("Refrigerator"));
  assert.ok(targetExplanation.includes("Physical Limits"));

  const deviceExplanation = explainPlanDecision("Why did you adjust the AC?", mockPlan);
  assert.ok(deviceExplanation.includes("Living Room AC"));
  assert.ok(deviceExplanation.includes("Noticeable cooling reduction"));
  assert.ok(deviceExplanation.includes("Cycling off compressor"));

  console.log("  PASS: Generated grounded explanations using planner assumptions and safety rules.\n");
}

// Test 7: Grounded plan response formatter
{
  console.log("Test 7: Grounded plan response formatter");
  const mockPlan = {
    status: "achieved",
    explanation: "Target requested: 15%. Planned reduction: 1.36 kWh (21.6%).",
    baseline: { totalKwh: 6.3, estimatedCost: 0.95 },
    proposed: { totalKwh: 4.94, estimatedCost: 0.74 },
    savings: { estimatedKwhSaved: 1.36, estimatedPercentSaved: 21.6, estimatedCostSaved: 0.20, tariffPerKwh: 0.15, currency: "$" },
    actionsApplied: [
      {
        id: "lights_dim_zone",
        deviceName: "Living Room Lights",
        name: "Dimming & Zone Shutoff",
        kwhSaved: 0.2,
        tradeOff: "Reduced brightness.",
        assumption: "Dimming fixtures saves 50%.",
      },
    ],
    protectedDevices: ["Refrigerator"],
    dataSource: "simulated_baseline_and_estimated_model",
  };

  const formatted = formatGroundedPlanResponse(mockPlan);
  assert.ok(formatted.includes("Baseline Usage: 6.3 kWh"));
  assert.ok(formatted.includes("Proposed Usage: 4.94 kWh"));
  assert.ok(formatted.includes("Estimated Savings: 1.36 kWh"));
  assert.ok(formatted.includes("Dimming & Zone Shutoff"));
  assert.ok(formatted.includes("Protected Devices: Refrigerator"));
  assert.ok(formatted.includes("Transparency Notice"));
  console.log("  PASS: Formatted response is fully grounded with simulated data disclaimers.\n");
}

// Test 8: Unsupported query boundary
{
  console.log("Test 8: Unsupported question boundary handling");
  const parsed = parseAssistantIntent("What is the weather in Seattle?");
  assert.equal(parsed.type, "UNSUPPORTED");
  assert.ok(parsed.message.includes("focused specifically on household energy operations"));
  console.log("  PASS: Handled out-of-scope query honestly without pretending to know.\n");
}

console.log(">>> ALL ASSISTANT TESTS PASSED SUCCESSFULLY! <<<\n");
