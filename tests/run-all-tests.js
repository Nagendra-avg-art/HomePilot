/**
 * HomePilot Unified Test Suite Runner
 * 
 * Orchestrates all tests in a reliable, conflict-free sequence:
 * 1. Starts MCP Server (Port 3000)
 * 2. Runs Planner Tests (Unit + MCP Streamable HTTP tool calls)
 * 3. Runs MCP Connection & Existing Tool Tests
 * 4. Runs Home Workflow Integration Tests
 * 5. Starts API Gateway (Port 3001)
 * 6. Runs API Smoke & Planner Route Integration Tests
 * 7. Gracefully terminates all background test processes.
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttp(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // Server not ready yet
    }
    await sleep(250);
  }
  throw new Error(`Timeout waiting for ${url} to become ready within ${timeoutMs}ms`);
}

function runScript(scriptPath) {
  return new Promise((resolve, reject) => {
    console.log(`\n------------------------------------------------------------`);
    console.log(`RUNNING: node ${path.relative(ROOT_DIR, scriptPath)}`);
    console.log(`------------------------------------------------------------`);

    const child = spawn("node", [scriptPath], {
      cwd: ROOT_DIR,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Script ${path.basename(scriptPath)} exited with code ${code}`));
      }
    });
  });
}

function killProcess(proc) {
  if (!proc || proc.killed) return;
  try {
    if (process.platform === "win32" && proc.pid) {
      spawn("taskkill", ["/pid", String(proc.pid), "/f", "/t"], { stdio: "ignore" });
    } else {
      proc.kill("SIGTERM");
    }
  } catch (err) {
    console.error("Error stopping process:", err.message);
  }
}

async function main() {
  console.log("============================================================");
  console.log("       HOMEPILOT - COMPREHENSIVE TEST SUITE RUNNER         ");
  console.log("============================================================");

  let mcpServerProc = null;
  let apiGatewayProc = null;

  try {
    // 1. Launch MCP Server
    try {
      const res = await fetch("http://localhost:3000/health");
      if (res.ok) {
        console.log("✓ MCP Server is already running at http://localhost:3000");
      } else {
        throw new Error();
      }
    } catch {
      console.log("\n[1/6] Launching HomePilot MCP Server on port 3000...");
      mcpServerProc = spawn("node", ["src/server.js"], {
        cwd: ROOT_DIR,
        stdio: "inherit",
      });
      await waitForHttp("http://localhost:3000/health");
      console.log("✓ MCP Server is healthy at http://localhost:3000");
    }

    // 2. Run Ollama AI Integration & Fallback tests (Mocks + live Ollama if available)
    console.log("\n[2/7] Executing Ollama AI Integration & Fallback Tests...");
    await runScript(path.join(ROOT_DIR, "tests", "test-ollama.js"));

    // 3. Run Assistant NLP & Grounding tests (In-process unit tests)
    console.log("\n[3/7] Executing Assistant NLP & Grounding Tests...");
    await runScript(path.join(ROOT_DIR, "tests", "test-assistant.js"));

    // 4. Run Planner tests (Unit tests + live MCP tool call over Streamable HTTP)
    console.log("\n[4/7] Executing Planner Tests...");
    await runScript(path.join(ROOT_DIR, "tests", "test-planner.js"));

    // 5. Run Core MCP tests
    console.log("\n[5/7] Executing Core MCP Tests...");
    await runScript(path.join(ROOT_DIR, "tests", "test-mcp.js"));

    // 6. Run Home Workflow tests
    console.log("\n[6/7] Executing Home Workflow Tests...");
    await runScript(path.join(ROOT_DIR, "tests", "home-workflow.js"));

    // 7. Launch API Gateway
    try {
      const res = await fetch("http://localhost:3001/api/health");
      if (res.ok) {
        console.log("✓ API Gateway is already running at http://localhost:3001");
      } else {
        throw new Error();
      }
    } catch {
      console.log("\n[7/7] Launching HomePilot API Gateway on port 3001...");
      apiGatewayProc = spawn("node", ["src/api.js"], {
        cwd: ROOT_DIR,
        stdio: "inherit",
      });
      await waitForHttp("http://localhost:3001/api/health");
      console.log("✓ API Gateway is healthy at http://localhost:3001");
    }

    // Run API Smoke, Plan, & Chat integration tests
    console.log("\nExecuting API Smoke, Plan, & Chat Integration Tests...");
    await runScript(path.join(ROOT_DIR, "tests", "api-smoke.js"));

    // 8. Run Stage 6 Household Builder & Energy Twin verification tests
    console.log("\n[8/8] Executing Stage 6 Household Builder & Energy Twin Tests...");
    await runScript(path.join(ROOT_DIR, "tests", "test-household-builder.js"));

    console.log("\n============================================================");
    console.log("   ALL TEST SUITES PASSED! HOMEPILOT IS VERIFIED HEALTHY.   ");
    console.log("============================================================\n");
  } catch (error) {
    console.error("\nTEST SUITE RUNNER FAILURE:", error.message);
    process.exitCode = 1;
  } finally {
    console.log("Cleaning up test processes...");
    killProcess(apiGatewayProc);
    killProcess(mcpServerProc);
    await sleep(600); // Allow OS to release sockets
    console.log("Done.");
  }
}

main();
