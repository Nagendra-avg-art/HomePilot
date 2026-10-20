
import express from "express";
import cors from "cors";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

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

app.listen(PORT, () => {
  console.log(`HomePilot API running at http://localhost:${PORT}`);
});
