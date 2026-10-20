
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const client = new Client({
  name: "homepilot-workflow",
  version: "1.0.0",
});

const transport = new StreamableHTTPClientTransport(
  new URL("http://localhost:3000/mcp")
);

try {
  await client.connect(transport);

  console.log("HomePilot: Weekend Home Overview\n");

  // Step 1: Ask the MCP server for an energy summary.
  const summaryResult = await client.callTool({
    name: "get_energy_summary",
    arguments: {},
  });

  if (summaryResult.isError) {
    throw new Error("Could not retrieve energy summary.");
  }

  const summary = JSON.parse(
    summaryResult.content.find((item) => item.type === "text").text
  );

  // Step 2: Ask for device statuses.
  const statusResult = await client.callTool({
    name: "get_device_status",
    arguments: {},
  });

  if (statusResult.isError) {
    throw new Error("Could not retrieve device statuses.");
  }

  const statusData = JSON.parse(
    statusResult.content.find((item) => item.type === "text").text
  );

  // Step 3: Combine the results into one report.
  const activeDevices = statusData.devices.filter(
    (device) => device.status === "running" || device.status === "on"
  );

  console.log(`Total simulated usage: ${summary.totalKwh} kWh`);
  console.log(
    `Highest consumer: ${summary.highestConsumer.name} ` +
    `(${summary.highestConsumer.sharePercent}% of total)`
  );

  console.log("\nDevices reported as active:");

  for (const device of activeDevices) {
    console.log(`- ${device.name}: ${device.status}`);
  }

  console.log("\nSuggestion:");
  console.log(summary.recommendation);

  console.log(`\nData source: ${summary.dataSource}`);
} catch (error) {
  console.error("Workflow failed:", error.message);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
