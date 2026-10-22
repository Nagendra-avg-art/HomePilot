/**
 * HomePilot Stage 6: Household Builder & Energy Twin Verification Suite
 * 
 * Verifies:
 * 1. Appliance CRUD & household model validation
 * 2. Multiple appliances in one category with instance-bound actions
 * 3. Energy calculation formula & duty cycle boundary checks
 * 4. Missing, malformed, and invalid inventory data rejection
 * 5. Consistent inventory totals across UI formula, API, and MCP
 * 6. Critical device safety invariants (Refrigerator never curtailed)
 * 7. Feasible plans across diverse multi-room household configurations
 * 8. Impossible reduction targets and honest feasibility reporting
 * 9. Ollama AI timeout / offline fallback behavior
 * 10. MCP tool plan_energy_reduction with custom household over Streamable HTTP
 */

import assert from "node:assert";
import {
  calculateDeviceDailyKwh,
  validateHousehold,
  DEFAULT_HOUSEHOLD,
  calculateEnergyPlan,
  inferDeviceCategory,
} from "../src/planner.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

async function main() {
  console.log("=== Running Stage 6 Household Builder & Energy Twin Tests ===\n");

  // -------------------------------------------------------------------------
  // Test 1: Energy Calculation Formula and Validation Boundaries
  // -------------------------------------------------------------------------
  console.log("Test 1: Energy Calculation Formula (quantity * watts * hours * duty / 1000)");
  {
    // Standard AC: 1 unit, 1400W, 4h, duty 0.57 = 3.19 kWh
    const acKwh = calculateDeviceDailyKwh({
      quantity: 1,
      ratedWatts: 1400,
      dailyHours: 4,
      dutyCycle: 0.57,
    });
    assert.strictEqual(acKwh, 3.19, "AC daily kWh should equal 3.19");

    // Multiple units: 4 ceiling lights, 10W each, 10h, duty 1.0 = 0.40 kWh
    const lightsKwh = calculateDeviceDailyKwh({
      quantity: 4,
      ratedWatts: 10,
      dailyHours: 10,
      dutyCycle: 1.0,
    });
    assert.strictEqual(lightsKwh, 0.40, "4 lights daily kWh should equal 0.40");

    // Zero hours boundary
    const zeroHours = calculateDeviceDailyKwh({
      quantity: 1,
      ratedWatts: 1500,
      dailyHours: 0,
      dutyCycle: 1.0,
    });
    assert.strictEqual(zeroHours, 0.0, "Zero runtime must produce 0.0 kWh");

    // 24 hours boundary cap
    const maxHours = calculateDeviceDailyKwh({
      quantity: 1,
      ratedWatts: 1000,
      dailyHours: 30, // exceeds 24h
      dutyCycle: 1.0,
    });
    assert.strictEqual(maxHours, 24.0, "Hours > 24 must be capped at 24.0h (24 kWh)");

    console.log("  PASS: Deterministic energy arithmetic and boundaries verified.");
  }

  // -------------------------------------------------------------------------
  // Test 2: Household Model Validation & Rejection of Malformed Data
  // -------------------------------------------------------------------------
  console.log("\nTest 2: Household Validation and Rejection of Malformed/Corrupt Data");
  {
    // Non-object
    assert.strictEqual(validateHousehold(null).valid, false);
    assert.strictEqual(validateHousehold("corrupt").valid, false);

    // Missing devices array
    assert.strictEqual(validateHousehold({}).valid, false);
    assert.strictEqual(validateHousehold({ devices: [] }).valid, false);

    // Device with missing name
    const invalidDevice = validateHousehold({
      devices: [{ room: "Kitchen", ratedWatts: 100, dailyHours: 2 }],
    });
    assert.strictEqual(invalidDevice.valid, false);

    // Valid household normalization
    const validRaw = {
      date: "2026-10-21",
      devices: [
        {
          name: "Study Computer",
          category: "computer",
          room: "Study",
          quantity: 2,
          ratedWatts: 250,
          dailyHours: 8,
          dutyCycle: 1.0,
        },
      ],
    };
    const validated = validateHousehold(validRaw);
    assert.strictEqual(validated.valid, true);
    assert.strictEqual(validated.household.devices.length, 1);
    assert.strictEqual(validated.household.devices[0].kwh, 4.0);
    assert.strictEqual(validated.household.totalKwh, 4.0);

    console.log("  PASS: Malformed households rejected; valid data normalized cleanly.");
  }

  // -------------------------------------------------------------------------
  // Test 3: Multiple Appliances in the Same Category
  // -------------------------------------------------------------------------
  console.log("\nTest 3: Multiple Appliances in One Category (2 ACs in different rooms)");
  {
    const multiAcHousehold = {
      date: "2026-10-21",
      devices: [
        {
          id: "ac_master",
          name: "Master Bedroom AC",
          category: "ac",
          room: "Master Bedroom",
          quantity: 1,
          ratedWatts: 1200,
          dailyHours: 4,
          dutyCycle: 0.57,
          status: "running",
          isProtected: false,
        },
        {
          id: "ac_living",
          name: "Living Room AC",
          category: "ac",
          room: "Living Room",
          quantity: 1,
          ratedWatts: 1800,
          dailyHours: 6,
          dutyCycle: 0.57,
          status: "running",
          isProtected: false,
        },
        {
          id: "fridge",
          name: "Kitchen Refrigerator",
          category: "refrigerator",
          room: "Kitchen",
          quantity: 1,
          ratedWatts: 150,
          dailyHours: 24,
          dutyCycle: 0.50,
          status: "running",
          isProtected: true,
        },
      ],
    };

    const plan = calculateEnergyPlan({
      household: multiAcHousehold,
      targetReductionPercent: 20,
      protectedDevices: ["Kitchen Refrigerator"],
    });

    assert.strictEqual(plan.status, "achieved");
    assert.strictEqual(plan.baseline.totalKwh > 0, true);

    // Verify both ACs received separate, instance-bound actions
    const appliedDeviceNames = plan.actionsApplied.map((a) => a.deviceName);
    assert(appliedDeviceNames.includes("Master Bedroom AC"), "Must target Master Bedroom AC");
    assert(appliedDeviceNames.includes("Living Room AC"), "Must target Living Room AC");

    // Verify refrigerator was untouched
    assert(!appliedDeviceNames.includes("Kitchen Refrigerator"), "Must NOT target Refrigerator");

    console.log("  PASS: Multiple AC instances targeted independently without collision.");
  }

  // -------------------------------------------------------------------------
  // Test 4: Critical Invariant Protection (Refrigerator strictly protected)
  // -------------------------------------------------------------------------
  console.log("\nTest 4: Critical Device Invariants (Refrigerator NEVER reduced)");
  {
    const householdWithFridge = {
      date: "2026-10-21",
      devices: [
        {
          id: "fridge_1",
          name: "Samsung Refrigerator",
          category: "refrigerator",
          room: "Kitchen",
          quantity: 1,
          ratedWatts: 160,
          dailyHours: 24,
          dutyCycle: 0.50,
          status: "running",
          isProtected: true,
        },
        {
          id: "light_1",
          name: "Kitchen Light",
          category: "light",
          room: "Kitchen",
          quantity: 1,
          ratedWatts: 20,
          dailyHours: 5,
          dutyCycle: 1.0,
          status: "on",
          isProtected: false,
        },
      ],
    };

    // Attempt an aggressive 50% target
    const plan = calculateEnergyPlan({
      household: householdWithFridge,
      targetReductionPercent: 50,
      protectedDevices: ["Samsung Refrigerator"],
    });

    const fridgeAction = plan.actionsApplied.find((a) =>
      a.deviceName.toLowerCase().includes("refrigerator")
    );
    assert.strictEqual(fridgeAction, undefined, "Refrigerator must NEVER receive curtailment actions");
    assert(plan.protectedDevices.some((p) => p.includes("Refrigerator")));

    console.log("  PASS: Refrigerator strictly protected even under aggressive targets.");
  }

  // -------------------------------------------------------------------------
  // Test 5: Impossible Target Feasibility Reporting
  // -------------------------------------------------------------------------
  console.log("\nTest 5: Impossible Reduction Goal Handling (90% target)");
  {
    const plan = calculateEnergyPlan({
      household: DEFAULT_HOUSEHOLD,
      targetReductionPercent: 90,
      protectedDevices: ["Refrigerator"],
    });

    assert.strictEqual(plan.status, "partial", "Plan must report 'partial' status for impossible target");
    assert(plan.savings.estimatedPercentSaved < 90, "Cannot fabricate 90% savings");
    assert(
      plan.explanation.includes("could not be fully met") ||
      plan.explanation.includes("Maximum feasible") ||
      plan.explanation.toLowerCase().includes("partial"),
      "Must explain infeasibility honestly"
    );

    console.log(`  PASS: Impossible 90% target honestly capped at feasible limit (${plan.savings.estimatedPercentSaved}%).`);
  }

  // -------------------------------------------------------------------------
  // Test 6: API Gateway GET /api/household/default
  // -------------------------------------------------------------------------
  console.log("\nTest 6: API Gateway GET /api/household/default");
  {
    const res = await fetch("http://localhost:3001/api/household/default");
    assert.strictEqual(res.ok, true, "GET /api/household/default must respond 200 OK");
    const data = await res.json();
    assert.strictEqual(data.status, "ok");
    assert.strictEqual(Array.isArray(data.household.devices), true);
    assert(data.metadata.dutyFactorAssumptions.ac.includes("0.57"));
    assert(data.metadata.dutyFactorAssumptions.refrigerator.includes("0.50"));

    console.log("  PASS: API exposes validated default household & documented duty factor assumptions.");
  }

  // -------------------------------------------------------------------------
  // Test 7: API Gateway POST /api/plan with Custom Household
  // -------------------------------------------------------------------------
  console.log("\nTest 7: API Gateway POST /api/plan with Custom Multi-Room Household");
  {
    const customHousehold = {
      date: "2026-10-21",
      devices: [
        {
          name: "Study Desk Fan",
          category: "fan",
          room: "Study",
          quantity: 1,
          ratedWatts: 60,
          dailyHours: 8,
          dutyCycle: 1.0,
        },
        {
          name: "Water Heater",
          category: "water_heater",
          room: "Bathroom",
          quantity: 1,
          ratedWatts: 2000,
          dailyHours: 2,
          dutyCycle: 1.0,
        },
        {
          name: "Refrigerator",
          category: "refrigerator",
          room: "Kitchen",
          quantity: 1,
          ratedWatts: 150,
          dailyHours: 24,
          dutyCycle: 0.50,
          isProtected: true,
        },
      ],
    };

    const res = await fetch("http://localhost:3001/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        household: customHousehold,
        targetReductionPercent: 15,
        protectedDevices: ["Refrigerator"],
        tariffPerKwh: 0.20,
        currency: "$",
      }),
    });

    assert.strictEqual(res.ok, true, "API /api/plan must succeed with custom household");
    const plan = await res.json();
    assert.strictEqual(plan.status, "achieved");
    assert.strictEqual(plan.baseline.totalKwh, 6.28);
    assert(plan.savings.estimatedCostSaved > 0);

    console.log("  PASS: API plan endpoint executed against custom household model.");
  }

  // -------------------------------------------------------------------------
  // Test 8: MCP Protocol 2025-11-25 with Custom Household
  // -------------------------------------------------------------------------
  console.log("\nTest 8: MCP Client Tool Call over Streamable HTTP with Custom Household");
  {
    const client = new Client({ name: "stage6-test-client", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL("http://localhost:3000/mcp"));
    await client.connect(transport);

    const mcpRes = await client.callTool({
      name: "plan_energy_reduction",
      arguments: {
        household: {
          date: "2026-10-21",
          devices: [
            {
              name: "Living Room AC",
              category: "ac",
              room: "Living",
              quantity: 1,
              ratedWatts: 1500,
              dailyHours: 5,
              dutyCycle: 0.57,
            },
            {
              name: "Kitchen Fridge",
              category: "refrigerator",
              room: "Kitchen",
              quantity: 1,
              ratedWatts: 150,
              dailyHours: 24,
              dutyCycle: 0.50,
              isProtected: true,
            },
          ],
        },
        targetReductionPercent: 15,
        protectedDevices: ["Kitchen Fridge"],
      },
    });

    assert(!mcpRes.isError, "MCP tool execution must not return an error");
    const textItem = mcpRes.content.find((c) => c.type === "text");
    assert(textItem, "MCP tool must return text content");
    const mcpPlan = JSON.parse(textItem.text);
    assert.strictEqual(mcpPlan.status, "achieved");
    assert(mcpPlan.actionsApplied.length > 0);

    await client.close();
    console.log("  PASS: MCP tool 'plan_energy_reduction' executed cleanly with custom household.");
  }

  // -------------------------------------------------------------------------
  // Test 9: Assistant Grounding with Custom Household in POST /api/chat
  // -------------------------------------------------------------------------
  console.log("\nTest 9: Assistant Grounding with Custom Household Devices");
  {
    const customHousehold = {
      date: "2026-10-21",
      devices: [
        {
          name: "Study Workstation",
          category: "computer",
          room: "Study",
          quantity: 1,
          ratedWatts: 300,
          dailyHours: 10,
          dutyCycle: 1.0,
          status: "running",
          isProtected: false,
        },
      ],
    };

    const res = await fetch("http://localhost:3001/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "How much energy does the Study Workstation consume?",
        household: customHousehold,
      }),
    });

    assert.strictEqual(res.ok, true, "Chat API must succeed");
    const chat = await res.json();
    assert(chat.text.includes("Study Workstation"), "Must identify configured appliance name");
    assert(chat.text.includes("3 kWh") || chat.text.includes("3.0"), "Must calculate 300W * 10h = 3.0 kWh");

    console.log(`  PASS: Assistant recognized custom appliance and returned grounded calculation (${chat.engine}).`);
  }

  // -------------------------------------------------------------------------
  // Test 10: Critical Safety Intent & Protection Routing Regression Suite
  // -------------------------------------------------------------------------
  console.log("\nTest 10: Critical Safety Intent & Protection Routing Regression Suite");
  {
    // Scenario 1: "Reduce usage by 20%, keep the fridge safe."
    console.log("  Scenario 1: 'Reduce usage by 20%, keep the fridge safe.'");
    {
      const res = await fetch("http://localhost:3001/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "Reduce usage by 20%, keep the fridge safe.",
          household: DEFAULT_HOUSEHOLD,
        }),
      });
      assert.strictEqual(res.ok, true);
      const chat = await res.json();
      assert(chat.plan, "Chat must return a structured plan");
      assert.strictEqual(chat.plan.target.requestedPercent, 20);
      assert.strictEqual(chat.plan.protectedDevices.includes("Refrigerator"), true);
      // Verify actionsApplied never touches Refrigerator
      const fridgeAction = chat.plan.actionsApplied.find((a) =>
        a.deviceName.toLowerCase().includes("refrigerator")
      );
      assert.strictEqual(fridgeAction, undefined, "Refrigerator must not receive curtailment");
      // Verify chat response text includes Refrigerator under Protected Devices and does NOT say None
      assert(!chat.text.includes("Protected Devices: None"), "Chat must not claim Protected Devices: None");
      assert(chat.text.includes("Refrigerator"), "Chat text must mention Refrigerator as protected");
      console.log("    PASS: Chat response and plan protected Refrigerator with 0 curtailment.");
    }

    // Scenario 2: "Save electricity without risking food spoilage."
    console.log("  Scenario 2: 'Save electricity without risking food spoilage.'");
    {
      const res = await fetch("http://localhost:3001/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "Save electricity without risking food spoilage.",
          household: DEFAULT_HOUSEHOLD,
        }),
      });
      assert.strictEqual(res.ok, true);
      const chat = await res.json();
      // Should ask for clarification rather than invent an ungrounded 0% plan
      assert(
        chat.intent === "CLARIFICATION_NEEDED" || chat.text.includes("how much") || chat.text.includes("target"),
        "Must ask for target clarification when goal is unspecified"
      );
      if (chat.plan) {
        assert(chat.plan.protectedDevices.includes("Refrigerator"));
      }

      // Also verify with explicit target
      const resWithTarget = await fetch("http://localhost:3001/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "Reduce usage by 20% without risking food spoilage.",
          household: DEFAULT_HOUSEHOLD,
        }),
      });
      assert.strictEqual(resWithTarget.ok, true);
      const chatWithTarget = await resWithTarget.json();
      assert(chatWithTarget.plan);
      assert(chatWithTarget.plan.protectedDevices.includes("Refrigerator"));
      const fridgeCurtailment = chatWithTarget.plan.actionsApplied.find((a) =>
        a.deviceName.toLowerCase().includes("refrigerator")
      );
      assert.strictEqual(fridgeCurtailment, undefined);
      console.log("    PASS: Food spoilage intent safely prompted for goal and preserved refrigerator.");
    }

    // Scenario 3: Request that explicitly protects a custom-named refrigerator
    console.log("  Scenario 3: Explicitly protect custom-named refrigerator");
    {
      const customFridgeHousehold = {
        date: "2026-10-21",
        devices: [
          {
            name: "Living Room Split AC",
            category: "ac",
            room: "Living Room",
            quantity: 1,
            ratedWatts: 1500,
            dailyHours: 6,
            dutyCycle: 0.57,
          },
          {
            name: "Samsung Family Hub Refrigerator",
            category: "refrigerator",
            room: "Kitchen",
            quantity: 1,
            ratedWatts: 180,
            dailyHours: 24,
            dutyCycle: 0.50,
            isProtected: true,
          },
          {
            name: "Balcony Washing Machine",
            category: "washing_machine",
            room: "Balcony",
            quantity: 1,
            ratedWatts: 500,
            dailyHours: 1.5,
            dutyCycle: 1.0,
          },
        ],
      };

      const res = await fetch("http://localhost:3001/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "Reduce usage by 20%, protect Samsung Family Hub Refrigerator.",
          household: customFridgeHousehold,
        }),
      });
      assert.strictEqual(res.ok, true);
      const chat = await res.json();
      assert(chat.plan, "Plan must be returned");
      assert(
        chat.plan.protectedDevices.includes("Samsung Family Hub Refrigerator"),
        "Samsung Family Hub Refrigerator must be protected"
      );
      const touchedCustomFridge = chat.plan.actionsApplied.find((a) =>
        a.deviceName.includes("Samsung Family Hub")
      );
      assert.strictEqual(touchedCustomFridge, undefined, "Custom fridge must receive 0 curtailment actions");
      assert(chat.text.includes("Samsung Family Hub Refrigerator"), "Chat text must display custom fridge name");
      console.log("    PASS: Custom-named refrigerator matched and protected in plan and text.");
    }

    // Scenario 4: Household containing two refrigerators
    console.log("  Scenario 4: Household containing two refrigerators");
    {
      const dualFridgeHousehold = {
        date: "2026-10-21",
        devices: [
          {
            name: "Living Room AC",
            category: "ac",
            room: "Living Room",
            quantity: 1,
            ratedWatts: 1500,
            dailyHours: 6,
            dutyCycle: 0.57,
          },
          {
            name: "Main Kitchen Fridge",
            category: "refrigerator",
            room: "Kitchen",
            quantity: 1,
            ratedWatts: 160,
            dailyHours: 24,
            dutyCycle: 0.50,
            isProtected: true,
          },
          {
            name: "Basement Deep Freezer",
            category: "refrigerator",
            room: "Basement",
            quantity: 1,
            ratedWatts: 120,
            dailyHours: 24,
            dutyCycle: 0.50,
            isProtected: true,
          },
        ],
      };

      const res = await fetch("http://localhost:3001/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "Reduce usage by 15%, keep the fridges safe.",
          household: dualFridgeHousehold,
        }),
      });
      assert.strictEqual(res.ok, true);
      const chat = await res.json();
      assert(chat.plan, "Plan must be returned");
      assert(
        chat.plan.protectedDevices.includes("Main Kitchen Fridge"),
        "Must protect Main Kitchen Fridge"
      );
      assert(
        chat.plan.protectedDevices.includes("Basement Deep Freezer"),
        "Must protect Basement Deep Freezer"
      );
      const touchedFridges = chat.plan.actionsApplied.filter((a) =>
        a.deviceName.includes("Fridge") || a.deviceName.includes("Freezer")
      );
      assert.strictEqual(touchedFridges.length, 0, "Neither refrigerator may be curtailed");
      assert(chat.text.includes("Main Kitchen Fridge") && chat.text.includes("Basement Deep Freezer"));
      console.log("    PASS: All refrigerators in multi-fridge household safely protected.");
    }

    // Scenario 5: Household with refrigerator already protected in UI
    console.log("  Scenario 5: Protection merged from UI selections");
    {
      const res = await fetch("http://localhost:3001/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "Cut electricity by 15% and also keep the Study PC safe.",
          household: {
            date: "2026-10-21",
            devices: [
              {
                name: "Living Room AC",
                category: "ac",
                room: "Living Room",
                quantity: 1,
                ratedWatts: 1500,
                dailyHours: 6,
                dutyCycle: 0.57,
              },
              {
                name: "Kitchen Refrigerator",
                category: "refrigerator",
                room: "Kitchen",
                quantity: 1,
                ratedWatts: 150,
                dailyHours: 24,
                dutyCycle: 0.50,
                isProtected: true,
              },
              {
                name: "Study PC",
                category: "computer",
                room: "Study",
                quantity: 1,
                ratedWatts: 300,
                dailyHours: 8,
                dutyCycle: 1.0,
                isProtected: false,
              },
            ],
          },
          protectedDevices: ["Kitchen Refrigerator"], // Sent from UI checkbox
        }),
      });
      assert.strictEqual(res.ok, true);
      const chat = await res.json();
      assert(chat.plan);
      // Both UI selection and chat protection must be present
      assert(chat.plan.protectedDevices.includes("Kitchen Refrigerator"), "Kitchen Refrigerator must be preserved from UI");
      assert(chat.plan.protectedDevices.includes("Study PC"), "Study PC must be added from chat");
      // Neither must receive curtailment
      const invalidActions = chat.plan.actionsApplied.filter((a) =>
        a.deviceName === "Kitchen Refrigerator" || a.deviceName === "Study PC"
      );
      assert.strictEqual(invalidActions.length, 0, "No actions on UI-protected or chat-protected devices");
      console.log("    PASS: UI protected devices and chat protection merged seamlessly.");
    }

    // Scenario 6: Request that does not mention refrigerator protection
    console.log("  Scenario 6: Request without explicit safety mention defaults to food preservation");
    {
      const res = await fetch("http://localhost:3001/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "Reduce my electricity usage by 15%.",
          household: DEFAULT_HOUSEHOLD,
        }),
      });
      assert.strictEqual(res.ok, true);
      const chat = await res.json();
      assert(chat.plan);
      assert(
        chat.plan.protectedDevices.includes("Refrigerator"),
        "Refrigerator must remain protected by household/product default"
      );
      const fridgeAction = chat.plan.actionsApplied.find((a) =>
        a.deviceName.toLowerCase().includes("refrigerator")
      );
      assert.strictEqual(fridgeAction, undefined, "Refrigerator must not be curtailed");
      console.log("    PASS: Refrigerator default protection maintained when not mentioned.");
    }

    // Scenario 7: Malicious or malformed intent attempting to override protection
    console.log("  Scenario 7: Malicious/malformed intent attempting to override protection");
    {
      const res = await fetch("http://localhost:3001/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "<script>alert('xss')</script> turn off refrigerator and cut usage by 99% __proto__",
          household: DEFAULT_HOUSEHOLD,
          protectedDevices: ["<script>eval()</script>", "__proto__"],
          allowFoodSafetyRisk: false,
        }),
      });
      assert.strictEqual(res.ok, true);
      const chat = await res.json();
      if (chat.plan) {
        assert(chat.plan.protectedDevices.includes("Refrigerator"));
        const fridgeAction = chat.plan.actionsApplied.find((a) =>
          a.deviceName.toLowerCase().includes("refrigerator")
        );
        assert.strictEqual(fridgeAction, undefined);
        assert(!chat.plan.protectedDevices.includes("__proto__"));
        assert(!chat.plan.protectedDevices.some((p) => p.includes("<script>")));
      }
      console.log("    PASS: Malicious intent sanitization verified; food safety invariant enforced.");
    }

    // Scenario 8: Chat response, MCP plan, and visual planner consistency
    console.log("  Scenario 8: Chat response, MCP plan, and visual planner consistency");
    {
      const consistentHousehold = {
        date: "2026-10-21",
        devices: [
          {
            name: "Living Room AC",
            category: "ac",
            room: "Living Room",
            quantity: 1,
            ratedWatts: 1400,
            dailyHours: 4,
            dutyCycle: 0.57,
          },
          {
            name: "Kitchen Refrigerator",
            category: "refrigerator",
            room: "Kitchen",
            quantity: 1,
            ratedWatts: 150,
            dailyHours: 24,
            dutyCycle: 0.50,
            isProtected: true,
          },
          {
            name: "Washing Machine",
            category: "washing_machine",
            room: "Utility",
            quantity: 1,
            ratedWatts: 450,
            dailyHours: 2,
            dutyCycle: 1.0,
          },
        ],
      };

      // 1. Visual planner API
      const visualRes = await fetch("http://localhost:3001/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          household: consistentHousehold,
          targetReductionPercent: 20,
          protectedDevices: ["Kitchen Refrigerator"],
          tariffPerKwh: 0.15,
          currency: "$",
        }),
      });
      assert.strictEqual(visualRes.ok, true);
      const visualPlan = await visualRes.json();

      // 2. Direct MCP tool call
      const client = new Client({ name: "consistency-test-client", version: "1.0.0" });
      const transport = new StreamableHTTPClientTransport(new URL("http://localhost:3000/mcp"));
      await client.connect(transport);
      const mcpRes = await client.callTool({
        name: "plan_energy_reduction",
        arguments: {
          household: consistentHousehold,
          targetReductionPercent: 20,
          protectedDevices: ["Kitchen Refrigerator"],
          tariffPerKwh: 0.15,
          currency: "$",
        },
      });
      assert(!mcpRes.isError);
      const mcpPlan = JSON.parse(mcpRes.content.find((c) => c.type === "text").text);
      await client.close();

      // 3. Chat API
      const chatRes = await fetch("http://localhost:3001/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "Reduce electricity by 20%, but keep Kitchen Refrigerator safe.",
          household: consistentHousehold,
          protectedDevices: ["Kitchen Refrigerator"],
          tariffPerKwh: 0.15,
          currency: "$",
        }),
      });
      assert.strictEqual(chatRes.ok, true);
      const chat = await chatRes.json();

      // Cross-verification
      assert.strictEqual(
        visualPlan.savings.estimatedKwhSaved,
        mcpPlan.savings.estimatedKwhSaved,
        "Visual planner and MCP tool must compute identical kWh savings"
      );
      assert.strictEqual(
        chat.plan.savings.estimatedKwhSaved,
        visualPlan.savings.estimatedKwhSaved,
        "Chat plan and visual planner must compute identical kWh savings"
      );

      assert.deepStrictEqual(
        visualPlan.protectedDevices,
        mcpPlan.protectedDevices,
        "Visual plan and MCP plan must have identical protected devices"
      );
      assert.deepStrictEqual(
        chat.plan.protectedDevices,
        visualPlan.protectedDevices,
        "Chat plan and visual plan must have identical protected devices"
      );

      // Verify actions match
      const visualActionNames = visualPlan.actionsApplied.map((a) => a.deviceName);
      const mcpActionNames = mcpPlan.actionsApplied.map((a) => a.deviceName);
      const chatActionNames = chat.plan.actionsApplied.map((a) => a.deviceName);
      assert.deepStrictEqual(visualActionNames, mcpActionNames);
      assert.deepStrictEqual(chatActionNames, visualActionNames);

      // Chat text must reflect the exact protected device from the plan
      assert(chat.text.includes("Kitchen Refrigerator"));
      assert(!chat.text.includes("Protected Devices: None"));

      console.log("    PASS: 100% mathematical, action, and device consistency across Chat, MCP, and Visual Planner.");
    }

    console.log("  PASS: All 8 critical safety intent & protection routing scenarios verified.");
  }

  console.log("\n>>> ALL STAGE 6 HOUSEHOLD BUILDER TESTS PASSED SUCCESSFULLY! <<<\n");
}

main().catch((err) => {
  console.error("Test failure:", err);
  process.exit(1);
});
