
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const client = new Client({
  name: "homepilot-test-client",
  version: "1.0.0",
});

const transport = new StreamableHTTPClientTransport(
  new URL("http://localhost:3000/mcp")
);

try {
  // Connect using the MCP protocol.
  await client.connect(transport);
  console.log("1. MCP connection successful!");

  // Ask the server which tools it provides.
  const { tools } = await client.listTools();

  console.log("\n2. Available tools:");
  console.log(JSON.stringify(tools, null, 2));

  // Call the energy tool.
  const result = await client.callTool({
    name: "get_energy_usage",
    arguments: {},
  });

  console.log("\n3. Energy usage result:");
  console.log(JSON.stringify(result, null, 2));

  // Test filtering for one device.
  const filtered = await client.callTool({
    name: "get_energy_usage",
    arguments: { device: "AC" },
  });

  console.log("\n4. Filtered result (AC):");
  console.log(JSON.stringify(filtered, null, 2));
  
  const status = await client.callTool({
    name: "get_device_status",
    arguments: {},
  });

  console.log("\n5. Device status:");
  console.log(JSON.stringify(status, null, 2));

  const acStatus = await client.callTool({
    name: "get_device_status",
    arguments: { device: "AC" },
  });

  console.log("\n6. AC status:");
  console.log(JSON.stringify(acStatus, null, 2));

  
  const summary = await client.callTool({
    name: "get_energy_summary",
    arguments: {},
  });

  console.log("\n7. Energy summary:");
  console.log(JSON.stringify(summary, null, 2));

} catch (error) {
  console.error("MCP test failed:", error);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
