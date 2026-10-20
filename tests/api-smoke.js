
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

  console.log("\nAll HomePilot API smoke tests passed!");
}

main().catch((error) => {
  console.error("\nTEST FAILURE:", error.message);
  process.exitCode = 1;
});
