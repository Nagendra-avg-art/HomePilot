
import { useEffect, useState } from "react";
import {
  Activity,
  Zap,
  Lightbulb,
  Refrigerator,
  Thermometer,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  LoaderCircle,
  AlertCircle,
} from "lucide-react";
import "./App.css";

const API_URL = "http://localhost:3001/api";

const deviceIcons = {
  ac: Thermometer,
  refrigerator: Refrigerator,
  washing: Activity,
  lights: Lightbulb,
};

function getDeviceIcon(name) {
  const value = name.toLowerCase();

  if (value.includes("ac") || value.includes("air conditioner")) {
    return deviceIcons.ac;
  }
  if (value.includes("refrigerator") || value.includes("fridge")) {
    return deviceIcons.refrigerator;
  }
  if (value.includes("washing")) {
    return deviceIcons.washing;
  }
  if (value.includes("light")) {
    return deviceIcons.lights;
  }

  return Activity;
}

function App() {
  const [energy, setEnergy] = useState(null);
  const [devices, setDevices] = useState([]);
  const [summary, setSummary] = useState(null);

  const [messages, setMessages] = useState([
    {
      role: "assistant",
      text: "Hi! I'm HomePilot. Ask me about your home's energy usage or device status.",
    },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadDashboard() {
    setLoading(true);
    setError("");

    try {
      const [energyResponse, devicesResponse] = await Promise.all([
        fetch(`${API_URL}/energy`),
        fetch(`${API_URL}/devices`),
      ]);

      if (!energyResponse.ok || !devicesResponse.ok) {
        throw new Error(
          "The HomePilot API could not retrieve dashboard data."
        );
      }

      const [energyData, deviceData] = await Promise.all([
        energyResponse.json(),
        devicesResponse.json(),
      ]);

      setEnergy(energyData);
      setDevices(deviceData.devices);
    } catch (err) {
      setError(
        `${err.message} Check that all three HomePilot servers are running.`
      );
    } finally {
      setLoading(false);
    }
  }

  async function generateSummary() {
    setSummaryLoading(true);
    setError("");

    try {
      const response = await fetch(`${API_URL}/summary`);

      if (!response.ok) {
        throw new Error("Could not generate the energy summary.");
      }

      setSummary(await response.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setSummaryLoading(false);
    }
  }

  async function sendMessage(event) {
    event.preventDefault();

    const question = chatInput.trim();

    if (!question || chatLoading) return;

    setMessages((previous) => [
      ...previous,
      { role: "user", text: question },
    ]);

    setChatInput("");
    setChatLoading(true);

    try {
      const lowerQuestion = question.toLowerCase();

      // Identify which appliance the user mentioned.
      const deviceMatchers = [
        {
          name: "Living Room AC",
          pattern: /\b(ac|air conditioner|air conditioning)\b/i,
        },
        {
          name: "Refrigerator",
          pattern: /\b(refrigerator|fridge)\b/i,
        },
        {
          name: "Washing Machine",
          pattern: /\b(washing machine|washer|washing)\b/i,
        },
        {
          name: "Living Room Lights",
          pattern: /\b(lights|light|bulbs?|bulb)\b/i,
        },
      ];

      const requestedDevice = deviceMatchers.find((item) =>
        item.pattern.test(question)
      );

      // Retrieve device information from the existing API.
      const deviceResponse = await fetch(`${API_URL}/devices`);

      if (!deviceResponse.ok) {
        throw new Error("Could not retrieve device information.");
      }

      const deviceData = await deviceResponse.json();
      const allDevices = deviceData.devices;

      const matchedDevice = requestedDevice
        ? allDevices.find(
            (device) => device.name === requestedDevice.name
          )
        : null;

      const asksForEnergy =
        /\b(energy|usage|consumption|consume|consumes|kwh|electricity|power)\b/i.test(
          lowerQuestion
        );

      const asksForStatus =
        /\b(status|running|on|off|idle|working|operating|turned)\b/i.test(
          lowerQuestion
        );

      let answer;

      // Handle a question about one specific appliance first.
      if (matchedDevice && asksForEnergy) {
        const energyResponse = await fetch(`${API_URL}/energy`);

        if (!energyResponse.ok) {
          throw new Error("Could not retrieve energy readings.");
        }

        const energyData = await energyResponse.json();

        const energyDevice = energyData.devices.find(
          (device) => device.name === matchedDevice.name
        );

        if (energyDevice) {
          answer =
            `${energyDevice.name} used ${energyDevice.kwh} kWh ` +
            `in the simulated readings for ${energyData.date}.`;
        } else {
          answer = `Energy usage for ${matchedDevice.name} is unavailable.`;
        }
      } else if (matchedDevice) {
        // A named appliance gets a specific answer, not the full device list.
        answer =
          `${matchedDevice.name}: ${matchedDevice.status}.`;

        if (asksForStatus) {
          answer += ` Its reported status is ${matchedDevice.status}.`;
        }
      } else if (
        lowerQuestion.includes("device") ||
        lowerQuestion.includes("appliances") ||
        lowerQuestion.includes("all devices") ||
        lowerQuestion.includes("everything")
      ) {
        // List all devices only when the question asks generally.
        answer = allDevices
          .map((device) => `${device.name}: ${device.status}`)
          .join("\n");
      } else {
        // General home-energy questions use the summary endpoint.
        const response = await fetch(`${API_URL}/summary`);

        if (!response.ok) {
          throw new Error("Could not retrieve the energy summary.");
        }

        const data = await response.json();

        answer =
          `Total household usage: ${data.totalKwh} kWh.\n` +
          `Highest consumer: ${data.highestConsumer.name} ` +
          `(${data.highestConsumer.sharePercent}% of total).\n` +
          `${data.recommendation}\n\n` +
          `Data source: ${data.dataSource}.`;
      }

      setMessages((previous) => [
        ...previous,
        { role: "assistant", text: answer },
      ]);
    } catch (err) {
      setMessages((previous) => [
        ...previous,
        {
          role: "assistant",
          text: `Sorry, I couldn't answer that: ${err.message}`,
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  const activeCount = devices.filter(
    (device) =>
      device.status === "running" || device.status === "on"
  ).length;

  return (
    <main className="dashboard">
      <header className="topbar">
        <a className="brand" href="/">
          <span className="brand-icon">
            <Zap size={23} />
          </span>
          <span>
            HomePilot
            <small>HOME OPERATIONS</small>
          </span>
        </a>

        <span className="local-badge">
          <span />
          MCP connected
        </span>
      </header>

      <section className="welcome">
        <p className="eyebrow">YOUR HOME AT A GLANCE</p>
        <h1>
          A smarter view of <span>home.</span>
        </h1>
        <p>
          Understand energy usage and household activity in one place.
        </p>
      </section>

      {error && (
        <div role="alert" className="recommendation">
          <AlertCircle size={18} /> {error}
          <button
            className="secondary-button"
            onClick={loadDashboard}
          >
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <section className="panel">
          <LoaderCircle className="spin" size={24} />
          Loading HomePilot data...
        </section>
      ) : energy ? (
        <>
          <section className="metrics">
            <article className="metric-card">
              <div className="metric-heading">
                <Zap /> Total energy
              </div>
              <strong>
                {energy.totalKwh} <small>kWh</small>
              </strong>
              <p>Simulated usage · {energy.date}</p>
            </article>

            <article className="metric-card">
              <div className="metric-heading">
                <Activity /> Active devices
              </div>
              <strong>
                {activeCount}
                <small> devices</small>
              </strong>
              <p>Reported as on or running</p>
            </article>

            <article className="metric-card">
              <div className="metric-heading">
                <Thermometer /> Highest consumer
              </div>
              <strong className="consumer">
                {summary?.highestConsumer?.name ?? "Generate summary"}
              </strong>
              <p>
                {summary
                  ? `${summary.highestConsumer.kwh} kWh · ${summary.highestConsumer.sharePercent}% of total`
                  : "Generate an overview to identify the top consumer"}
              </p>
            </article>
          </section>

          <section className="content-grid">
            <article className="panel">
              <div className="panel-title">
                <div>
                  <h2>Household devices</h2>
                  <p>Data from the HomePilot MCP server</p>
                </div>
                <span className="count">{devices.length}</span>
              </div>

              <div className="device-list">
                {devices.map((device) => {
                  const Icon = getDeviceIcon(device.name);

                  const energyDevice = energy.devices.find(
                    (item) => item.name === device.name
                  );

                  return (
                    <div className="device-row" key={device.name}>
                      <div className="device-icon">
                        <Icon size={21} />
                      </div>

                      <div className="device-info">
                        <strong>{device.name}</strong>
                        <span>
                          {energyDevice
                            ? `${energyDevice.kwh} kWh`
                            : "Usage unavailable"}
                        </span>
                      </div>

                      <span className={`status status-${device.status}`}>
                        {device.status}
                      </span>
                    </div>
                  );
                })}
              </div>

              <p className="disclaimer">
                Readings are simulated; no physical devices are connected.
              </p>

              <button
                className="secondary-button"
                onClick={loadDashboard}
                disabled={loading}
              >
                <RefreshCw size={16} /> Refresh devices
              </button>
            </article>

            <article className="panel assistant-panel">
              <div className="assistant-heading">
                <span className="assistant-icon">
                  <Sparkles size={22} />
                </span>
                <div>
                  <h2>Home insights</h2>
                  <p>Powered by your MCP tools</p>
                </div>
              </div>

              {!summary ? (
                <div className="empty-report">
                  <div className="empty-icon">
                    <Zap size={25} />
                  </div>
                  <h3>See the bigger picture</h3>
                  <p>
                    Generate a summary to discover your largest energy
                    consumer and receive a data-based suggestion.
                  </p>

                  <button
                    onClick={generateSummary}
                    disabled={summaryLoading}
                  >
                    {summaryLoading ? (
                      <LoaderCircle className="spin" size={17} />
                    ) : (
                      <Sparkles size={17} />
                    )}
                    {summaryLoading
                      ? "Generating..."
                      : "Generate overview"}
                  </button>
                </div>
              ) : (
                <div className="report">
                  <span className="report-label">
                    <ShieldCheck size={15} /> MCP TOOL REPORT
                  </span>
                  <h3>{summary.totalKwh} kWh total usage</h3>
                  <p>
                    Highest consumer:{" "}
                    <strong>{summary.highestConsumer.name}</strong>
                  </p>
                  <p>
                    Consumption share:{" "}
                    <strong>
                      {summary.highestConsumer.sharePercent}%
                    </strong>
                  </p>

                  <div className="recommendation">
                    {summary.recommendation}
                  </div>

                  <p className="disclaimer">
                    Data source: {summary.dataSource}
                  </p>

                  <button
                    className="secondary-button"
                    onClick={generateSummary}
                    disabled={summaryLoading}
                  >
                    <RefreshCw size={16} />
                    {summaryLoading
                      ? "Refreshing..."
                      : "Refresh report"}
                  </button>
                </div>
              )}
            </article>
          </section>
        </>
      ) : null}

      <section className="panel chat-panel">
        <div className="assistant-heading">
          <span className="assistant-icon">
            <Sparkles size={22} />
          </span>
          <div>
            <h2>Ask HomePilot</h2>
            <p>Explore your simulated household data</p>
          </div>
        </div>

        <div className="chat-messages" aria-live="polite">
          {messages.map((message, index) => (
            <div
              key={`${index}-${message.role}`}
              className={`chat-message chat-${message.role}`}
            >
              <strong>
                {message.role === "user" ? "You" : "HomePilot"}
              </strong>
              <p>{message.text}</p>
            </div>
          ))}

          {chatLoading && (
            <div className="chat-message chat-assistant">
              <LoaderCircle className="spin" size={18} />
              Checking your home data...
            </div>
          )}
        </div>

        <form className="chat-form" onSubmit={sendMessage}>
          <input
            type="text"
            value={chatInput}
            onChange={(event) => setChatInput(event.target.value)}
            placeholder="Ask about energy or device status..."
            aria-label="Ask HomePilot a question"
            disabled={chatLoading}
          />
          <button
            type="submit"
            disabled={chatLoading || !chatInput.trim()}
          >
            {chatLoading ? "Checking..." : "Ask"}
          </button>
        </form>

        <p className="disclaimer">
          Responses use rule-based question handling and simulated data.
        </p>
      </section>

      <footer>
        <span>HOMEPILOT · LOCAL PROTOTYPE</span>
        <span>
          <ShieldCheck size={14} /> No paid services connected
        </span>
      </footer>
    </main>
  );
}

export default App;
