
import assert from "node:assert/strict";

const baseUrl = "http://localhost:3001";

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`);

  assert.equal(
    response.status,
    200,
    `${path} returned HTTP ${response.status}`
  );

  return response.json();
}

async function main() {
  console.log("Running HomePilot API smoke tests...\n");

  const health = await getJson("/api/health");
  assert.equal(health.status, "ok");
  console.log("PASS: API health");

  const energy = await getJson("/api/energy");
  assert.equal(energy.totalKwh, 6.3);
  assert.equal(energy.devices.length, 4);
  console.log("PASS: Energy readings");

  const devices = await getJson("/api/devices");
  assert.equal(devices.devices.length, 4);
  assert.ok(
    devices.devices.some((device) => device.name === "Living Room AC")
  );
  console.log("PASS: Device status");

  const summary = await getJson("/api/summary");
  assert.equal(summary.totalKwh, 6.3);
  assert.equal(summary.highestConsumer.name, "Living Room AC");
  assert.equal(summary.highestConsumer.sharePercent, 50.8);
  assert.equal(summary.dataSource, "simulated");
  console.log("PASS: Energy summary");

  // Integration Test: POST /api/plan normal case with protected refrigerator
  console.log("\nTesting /api/plan integration...");
  const planResponse = await fetch(`${baseUrl}/api/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      targetReductionPercent: 15,
      protectedDevices: ["refrigerator"],
      tariffPerKwh: 0.15,
      currency: "$",
    }),
  });
  assert.equal(planResponse.status, 200, "POST /api/plan returned 200");
  const plan = await planResponse.json();
  assert.equal(plan.status, "achieved");
  assert.equal(plan.targetMet, true);
  assert.ok(plan.savings.estimatedKwhSaved >= 0.945);
  const fridge = plan.proposed.devices.find((d) => d.name === "Refrigerator");
  assert.equal(fridge.proposedKwh, 1.8, "Refrigerator must remain unchanged");
  assert.equal(fridge.isProtected, true, "Refrigerator must be marked protected");
  console.log("PASS: POST /api/plan (15% target, refrigerator protected)");

  // Integration Test: POST /api/plan impossible target (90% reduction)
  const impossibleResponse = await fetch(`${baseUrl}/api/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      targetReductionPercent: 90,
      protectedDevices: ["refrigerator"],
    }),
  });
  assert.equal(impossibleResponse.status, 200);
  const impossiblePlan = await impossibleResponse.json();
  assert.equal(impossiblePlan.status, "partial");
  assert.equal(impossiblePlan.targetMet, false);
  assert.ok(impossiblePlan.explanation.includes("could not be fully met"));
  console.log("PASS: POST /api/plan (impossible 90% target returns partial status)");

  // Integration Test: Validation error on invalid input (negative percentage)
  const invalidResponse = await fetch(`${baseUrl}/api/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      targetReductionPercent: -20,
    }),
  });
  assert.equal(invalidResponse.status, 400, "Invalid target percentage must return HTTP 400");
  const errorJson = await invalidResponse.json();
  assert.ok(errorJson.error.includes("Invalid planning parameters"));
  assert.ok(errorJson.details.length > 0);
  console.log("PASS: POST /api/plan (input validation HTTP 400)");

  // Integration Test: GET /api/plan query params
  const getPlan = await getJson("/api/plan?targetReductionPercent=15&tariffPerKwh=8.0&currency=₹");
  assert.equal(getPlan.status, "achieved");
  assert.equal(getPlan.savings.currency, "₹");
  assert.equal(getPlan.savings.tariffPerKwh, 8.0);
  console.log("PASS: GET /api/plan query string execution");

  // Integration Test: POST /api/chat validation error on missing message
  console.log("\nTesting /api/chat integration...");
  const emptyChatRes = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "   " }),
  });
  assert.equal(emptyChatRes.status, 400, "Empty chat message should return 400");
  console.log("PASS: POST /api/chat validation (empty message HTTP 400)");

  // Integration Test: POST /api/chat planning request with AI/fallback
  const chatGoalRes = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "Reduce electricity by 20%, but keep the fridge safe.",
      tariffPerKwh: 0.15,
      currency: "$",
    }),
  });
  assert.equal(chatGoalRes.status, 200, "POST /api/chat planning request returned 200");
  const chatGoal = await chatGoalRes.json();
  assert.ok(chatGoal.engine.startsWith("ollama:") || chatGoal.engine === "deterministic-fallback");
  assert.equal(chatGoal.intent, "PLAN_GOAL");
  assert.ok(chatGoal.plan);
  assert.equal(chatGoal.plan.status, "achieved");
  assert.ok(chatGoal.plan.protectedDevices.includes("Refrigerator"));
  console.log(`PASS: POST /api/chat goal execution (Engine: ${chatGoal.engine})`);

  // Integration Test: POST /api/chat clarification for ambiguous goal
  const chatClarifyRes = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "Help me cut power",
    }),
  });
  assert.equal(chatClarifyRes.status, 200);
  const chatClarify = await chatClarifyRes.json();
  assert.equal(chatClarify.intent, "CLARIFICATION_NEEDED");
  assert.ok(chatClarify.text.length > 10);
  console.log("PASS: POST /api/chat ambiguity clarification");

  console.log("\nAll HomePilot API smoke tests passed!");
}

main().catch((error) => {
  console.error("\nTEST FAILURE:", error.message);
  process.exitCode = 1;
});
