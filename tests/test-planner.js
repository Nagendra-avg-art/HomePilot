import assert from "node:assert/strict";
import { calculateEnergyPlan } from "../src/planner.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const simulatedHousehold = {
  date: "2026-10-13",
  devices: [
    { name: "Living Room AC", kwh: 3.2, status: "running" },
    { name: "Refrigerator", kwh: 1.8, status: "running" },
    { name: "Washing Machine", kwh: 0.9, status: "idle" },
    { name: "Living Room Lights", kwh: 0.4, status: "on" },
  ],
};

function runUnitTests() {
  console.log("=== Running Energy Planner Unit Tests ===\n");

  // Test 1: Normal 15% reduction goal with Refrigerator protected
  {
    console.log("Test 1: 15% reduction goal with Refrigerator protected");
    const plan = calculateEnergyPlan({
      household: simulatedHousehold,
      targetReductionPercent: 15,
      protectedDevices: ["refrigerator"],
      tariffPerKwh: 0.15,
      currency: "$",
    });

    assert.equal(plan.baseline.totalKwh, 6.3);
    assert.equal(plan.status, "achieved");
    assert.equal(plan.targetMet, true);
    assert.ok(plan.savings.estimatedKwhSaved >= 0.945, "Should save at least 15% (0.945 kWh)");

    // Ensure refrigerator is strictly untouched
    const fridge = plan.proposed.devices.find((d) => d.name === "Refrigerator");
    assert.ok(fridge, "Refrigerator must exist in proposed devices");
    assert.equal(fridge.proposedKwh, 1.8, "Refrigerator proposed kWh must equal baseline");
    assert.equal(fridge.kwhSaved, 0, "Refrigerator kwhSaved must be 0");
    assert.equal(fridge.isProtected, true, "Refrigerator must be marked protected");
    assert.ok(plan.protectedDevices.includes("Refrigerator"));

    // Ensure assumptions are explicit and documented
    assert.ok(plan.assumptions.length > 0, "Plan must contain documented assumptions");
    assert.ok(plan.actionsApplied.length > 0, "Plan must list applied actions");
    console.log("  PASS: Plan achieved", plan.savings.estimatedKwhSaved, "kWh saved without touching Refrigerator.\n");
  }

  // Test 2: Protected devices invariant (multiple protections)
  {
    console.log("Test 2: Multiple protected devices (AC & Refrigerator)");
    const plan = calculateEnergyPlan({
      household: simulatedHousehold,
      targetReductionPercent: 20,
      protectedDevices: ["refrigerator", "Living Room AC"],
      tariffPerKwh: 0.15,
    });

    const ac = plan.proposed.devices.find((d) => d.name === "Living Room AC");
    const fridge = plan.proposed.devices.find((d) => d.name === "Refrigerator");
    assert.equal(ac.proposedKwh, 3.2, "AC must be protected and unchanged");
    assert.equal(fridge.proposedKwh, 1.8, "Fridge must be protected and unchanged");
    assert.equal(ac.isProtected, true);
    assert.equal(fridge.isProtected, true);
    console.log("  PASS: Multiple protected devices strictly preserved.\n");
  }

  // Test 3: Unachievable / impossible target handling
  {
    console.log("Test 3: Impossible target (85% reduction) with Refrigerator protected");
    const plan = calculateEnergyPlan({
      household: simulatedHousehold,
      targetReductionPercent: 85,
      protectedDevices: ["refrigerator"],
    });

    assert.equal(plan.status, "partial");
    assert.equal(plan.targetMet, false);
    assert.ok(
      plan.explanation.includes("could not be fully met"),
      "Explanation must be transparent and honest"
    );
    assert.ok(plan.savings.estimatedKwhSaved > 0, "Should still achieve maximum feasible savings");
    assert.ok(plan.savings.estimatedKwhSaved < plan.target.targetKwhNeeded);
    console.log("  PASS: Impossible target handled gracefully with honest explanation.\n");
  }

  // Test 4: Budget-based target (max 5.0 kWh)
  {
    console.log("Test 4: kWh budget target (cap usage at 5.0 kWh)");
    const plan = calculateEnergyPlan({
      household: simulatedHousehold,
      maxKwhBudget: 5.0,
      protectedDevices: ["refrigerator"],
    });

    assert.equal(plan.target.type, "budget");
    assert.ok(plan.proposed.totalKwh <= 5.0, "Proposed total should be <= 5.0 kWh");
    assert.equal(plan.targetMet, true);
    console.log("  PASS: Budget constraint met. Proposed:", plan.proposed.totalKwh, "kWh.\n");
  }

  // Test 5: Custom electricity tariff calculation (e.g. India ₹8.50/kWh)
  {
    console.log("Test 5: Custom electricity tariff (₹8.50/kWh)");
    const plan = calculateEnergyPlan({
      household: simulatedHousehold,
      targetReductionPercent: 15,
      protectedDevices: ["refrigerator"],
      tariffPerKwh: 8.5,
      currency: "₹",
    });

    const expectedCostSavings = Number((plan.savings.estimatedKwhSaved * 8.5).toFixed(2));
    assert.equal(plan.savings.estimatedCostSaved, expectedCostSavings);
    assert.equal(plan.savings.currency, "₹");
    assert.equal(plan.savings.tariffPerKwh, 8.5);
    console.log("  PASS: Tariff correctly calculated: saved ₹" + plan.savings.estimatedCostSaved + "\n");
  }

  // Test 6: Zero / negative / non-actionable targets
  {
    console.log("Test 6: Non-actionable target (0% reduction or huge budget)");
    const plan = calculateEnergyPlan({
      household: simulatedHousehold,
      targetReductionPercent: 0,
      maxKwhBudget: 10.0,
      protectedDevices: ["refrigerator"],
    });

    assert.equal(plan.status, "no_action_needed");
    assert.equal(plan.savings.estimatedKwhSaved, 0);
    assert.equal(plan.actionsApplied.length, 0);
    console.log("  PASS: Handled zero target without unnecessary actions.\n");
  }
}

async function runMcpToolTest() {
  console.log("=== Testing MCP Tool via Streamable HTTP (Port 3000) ===\n");
  const client = new Client({
    name: "planner-test-client",
    version: "1.0.0",
  });

  const transport = new StreamableHTTPClientTransport(
    new URL("http://localhost:3000/mcp")
  );

  try {
    await client.connect(transport);
    console.log("Negotiated protocol version:", transport.protocolVersion);
    assert.ok(
      transport.protocolVersion.includes("2025-11-25"),
      `Expected protocol 2025-11-25, got ${transport.protocolVersion}`
    );

    const { tools } = await client.listTools();
    const plannerTool = tools.find((t) => t.name === "plan_energy_reduction");
    assert.ok(plannerTool, "Tool 'plan_energy_reduction' must be present in tools list");
    console.log("PASS: Found 'plan_energy_reduction' in registered MCP tools.");

    // Call plan_energy_reduction tool
    const result = await client.callTool({
      name: "plan_energy_reduction",
      arguments: {
        targetReductionPercent: 15,
        protectedDevices: ["refrigerator"],
        tariffPerKwh: 0.18,
        currency: "$",
      },
    });

    assert.equal(Boolean(result.isError), false, "MCP tool call should not error");
    const textContent = result.content.find((item) => item.type === "text");
    assert.ok(textContent, "Tool result must contain text content");

    const plan = JSON.parse(textContent.text);
    assert.equal(plan.status, "achieved");
    assert.equal(plan.targetMet, true);
    assert.equal(plan.protectedDevices.includes("Refrigerator"), true);
    assert.ok(plan.savings.estimatedKwhSaved >= 0.945);

    console.log("PASS: MCP tool 'plan_energy_reduction' executed successfully over Streamable HTTP!");
    console.log("Summary:", plan.explanation);
    console.log("Actions applied:", plan.actionsApplied.map((a) => a.name).join(", "));
  } finally {
    await client.close().catch(() => {});
  }
}

async function main() {
  runUnitTests();
  await runMcpToolTest();
  console.log("\n>>> ALL STAGE 1 TESTS PASSED SUCCESSFULLY! <<<");
}

main().catch((err) => {
  console.error("\nTEST FAILED:", err);
  process.exit(1);
});
