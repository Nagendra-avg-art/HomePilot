
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { calculateEnergyPlan, validateHousehold } from "./planner.js";

const app = express();
app.use(express.json());

const PORT = 3000;

// Our simulated household energy data.
// No physical devices or paid APIs are required.
const household = {
  date: "2026-10-13",
  
devices: [
  { name: "Living Room AC", kwh: 3.2, status: "running" },
  { name: "Refrigerator", kwh: 1.8, status: "running" },
  { name: "Washing Machine", kwh: 0.9, status: "idle" },
  { name: "Living Room Lights", kwh: 0.4, status: "on" },
],

};


function matchesDevice(name, query) {
  const nameWords = name.toLowerCase().split(/[^a-z0-9]+/);
  const queryWords = query
    .trim()
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

  if (queryWords.length === 0) return true;

  // A single word must match a complete word.
  if (queryWords.length === 1) {
    return nameWords.includes(queryWords[0]);
  }

  // Multiple words must match a phrase.
  return name.toLowerCase().includes(query.trim().toLowerCase());
}


function createHomePilotServer() {
  const server = new McpServer({
    name: "homepilot",
    version: "1.0.0",
  });

  server.registerTool(
    "get_energy_usage",
    {
      title: "Get Household Energy Usage",
      description:
        "Returns simulated daily energy consumption for household devices.",
      inputSchema: {
        device: z
          .string()
          .optional()
          .describe("Optional device name to filter by"),
      },
    },
    async ({ device }) => {
      const devices = device
  ? household.devices.filter((item) =>
      matchesDevice(item.name, device)
    )
  : household.devices;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              date: household.date,
              devices,
              totalKwh: Number(
                devices.reduce((sum, item) => sum + item.kwh, 0).toFixed(2)
              ),
            }),
          },
        ],
      };
    }
  );

server.registerTool(
  "get_device_status",
  {
    title: "Get Home Device Status",
    description:
      "Returns the simulated status of household devices. Optionally filter by device name.",
    inputSchema: {
      device: z
        .string()
        .optional()
        .describe("Optional device name to search for"),
    },
  },
  async ({ device }) => {
    const devices = device
  ? household.devices.filter((item) =>
      matchesDevice(item.name, device)
    )
  : household.devices;

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            devices: devices.map(({ name, status }) => ({
              name,
              status,
            })),
            count: devices.length,
          }),
        },
      ],
    };
  }
);

server.registerTool(
  "get_energy_summary",
  {
    title: "Get Household Energy Summary",
    description:
      "Summarizes household energy consumption, identifies the highest-consuming device, and provides a data-based suggestion.",
    inputSchema: {},
  },
  async () => {
    const devices = household.devices;

    const totalKwh = Number(
      devices.reduce((sum, item) => sum + item.kwh, 0).toFixed(2)
    );

    const highestConsumer = devices.reduce((highest, item) =>
      item.kwh > highest.kwh ? item : highest
    );

    const sharePercent =
      totalKwh > 0
        ? Number(((highestConsumer.kwh / totalKwh) * 100).toFixed(1))
        : 0;

    const recommendation =
      highestConsumer.status === "running"
        ? `Review the usage of ${highestConsumer.name}, the highest-consuming device. Check whether its current operation is necessary.`
        : `Review the usage pattern of ${highestConsumer.name}, the highest-consuming device.`;

    const summary = {
      date: household.date,
      totalKwh,
      deviceCount: devices.length,
      highestConsumer: {
        name: highestConsumer.name,
        kwh: highestConsumer.kwh,
        sharePercent,
      },
      recommendation,
      dataSource: "simulated",
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(summary, null, 2),
        },
      ],
    };
  }
);

  server.registerTool(
    "plan_energy_reduction",
    {
      title: "Plan Household Energy Reduction",
      description:
        "Generates a deterministic energy-reduction plan comparing baseline usage against a proposed scenario based on user constraints (target reduction percent, max kWh budget, protected devices, and electricity tariff).",
      inputSchema: {
        household: z
          .record(z.string(), z.any())
          .optional()
          .describe("Optional user-configured household model containing custom appliances, rated watts, and hours"),
        targetReductionPercent: z
          .number()
          .min(0)
          .max(100)
          .optional()
          .describe("Target percentage reduction in household energy (0-100)"),
        maxKwhBudget: z
          .number()
          .min(0)
          .optional()
          .describe("Target maximum household energy usage in kWh"),
        protectedDevices: z
          .array(z.string())
          .optional()
          .describe("List of device names that must not be reduced (e.g. ['refrigerator'])"),
        tariffPerKwh: z
          .number()
          .min(0)
          .optional()
          .describe("Cost per kWh for estimating monetary bill savings (default: 0.15)"),
        currency: z
          .string()
          .optional()
          .describe("Currency symbol for bill calculations (default: '$')"),
      },
    },
    async ({
      household: customHousehold,
      targetReductionPercent,
      maxKwhBudget,
      protectedDevices,
      tariffPerKwh,
      currency,
    }) => {
      let activeHousehold = household;
      if (customHousehold && Array.isArray(customHousehold.devices)) {
        const val = validateHousehold(customHousehold);
        if (val.valid) {
          activeHousehold = val.household;
        }
      }

      const plan = calculateEnergyPlan({
        household: activeHousehold,
        targetReductionPercent,
        maxKwhBudget,
        protectedDevices,
        tariffPerKwh,
        currency,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(plan, null, 2),
          },
        ],
      };
    }
  );

  return server;
}

app.post("/mcp", async (req, res) => {
  const server = createHomePilotServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("MCP request failed:", error);
    if (!res.headersSent) {
      res.status(500).json({
        error: "Internal server error",
      });
    }
  }
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "HomePilot" });
});

app.listen(PORT, () => {
  console.log(`HomePilot server running at http://localhost:${PORT}`);
  console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
});
