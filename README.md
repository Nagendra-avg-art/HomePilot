# HomePilot — Goal-Driven Household Energy Operations Assistant

**A smarter view of home.**

HomePilot is an AI-powered home operations and energy optimization assistant built for the **Build, Ship, Shape: Amazon Developer Hackathon (Alexa+ Track)**. It demonstrates how a conversational assistant can interpret natural-language household goals, inspect appliance telemetry, enforce food-preservation safety constraints, and generate deterministic energy curtailment plans using the **Model Context Protocol (MCP)** and genuine **local AI (Ollama + `qwen3:4b`)**.

The project runs 100% locally with simulated household data, requiring **zero paid API dependencies** and incurring **₹0 budget cost**.

---

## Key Features

- **Goal-Driven Energy Planner:** Request targets by percentage reduction (e.g. 15% or 20%) or usage budget caps (e.g. 5.0 kWh).
- **Physical Feasibility & Invariant Protection:** The deterministic planner guarantees that critical appliances (such as the Refrigerator) are protected from curtailment unless explicitly modified.
- **Genuine Local AI with Ollama (`qwen3:4b`):** Natural language intent extraction runs locally on your machine via Ollama 0.40.5+ with structured JSON output and strict server-side validation.
- **Transparent Execution Badging:** Every assistant response explicitly identifies whether it was powered by `✨ Local AI (qwen3:4b)` or `⚙️ Deterministic Fallback`. Fallback outputs are never mislabeled as AI-generated.
- **MCP Protocol 2025-11-25 Architecture:** Four registered MCP tools executed over Streamable HTTP transport.
- **Bi-Directional Interactive Dashboard:** Responsive React dashboard with live Before/After comparison, currency selection, tariff customization, and calculation decision audit trail.
- **Interactive Assistant:** Inquire about appliance statuses, consumption breakdowns, energy summaries, and grounded explanations for planned curtailments.

---

## Technology Stack

- **Frontend:** React 19, Vite, Lucide Icons, Vanilla CSS Design System
- **API Gateway:** Node.js, Express, Streamable HTTP MCP Client
- **Local AI:** Ollama (`qwen3:4b` / `llama3.2:latest`) via local HTTP API (`http://127.0.0.1:11434`)
- **MCP Server:** `@modelcontextprotocol/sdk` (Protocol 2025-11-25) over Streamable HTTP
- **Validation & Safety:** Zod schema enforcement and physical household safety invariants

---

## Architecture

```
Browser Dashboard (Port 5173)
       │
       ▼
HomePilot API Gateway (Port 3001)
  ├── 1. Local AI Intent Extraction ──► Local Ollama (Port 11434, qwen3:4b)
  │      └── Fallback Path ──────────► Deterministic Rule-Based Parser
  ├── 2. Input Validation & Safety ──► Food-Preservation Invariant Guard
  └── 3. MCP Client (Streamable HTTP)
               │
               ▼
   HomePilot MCP Server (Port 3000)
     ├── Tool: get_energy_usage
     ├── Tool: get_device_status
     ├── Tool: get_energy_summary
     └── Tool: plan_energy_reduction ──► Deterministic Planning Engine
```

---

## Available MCP Tools

| Tool | Purpose | Transport |
|---|---|---|
| `plan_energy_reduction` | Generates a deterministic energy-reduction plan comparing baseline usage against a proposed scenario based on user constraints (percentage reduction, kWh budget, protected devices, tariff). | Streamable HTTP |
| `get_energy_usage` | Retrieves simulated daily energy consumption, optionally filtered by device. | Streamable HTTP |
| `get_device_status` | Retrieves simulated appliance operating statuses (running, idle, on, off). | Streamable HTTP |
| `get_energy_summary` | Summarizes household consumption, identifies the highest consumer, and provides data-based guidance. | Streamable HTTP |

---

## Prerequisites

- **Node.js** (v18 or higher; v20+ recommended) and **npm**
- **Ollama** (v0.4.0 or higher) installed from [ollama.com](https://ollama.com)
  - Pull the model:
    ```bash
    ollama run qwen3:4b
    ```
  - *Note:* If Ollama is offline or not installed, HomePilot automatically and transparently operates in **Deterministic Fallback Mode** with zero crashes.

---

## Setup & Installation

Clone or download the repository, then open a terminal in the project root:

```bash
# 1. Install root dependencies
npm install

# 2. Install client dependencies
cd client
npm install
cd ..
```

---

## Running the Application

Open three terminals from the project root:

**Terminal 1 — MCP Server (Port 3000):**
```bash
node src/server.js
```

**Terminal 2 — API Gateway (Port 3001):**
```bash
node src/api.js
```

**Terminal 3 — Frontend Dashboard (Port 5173):**
```bash
cd client
npm run dev
```

Open your browser to `http://localhost:5173`.

---

## Testing & Quality Assurance

Run the comprehensive automated test suite from the root directory:

```bash
npm test
```

The test runner (`tests/run-all-tests.js`) starts isolated server instances and executes all 8 suites in sequence:
1. MCP Server health check
2. Ollama AI integration & fallback tests (`tests/test-ollama.js` — 9 tests)
3. Assistant NLP & explainability unit tests (`tests/test-assistant.js` — 8 tests)
4. Deterministic planning engine tests (`tests/test-planner.js` — 6 unit tests + MCP Streamable HTTP tool call)
5. Core MCP tools & protocol negotiation (`tests/test-mcp.js`)
6. Household overview workflow test (`tests/home-workflow.js`)
7. API Smoke, Plan, & Chat integration tests (`tests/api-smoke.js`)
8. Stage 6 Household Builder & Energy Twin test suite (`tests/test-household-builder.js` — 9 comprehensive tests)

You can also run the Stage 6 verification script individually:
```bash
node tests/test-household-builder.js
```

To run frontend lint and production build:
```bash
cd client
npm run lint
npm run build
```

---

## Stage 6 & 7: Household Builder & Architectural UI

Stage 6 and 7 elevate HomePilot into a premium household energy companion:

- **Interactive Architectural Floorplan:** An interactive 2D blueprint (`HomeBlueprint`) visualizing spatial room layouts, active wattage loads, device tallies, and safety protection statuses.
- **Configurable Appliance Inventory:** Add, configure, and monitor appliances with custom names, categories (`ac`, `fan`, `light`, `refrigerator`, `washing_machine`, `tv`, `computer`, `water_heater`, `other`), rooms, quantities, and rated wattages.
- **Direct Appliance Protection Controls:** Immediate safety toggle badges directly on appliance cards in the visual inventory to protect vital appliances from energy curtailment.
- **Physical Duty Factor Formulation:**
  $$\text{Daily kWh} = \frac{\text{Quantity} \times \text{Rated Watts} \times \text{Hours/Day} \times \text{Duty Factor}}{1000}$$
  Duty cycles model realistic compressor and thermal cycling:
  - **Air Conditioners:** 0.57 (~57% duty factor compressor cycling)
  - **Refrigerators:** 0.50 (~50% duty factor compressor cycling)
  - **Washing Machines:** 0.75 (motor wash/spin and thermal cycling)
  - **Lighting / Electronics:** 1.00 (continuous operational draw)
- **Instance-Bound Action Generation:** Multiple appliances in the same category generate independent, instance-targeted reduction actions.
- **Before & After Delta Centerpiece:** Instant kWh and cost reduction comparisons with visual energy gauges and transparent decision logic.
- **Conversational Assistant Workspace:** Chat interface with quick prompt chips, transparency badges (`✨ Local AI` / `⚙️ Deterministic Fallback`), and grounding in real MCP plan tools.
- **Local Browser Persistence:** Household state is persisted locally in `localStorage` under `homepilot_household_v1` with automatic fallback restoration.
- **Critical Food Safety Invariant:** Refrigerators and medical equipment are strictly protected against curtailment by default.

---

## Example Household Telemetry

The prototype uses calibrated simulated telemetry to model household consumption:

| Appliance | Baseline Usage | Status | Curtailed By Planner? |
|---|---:|---|---|
| Living Room AC | 3.2 kWh | Running | Yes (Eco Setpoint: -0.80 kWh / -25%) |
| Refrigerator | 1.8 kWh | Running | **Protected (Excluded for Food Safety)** |
| Washing Machine | 0.9 kWh | Idle | Yes (Cold-Water Deferral: -0.36 kWh / -40%) |
| Living Room Lights | 0.4 kWh | On | Yes (Dimming / Zone Shutoff: -0.20 kWh / -50%) |
| **Total Baseline** | **6.3 kWh** | — | **Max Feasible Reduction: 1.36 kWh (21.6%)** |

---

## Important Constraints & Transparency Notices

- **Simulated Prototype Data:** Readings, device statuses, and operational actions are deterministic mathematical estimates. Physical smart-home appliances are not connected or actuated.
- **Food Preservation Invariant:** The refrigerator is protected against curtailment by default.
- **Strictly ₹0 Budget:** No paid cloud APIs, OpenAI/Anthropic keys, or AWS billing are used. All inference and calculations run locally.
- **Explainability:** All returned advice and calculations derive directly from physical assumptions and deterministic models.

---

## License

MIT License. See the [LICENSE](LICENSE) file for details.

