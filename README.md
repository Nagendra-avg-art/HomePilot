# HomePilot — AI-Powered Home Operations Assistant

**A smarter view of home.**

HomePilot is a home-operations prototype that demonstrates how an assistant can retrieve household energy information, inspect appliance statuses, and provide actionable energy insights through the Model Context Protocol (MCP).

The project is built with a React frontend, a Node.js backend, and MCP tools. It uses simulated household data and does not require paid API services.

## Features

- **Household energy dashboard:** View total simulated energy consumption.
- **Device status:** Inspect the reported status of household appliances.
- **Energy insights:** Identify the highest-consuming device and view an energy-saving suggestion.
- **Interactive assistant:** Ask questions about energy usage and appliance status.
- **MCP integration:** Expose household operations through three MCP tools.
- **Production build:** Build and preview the frontend using Vite.

## Technology Stack

- React and Vite
- Node.js and Express
- Model Context Protocol (MCP)
- MCP TypeScript SDK
- Zod
- Lucide React

## Architecture

The application has three main components:

1. **MCP server:** Provides tools for household energy usage, device status, and energy summaries.
2. **API gateway:** Connects the frontend to the MCP server through HTTP endpoints.
3. **Frontend:** Displays the dashboard, home insights, and assistant chat interface.

## Available MCP Tools

| Tool | Purpose |
|---|---|
| `get_energy_usage` | Retrieves simulated energy consumption, optionally filtered by device |
| `get_device_status` | Retrieves device statuses, optionally filtered by device |
| `get_energy_summary` | Summarizes energy usage and identifies the highest-consuming device |

## Requirements

- Node.js and npm
- A modern web browser
- Visual Studio Code or another code editor

## Setup

Clone or download the repository, then open a terminal in the project root.

Install the root dependencies:

```bash
npm install
```

Install the frontend dependencies:

```bash
cd client
npm install
cd ..
```

### Run the application

Open three terminals from the project root.

**Terminal 1 — MCP server**

```bash
node src/server.js
```

**Terminal 2 — API gateway**

```bash
node src/api.js
```

**Terminal 3 — Frontend**

```bash
cd client
npm run dev
```

Open the local URL printed by Vite, usually `http://localhost:5173`.

Keep the backend terminals running while using the application.

## Testing

Run the existing tests from the project root:

```bash
node tests/test-mcp.js
node tests/home-workflow.js
node tests/api-smoke.js
```

The tests cover MCP connectivity and tool calls, the combined home overview workflow, and API endpoint responses.

### Production frontend

Build the frontend:

```bash
cd client
npm run build
npm run preview
```

Open the preview URL printed by Vite. The backend servers must also be running for the dashboard data and assistant to work.

## Example Household Data

The current prototype uses simulated data:

| Device | Energy usage | Status |
|---|---:|---|
| Living Room AC | 3.2 kWh | Running |
| Refrigerator | 1.8 kWh | Running |
| Washing Machine | 0.9 kWh | Idle |
| Living Room Lights | 0.4 kWh | On |
| **Total** | **6.3 kWh** | — |

These values are illustrative and are not measurements from real appliances.

## Important Limitations

- Physical smart-home devices are not connected.
- Energy readings and device statuses are simulated.
- The chat assistant currently uses rule-based question handling rather than a full AI language model.
- The project is a local prototype and needs suitable hosting and configuration for public deployment.

## Budget

The prototype is designed to run without paid API dependencies. Hosting, third-party services, and future integrations may have separate requirements.

## Future Improvements

- Integrate real smart-home devices through supported interfaces.
- Add persistent household data storage.
- Improve natural-language understanding.
- Add historical energy charts and usage comparisons.
- Introduce configurable household profiles.

## Project Status

The MCP tools, API endpoints, combined workflow, frontend dashboard, chat interactions, and production frontend build have been tested locally.

This is an evolving prototype; production deployment and real-device integration are not claimed.

## License

A license should be added to the repository before public release. See the repository's `LICENSE` file for the applicable terms.
