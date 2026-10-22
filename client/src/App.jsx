import { useEffect, useState, useMemo } from "react";
import {
  Zap,
  Lightbulb,
  Refrigerator,
  Thermometer,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  LoaderCircle,
  AlertCircle,
  CheckCircle2,
  Lock,
  Unlock,
  ArrowRight,
  TrendingDown,
  Coins,
  Sliders,
  Info,
  ShieldAlert,
  Wind,
  Tv,
  Laptop,
  Flame,
  Plus,
  Trash2,
  Edit2,
  RotateCcw,
  Home,
  X,
  Check,
  SlidersHorizontal,
  Layers,
  ChevronDown,
  ChevronUp,
  Compass,
} from "lucide-react";
import "./App.css";

const API_URL = "http://localhost:3001/api";
const STORAGE_KEY = "homepilot_household_v1";

const CATEGORY_METADATA = {
  ac: {
    label: "Air Conditioner",
    icon: Thermometer,
    defaultWatts: 1400,
    defaultHours: 4,
    defaultDuty: 0.57,
    isProtectedDefault: false,
    dutyNote: "Compressor cycles (~57% duty factor vs continuous draw)",
  },
  fan: {
    label: "Ceiling / Circulation Fan",
    icon: Wind,
    defaultWatts: 75,
    defaultHours: 8,
    defaultDuty: 1.0,
    isProtectedDefault: false,
    dutyNote: "Continuous fan motor runtime",
  },
  light: {
    label: "Lighting Circuit / Fixtures",
    icon: Lightbulb,
    defaultWatts: 10,
    defaultHours: 6,
    defaultDuty: 1.0,
    isProtectedDefault: false,
    dutyNote: "Direct illumination load",
  },
  refrigerator: {
    label: "Refrigerator / Freezer",
    icon: Refrigerator,
    defaultWatts: 150,
    defaultHours: 24,
    defaultDuty: 0.50,
    isProtectedDefault: true,
    dutyNote: "Compressor cycles ~50% of the day; critical food safety load",
  },
  washing_machine: {
    label: "Washing Machine",
    icon: Layers,
    defaultWatts: 1200,
    defaultHours: 1,
    defaultDuty: 0.75,
    isProtectedDefault: false,
    dutyNote: "Motor wash/spin cycles and thermal heater (~75% duty factor)",
  },
  tv: {
    label: "Television / Display",
    icon: Tv,
    defaultWatts: 120,
    defaultHours: 4,
    defaultDuty: 1.0,
    isProtectedDefault: false,
    dutyNote: "Active display panel power draw",
  },
  computer: {
    label: "Computer / Workstation",
    icon: Laptop,
    defaultWatts: 250,
    defaultHours: 6,
    defaultDuty: 1.0,
    isProtectedDefault: false,
    dutyNote: "Compute & monitor power draw",
  },
  water_heater: {
    label: "Water Heater / Geyser",
    icon: Flame,
    defaultWatts: 2000,
    defaultHours: 2,
    defaultDuty: 1.0,
    isProtectedDefault: false,
    dutyNote: "Resistive heating element active window",
  },
  other: {
    label: "General Appliance",
    icon: Zap,
    defaultWatts: 200,
    defaultHours: 3,
    defaultDuty: 1.0,
    isProtectedDefault: false,
    dutyNote: "Standard operational power draw",
  },
};

const DEFAULT_HOUSEHOLD = {
  date: "2026-10-21",
  devices: [
    {
      id: "dev_ac_living",
      name: "Living Room AC",
      category: "ac",
      room: "Living Room",
      quantity: 1,
      ratedWatts: 1400,
      dailyHours: 4,
      dutyCycle: 0.57,
      kwh: 3.19,
      status: "running",
      isProtected: false,
    },
    {
      id: "dev_fridge_kitchen",
      name: "Refrigerator",
      category: "refrigerator",
      room: "Kitchen",
      quantity: 1,
      ratedWatts: 150,
      dailyHours: 24,
      dutyCycle: 0.50,
      kwh: 1.80,
      status: "running",
      isProtected: true,
    },
    {
      id: "dev_washer_utility",
      name: "Washing Machine",
      category: "washing_machine",
      room: "Utility",
      quantity: 1,
      ratedWatts: 1200,
      dailyHours: 1,
      dutyCycle: 0.75,
      kwh: 0.90,
      status: "idle",
      isProtected: false,
    },
    {
      id: "dev_lights_living",
      name: "Living Room Lights",
      category: "light",
      room: "Living Room",
      quantity: 4,
      ratedWatts: 10,
      dailyHours: 10,
      dutyCycle: 1.0,
      kwh: 0.40,
      status: "on",
      isProtected: false,
    },
  ],
  totalKwh: 6.29,
};

function computeDeviceKwh(qty, watts, hours, duty) {
  const q = Math.max(1, Math.round(Number(qty) || 1));
  const w = Math.max(0, Number(watts) || 0);
  const h = Math.min(24, Math.max(0, Number(hours) || 0));
  const d = Math.min(1.0, Math.max(0.01, Number(duty) || 1.0));
  return Number(((q * w * h * d) / 1000).toFixed(2));
}

function loadSavedHousehold() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.devices) && parsed.devices.length > 0) {
        const cleanDevices = parsed.devices.map((d) => {
          const qty = Math.max(1, Math.round(Number(d.quantity) || 1));
          const ratedWatts = Math.max(0, Number(d.ratedWatts) || 0);
          const dailyHours = Math.min(24, Math.max(0, Number(d.dailyHours) || 0));
          const dutyCycle = Math.min(1.0, Math.max(0.05, Number(d.dutyCycle) || 1.0));
          const isProtected = typeof d.isProtected === "boolean"
            ? d.isProtected
            : (d.category === "refrigerator" || /fridge|refrigerator|freezer/i.test(d.name));
          return {
            ...d,
            quantity: qty,
            ratedWatts,
            dailyHours,
            dutyCycle,
            kwh: computeDeviceKwh(qty, ratedWatts, dailyHours, dutyCycle),
            isProtected,
          };
        });
        const totalKwh = Number(cleanDevices.reduce((sum, d) => sum + d.kwh, 0).toFixed(2));
        return {
          date: parsed.date || "2026-10-21",
          devices: cleanDevices,
          totalKwh,
        };
      }
    }
  } catch (err) {
    console.warn("Could not parse saved household, restoring default:", err);
  }
  return DEFAULT_HOUSEHOLD;
}

function getCategoryIcon(category) {
  return CATEGORY_METADATA[category]?.icon || Zap;
}

/* =========================================================================
   ARCHITECTURAL FLOORPLAN / BLUEPRINT COMPONENT
   ========================================================================= */
function HomeBlueprint({ household, onSelectRoom }) {
  const roomGroups = useMemo(() => {
    const map = {};
    for (const d of household.devices) {
      const room = d.room || "Main Zone";
      if (!map[room]) {
        map[room] = { room, devices: [], totalKwh: 0 };
      }
      map[room].devices.push(d);
      map[room].totalKwh = Number((map[room].totalKwh + d.kwh).toFixed(2));
    }
    return Object.values(map);
  }, [household.devices]);

  const totalKwh = household.totalKwh || 1;

  // Pre-calculated geometric slots for up to 4-6 rooms in an architectural 600x320 SVG viewport
  const roomSlots = [
    { x: 24, y: 32, w: 260, h: 130 },
    { x: 316, y: 32, w: 260, h: 130 },
    { x: 24, y: 182, w: 260, h: 120 },
    { x: 316, y: 182, w: 260, h: 120 },
  ];

  return (
    <div className="blueprint-schematic-wrapper">
      <div className="blueprint-corner-mark top-left" />
      <div className="blueprint-corner-mark top-right" />
      <div className="blueprint-corner-mark bottom-left" />
      <div className="blueprint-corner-mark bottom-right" />

      {/* SVG Blueprint Canvas */}
      <svg
        viewBox="0 0 600 320"
        style={{ width: "100%", height: "auto", display: "block" }}
        aria-label="Architectural Energy Blueprint of Household"
      >
        <defs>
          <pattern id="bpGrid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(6, 182, 212, 0.08)" strokeWidth="0.75" />
          </pattern>
          <radialGradient id="loadGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#06b6d4" stopOpacity="0" />
          </radialGradient>
        </defs>

        <rect x="0" y="0" width="600" height="320" fill="url(#bpGrid)" />

        {/* Outer Architectural Perimeter Wall */}
        <rect
          x="14"
          y="18"
          width="572"
          height="288"
          fill="none"
          stroke="rgba(148, 163, 184, 0.35)"
          strokeWidth="2.5"
          rx="4"
        />

        {/* Inner Corridor Wall Line */}
        <line x1="297" y1="20" x2="297" y2="304" stroke="rgba(148, 163, 184, 0.2)" strokeWidth="1.5" strokeDasharray="6 4" />
        <line x1="16" y1="172" x2="584" y2="172" stroke="rgba(148, 163, 184, 0.2)" strokeWidth="1.5" strokeDasharray="6 4" />

        {/* Dynamic Room Chambers */}
        {roomGroups.slice(0, 4).map((group, index) => {
          const slot = roomSlots[index] || roomSlots[0];
          const pct = Math.round((group.totalKwh / totalKwh) * 100);
          const hasProtected = group.devices.some((d) => d.isProtected);

          return (
            <g
              key={group.room}
              onClick={() => onSelectRoom(group.room)}
              style={{ cursor: "pointer" }}
            >
              {/* Room Boundary & Glow */}
              <rect
                x={slot.x}
                y={slot.y}
                width={slot.w}
                height={slot.h}
                fill="rgba(15, 23, 42, 0.75)"
                stroke={hasProtected ? "rgba(16, 185, 129, 0.4)" : "rgba(6, 182, 212, 0.25)"}
                strokeWidth="1.2"
                rx="6"
              />

              {/* Energy Glow based on load */}
              <circle
                cx={slot.x + slot.w - 36}
                cy={slot.y + 36}
                r={Math.min(32, Math.max(14, pct * 0.8))}
                fill="url(#loadGlow)"
              />

              {/* Room Label */}
              <text
                x={slot.x + 14}
                y={slot.y + 24}
                fill="#f8fafc"
                fontSize="12"
                fontWeight="700"
                letterSpacing="0.4"
                fontFamily="system-ui, sans-serif"
              >
                {group.room.toUpperCase()}
              </text>

              {/* Room Subtitle Metric */}
              <text
                x={slot.x + 14}
                y={slot.y + 42}
                fill="#38bdf8"
                fontSize="11"
                fontWeight="600"
                fontFamily="system-ui, sans-serif"
              >
                {group.totalKwh} kWh/day ({pct}%)
              </text>

              {/* Appliance Tags List inside Room */}
              {group.devices.slice(0, 3).map((dev, devIdx) => (
                <g key={dev.id} transform={`translate(${slot.x + 14}, ${slot.y + 60 + devIdx * 19})`}>
                  <rect
                    x="0"
                    y="0"
                    width={slot.w - 28}
                    height="16"
                    fill="rgba(255, 255, 255, 0.04)"
                    stroke="rgba(148, 163, 184, 0.12)"
                    rx="3"
                  />
                  <text
                    x="6"
                    y="11.5"
                    fill={dev.isProtected ? "#a7f3d0" : "#94a3b8"}
                    fontSize="9.5"
                    fontWeight={dev.isProtected ? "700" : "500"}
                    fontFamily="system-ui, sans-serif"
                  >
                    {dev.isProtected ? "🛡️ " : "• "}
                    {dev.name.length > 22 ? `${dev.name.slice(0, 20)}…` : dev.name} ({dev.kwh} kWh)
                  </text>
                </g>
              ))}

              {/* Protected Badge if room contains shielded circuit */}
              {hasProtected && (
                <rect
                  x={slot.x + slot.w - 80}
                  y={slot.y + 12}
                  width="68"
                  height="16"
                  fill="rgba(16, 185, 129, 0.2)"
                  stroke="rgba(16, 185, 129, 0.4)"
                  rx="3"
                />
              )}
              {hasProtected && (
                <text
                  x={slot.x + slot.w - 74}
                  y={slot.y + 23.5}
                  fill="#6ee7b7"
                  fontSize="8.5"
                  fontWeight="700"
                  fontFamily="system-ui, sans-serif"
                >
                  PROTECTED
                </text>
              )}
            </g>
          );
        })}

        {/* Blueprint Orientation & Metadata */}
        <text x="24" y="312" fill="rgba(148, 163, 184, 0.45)" fontSize="9" fontFamily="monospace">
          HOMEPILOT · DIGITAL TWIN SCHEMATIC · SCALE 1:50 · DETACHED RESIDENCE
        </text>
        <text x="500" y="312" fill="rgba(6, 182, 212, 0.6)" fontSize="9" fontFamily="monospace">
          [PORT 3000 MCP]
        </text>
      </svg>
    </div>
  );
}

/* =========================================================================
   MAIN APPLICATION
   ========================================================================= */
function App() {
  // Navigation State
  const [activeTab, setActiveTab] = useState("home"); // "home" | "inventory" | "plan" | "assistant"

  // Household Twin State
  const [household, setHousehold] = useState(loadSavedHousehold);
  const [roomFilter, setRoomFilter] = useState("All");

  // Appliance Modal / Edit / Delete States
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingDeviceId, setEditingDeviceId] = useState(null);
  const [formName, setFormName] = useState("");
  const [formCategory, setFormCategory] = useState("ac");
  const [formRoom, setFormRoom] = useState("Living Room");
  const [formQuantity, setFormQuantity] = useState("1");
  const [formWatts, setFormWatts] = useState("1400");
  const [formHours, setFormHours] = useState("4");
  const [formDuty, setFormDuty] = useState("0.57");
  const [formProtected, setFormProtected] = useState(false);
  const [formError, setFormError] = useState("");

  const [deleteConfirmDevice, setDeleteConfirmDevice] = useState(null);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);

  // Planner state
  const [targetPercent, setTargetPercent] = useState("15");
  const [maxBudget, setMaxBudget] = useState("");
  const [tariff, setTariff] = useState("0.15");
  const [currency, setCurrency] = useState("$");
  const [protectedDevices, setProtectedDevices] = useState(() =>
    household.devices.filter((d) => d.isProtected).map((d) => d.name)
  );
  const [plan, setPlan] = useState(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState("");
  const [showAuditLog, setShowAuditLog] = useState(false);

  // Assistant & Telemetry State
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      text: "Hi! I'm HomePilot, your household energy companion. I can help explore your configured appliances, check power consumption, or calculate safe energy reduction plans.",
    },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  const [telemetry, setTelemetry] = useState(null);
  const [telemetryDevices, setTelemetryDevices] = useState([]);
  const [summary, setSummary] = useState(null);
  const [telemetryLoading, setTelemetryLoading] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [globalError, setGlobalError] = useState("");
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  // Persist household changes
  function updateAndPersistHousehold(newHousehold) {
    setHousehold(newHousehold);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newHousehold));
    } catch (e) {
      console.warn("Failed to persist household to localStorage:", e);
    }

    // Keep protected devices state in sync with household
    const activeProtected = newHousehold.devices.filter((d) => d.isProtected).map((d) => d.name);
    setProtectedDevices(activeProtected);

    // Auto recalculate plan with updated household
    handleCalculatePlan({ household: newHousehold, protectedDevices: activeProtected });
  }

  // Derived metrics
  const uniqueRooms = useMemo(() => {
    return ["All", ...new Set(household.devices.map((d) => d.room))];
  }, [household.devices]);

  const filteredDevices = useMemo(() => {
    if (roomFilter === "All") return household.devices;
    return household.devices.filter((d) => d.room === roomFilter);
  }, [household.devices, roomFilter]);

  const devicesByRoom = useMemo(() => {
    const map = {};
    for (const d of filteredDevices) {
      const room = d.room || "Main";
      if (!map[room]) map[room] = [];
      map[room].push(d);
    }
    return map;
  }, [filteredDevices]);

  const totalHouseholdKwh = useMemo(() => {
    return Number(household.devices.reduce((sum, d) => sum + d.kwh, 0).toFixed(2));
  }, [household.devices]);

  const dailyEstimatedCost = useMemo(() => {
    return (totalHouseholdKwh * (Number(tariff) || 0.15)).toFixed(2);
  }, [totalHouseholdKwh, tariff]);

  const protectedCount = useMemo(() => {
    return household.devices.filter((d) => d.isProtected).length;
  }, [household.devices]);

  const topConsumer = useMemo(() => {
    if (household.devices.length === 0) return null;
    const sorted = [...household.devices].sort((a, b) => b.kwh - a.kwh);
    const top = sorted[0];
    const share = totalHouseholdKwh > 0 ? ((top.kwh / totalHouseholdKwh) * 100).toFixed(1) : 0;
    return { ...top, share };
  }, [household.devices, totalHouseholdKwh]);

  const roomDistribution = useMemo(() => {
    const map = {};
    for (const dev of household.devices) {
      map[dev.room] = (map[dev.room] || 0) + dev.kwh;
    }
    return Object.entries(map).map(([room, kwh]) => ({
      room,
      kwh: Number(kwh.toFixed(2)),
      pct: totalHouseholdKwh > 0 ? Number(((kwh / totalHouseholdKwh) * 100).toFixed(1)) : 0,
    }));
  }, [household.devices, totalHouseholdKwh]);

  // Load telemetry from MCP server
  async function loadTelemetry() {
    setTelemetryLoading(true);
    setGlobalError("");
    try {
      const [energyRes, devicesRes] = await Promise.all([
        fetch(`${API_URL}/energy`),
        fetch(`${API_URL}/devices`),
      ]);
      if (!energyRes.ok || !devicesRes.ok) {
        throw new Error("Could not retrieve telemetry from backend API.");
      }
      const [energyData, deviceData] = await Promise.all([
        energyRes.json(),
        devicesRes.json(),
      ]);
      setTelemetry(energyData);
      setTelemetryDevices(deviceData.devices);
    } catch (err) {
      setGlobalError(`${err.message} Please check that backend servers (ports 3000 and 3001) are running.`);
    } finally {
      setTelemetryLoading(false);
    }
  }

  async function generateSummary() {
    setSummaryLoading(true);
    try {
      const res = await fetch(`${API_URL}/summary`);
      if (!res.ok) throw new Error("Could not generate summary.");
      setSummary(await res.json());
    } catch (err) {
      setGlobalError(err.message);
    } finally {
      setSummaryLoading(false);
    }
  }

  // Calculate Plan via MCP
  async function handleCalculatePlan(overrides = {}) {
    setPlanLoading(true);
    setPlanError("");

    const activeHouseholdObj = overrides.household || household;
    const effectiveTargetPercent =
      overrides.targetPercent !== undefined ? overrides.targetPercent : targetPercent;
    const effectiveMaxBudget =
      overrides.maxBudget !== undefined ? overrides.maxBudget : maxBudget;
    const effectiveTariff =
      overrides.tariff !== undefined ? overrides.tariff : tariff;
    const effectiveCurrency =
      overrides.currency !== undefined ? overrides.currency : currency;
    const effectiveProtected =
      overrides.protectedDevices !== undefined ? overrides.protectedDevices : protectedDevices;

    const reqBody = {
      household: activeHouseholdObj,
      protectedDevices: effectiveProtected,
      tariffPerKwh: effectiveTariff === "" ? undefined : Number(effectiveTariff),
      currency: effectiveCurrency,
    };

    if (effectiveTargetPercent !== "" && !isNaN(Number(effectiveTargetPercent))) {
      reqBody.targetReductionPercent = Number(effectiveTargetPercent);
    }

    if (effectiveMaxBudget !== "" && !isNaN(Number(effectiveMaxBudget))) {
      reqBody.maxKwhBudget = Number(effectiveMaxBudget);
    }

    try {
      const response = await fetch(`${API_URL}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqBody),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const details = Array.isArray(errorData.details)
          ? errorData.details.join("; ")
          : errorData.details || "";
        throw new Error(errorData.error ? `${errorData.error} ${details}` : `HTTP ${response.status}`);
      }

      const planData = await response.json();
      setPlan(planData);
    } catch (err) {
      setPlanError(`Could not generate plan: ${err.message}`);
      setPlan(null);
    } finally {
      setPlanLoading(false);
    }
  }

  function applyPreset(presetType) {
    if (presetType === "percent_15") {
      setTargetPercent("15");
      setMaxBudget("");
      const prot = household.devices.filter((d) => d.category === "refrigerator" || d.isProtected).map((d) => d.name);
      setProtectedDevices(prot);
      handleCalculatePlan({ targetPercent: "15", maxBudget: "", protectedDevices: prot });
    } else if (presetType === "budget_5") {
      setTargetPercent("");
      setMaxBudget("5.0");
      const prot = household.devices.filter((d) => d.category === "refrigerator" || d.isProtected).map((d) => d.name);
      setProtectedDevices(prot);
      handleCalculatePlan({ targetPercent: "", maxBudget: "5.0", protectedDevices: prot });
    } else if (presetType === "deep_eco") {
      setTargetPercent("30");
      setMaxBudget("");
      setProtectedDevices([]);
      handleCalculatePlan({ targetPercent: "30", maxBudget: "", protectedDevices: [] });
    }
  }

  // Direct toggle on device card
  function toggleDeviceProtection(deviceName) {
    const isCurrentlyProtected = protectedDevices.some(
      (d) => d.toLowerCase() === deviceName.toLowerCase()
    );
    const updated = isCurrentlyProtected
      ? protectedDevices.filter((d) => d.toLowerCase() !== deviceName.toLowerCase())
      : [...protectedDevices, deviceName];

    setProtectedDevices(updated);

    // Also update persistence on device item
    const updatedDevices = household.devices.map((d) => {
      if (d.name.toLowerCase() === deviceName.toLowerCase()) {
        return { ...d, isProtected: !isCurrentlyProtected };
      }
      return d;
    });

    const newHousehold = { ...household, devices: updatedDevices };
    updateAndPersistHousehold(newHousehold);
  }

  // Open modal for Adding
  function handleOpenAddModal() {
    setEditingDeviceId(null);
    setFormName("");
    setFormCategory("ac");
    setFormRoom("Living Room");
    setFormQuantity("1");
    setFormWatts(String(CATEGORY_METADATA.ac.defaultWatts));
    setFormHours(String(CATEGORY_METADATA.ac.defaultHours));
    setFormDuty(String(CATEGORY_METADATA.ac.defaultDuty));
    setFormProtected(false);
    setFormError("");
    setIsModalOpen(true);
  }

  // Open modal for Editing
  function handleOpenEditModal(device) {
    setEditingDeviceId(device.id);
    setFormName(device.name);
    setFormCategory(device.category || "other");
    setFormRoom(device.room || "Living Room");
    setFormQuantity(String(device.quantity || 1));
    setFormWatts(String(device.ratedWatts || 0));
    setFormHours(String(device.dailyHours || 0));
    setFormDuty(String(device.dutyCycle || 1.0));
    setFormProtected(Boolean(device.isProtected));
    setFormError("");
    setIsModalOpen(true);
  }

  function handleCategoryChange(newCategory) {
    setFormCategory(newCategory);
    const meta = CATEGORY_METADATA[newCategory];
    if (meta) {
      if (!editingDeviceId) {
        setFormWatts(String(meta.defaultWatts));
        setFormHours(String(meta.defaultHours));
        setFormDuty(String(meta.defaultDuty));
        setFormProtected(meta.isProtectedDefault);
      }
    }
  }

  function handleSaveAppliance(e) {
    e.preventDefault();
    setFormError("");

    const name = formName.trim();
    if (!name) {
      setFormError("Appliance name is required.");
      return;
    }

    const qty = Math.max(1, Math.round(Number(formQuantity) || 1));
    const watts = Number(formWatts);
    if (isNaN(watts) || watts < 0) {
      setFormError("Rated watts must be a non-negative number.");
      return;
    }

    const hours = Number(formHours);
    if (isNaN(hours) || hours < 0 || hours > 24) {
      setFormError("Daily hours must be between 0 and 24 hours.");
      return;
    }

    const duty = Number(formDuty);
    if (isNaN(duty) || duty <= 0 || duty > 1.0) {
      setFormError("Duty factor must be between 0.01 and 1.00.");
      return;
    }

    const kwh = computeDeviceKwh(qty, watts, hours, duty);

    let updatedDevices;
    if (editingDeviceId) {
      updatedDevices = household.devices.map((d) => {
        if (d.id === editingDeviceId) {
          return {
            ...d,
            name,
            category: formCategory,
            room: formRoom.trim() || "Main",
            quantity: qty,
            ratedWatts: watts,
            dailyHours: hours,
            dutyCycle: duty,
            kwh,
            isProtected: formProtected,
          };
        }
        return d;
      });
    } else {
      const newDev = {
        id: `dev_${formCategory}_${Date.now()}`,
        name,
        category: formCategory,
        room: formRoom.trim() || "Main",
        quantity: qty,
        ratedWatts: watts,
        dailyHours: hours,
        dutyCycle: duty,
        kwh,
        status: "running",
        isProtected: formProtected,
      };
      updatedDevices = [...household.devices, newDev];
    }

    const totalKwh = Number(updatedDevices.reduce((sum, d) => sum + d.kwh, 0).toFixed(2));
    const newHousehold = {
      date: household.date || "2026-10-21",
      devices: updatedDevices,
      totalKwh,
    };

    updateAndPersistHousehold(newHousehold);
    setIsModalOpen(false);
  }

  function handleDeleteDevice(device) {
    const updatedDevices = household.devices.filter((d) => d.id !== device.id);
    const totalKwh = Number(updatedDevices.reduce((sum, d) => sum + d.kwh, 0).toFixed(2));
    const newHousehold = {
      date: household.date || "2026-10-21",
      devices: updatedDevices,
      totalKwh,
    };
    updateAndPersistHousehold(newHousehold);
    setDeleteConfirmDevice(null);
  }

  function handleResetHousehold() {
    updateAndPersistHousehold(DEFAULT_HOUSEHOLD);
    setIsResetConfirmOpen(false);
  }

  // Chat message sending
  async function sendMessage(event) {
    event.preventDefault();
    const question = chatInput.trim();
    if (!question || chatLoading) return;

    setMessages((prev) => [...prev, { role: "user", text: question }]);
    setChatInput("");
    setChatLoading(true);

    try {
      const response = await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: question,
          tariffPerKwh: Number(tariff) || 0.15,
          currency: currency || "$",
          currentPlan: plan,
          protectedDevices,
          household,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: data.text,
          engine: data.engine,
          intent: data.intent,
          plan: data.plan,
        },
      ]);

      if (data.plan) {
        setPlan(data.plan);
        if (data.plan.target?.requestedPercent !== null && data.plan.target?.requestedPercent !== undefined) {
          setTargetPercent(String(data.plan.target.requestedPercent));
          setMaxBudget("");
        } else if (data.plan.target?.requestedBudgetKwh !== null && data.plan.target?.requestedBudgetKwh !== undefined) {
          setMaxBudget(String(data.plan.target.requestedBudgetKwh));
          setTargetPercent("");
        }
        if (data.plan.protectedDevices && Array.isArray(data.plan.protectedDevices)) {
          setProtectedDevices(data.plan.protectedDevices);
        }
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: `Error processing request: ${err.message}. Please verify the HomePilot backend is running.`,
          engine: "system-error",
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  }

  function sendQuickPrompt(promptText) {
    setChatInput(promptText);
    setActiveTab("assistant");
  }

  // Initial load
  useEffect(() => {
    loadTelemetry();
    handleCalculatePlan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Computed preview for modal
  const livePreviewKwh = useMemo(() => {
    return computeDeviceKwh(formQuantity, formWatts, formHours, formDuty);
  }, [formQuantity, formWatts, formHours, formDuty]);

  return (
    <main className="dashboard">
      {/* Top Header */}
      <header className="topbar">
        <a className="brand" href="/" onClick={(e) => { e.preventDefault(); setActiveTab("home"); }}>
          <span className="brand-icon">
            <Home size={22} />
          </span>
          <div className="brand-text">
            <h1>HomePilot</h1>
            <small>ARCHITECTURAL ENERGY TWIN · MCP 2025-11-25</small>
          </div>
        </a>

        <div className="topbar-right">
          <div className="status-badge">
            <span className="status-dot green" />
            <span>MCP Streamable HTTP (Port 3000)</span>
          </div>
          <div className="status-badge">
            <Sparkles size={13} style={{ color: "#38bdf8" }} />
            <span>Local AI (qwen3:4b)</span>
          </div>
          <div className="tariff-pill">
            <Coins size={14} />
            <span>{currency}{tariff}/kWh</span>
          </div>
        </div>
      </header>

      {/* Main Navigation Tabs */}
      <nav className="nav-tabs" aria-label="Main Navigation">
        <button
          type="button"
          className={`nav-tab ${activeTab === "home" ? "active" : ""}`}
          onClick={() => setActiveTab("home")}
        >
          <Compass size={16} />
          <span>Home Overview</span>
        </button>

        <button
          type="button"
          className={`nav-tab ${activeTab === "inventory" ? "active" : ""}`}
          onClick={() => setActiveTab("inventory")}
        >
          <SlidersHorizontal size={16} />
          <span>My Home (Spatial Model)</span>
          <span className="tab-badge">{household.devices.length}</span>
        </button>

        <button
          type="button"
          className={`nav-tab ${activeTab === "plan" ? "active" : ""}`}
          onClick={() => setActiveTab("plan")}
        >
          <Sliders size={16} />
          <span>Energy Plan</span>
          {plan && plan.status === "achieved" && <span className="tab-indicator-dot" />}
        </button>

        <button
          type="button"
          className={`nav-tab ${activeTab === "assistant" ? "active" : ""}`}
          onClick={() => setActiveTab("assistant")}
        >
          <Sparkles size={16} />
          <span>Ask HomePilot</span>
        </button>
      </nav>

      {/* Global Error Banner */}
      {globalError && (
        <div role="alert" className="feasibility-strip partial" style={{ marginBottom: "20px" }}>
          <AlertCircle size={20} />
          <div>
            <h4>Backend Connection Notice</h4>
            <p>{globalError}</p>
          </div>
          <button className="secondary-button" onClick={loadTelemetry} style={{ marginLeft: "auto" }}>
            Retry Check
          </button>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SCREEN 1: HOME OVERVIEW (ARCHITECTURAL COMMAND CENTER)                    */}
      {/* ========================================================================= */}
      {activeTab === "home" && (
        <div className="tab-pane">
          {/* Top Architectural Hero Metrics Ribbon */}
          <section className="overview-hero-ribbon">
            <article className="hero-metric-tile">
              <div className="metric-tile-header teal">
                <Zap size={15} /> Daily Baseline Consumption
              </div>
              <div className="metric-tile-value">
                {totalHouseholdKwh} <small>kWh/day</small>
              </div>
              <p className="metric-tile-sub">
                Estimated ~{currency}{dailyEstimatedCost}/day across {household.devices.length} configured appliances
              </p>
            </article>

            <article className="hero-metric-tile">
              <div className="metric-tile-header amber">
                <Thermometer size={15} /> Peak Consumption Zone
              </div>
              <div className="metric-tile-value" style={{ fontSize: "20px" }}>
                {topConsumer ? `${topConsumer.room}: ${topConsumer.name}` : "None"}
              </div>
              <p className="metric-tile-sub">
                {topConsumer
                  ? `${topConsumer.kwh} kWh/day (${topConsumer.share}% of household total)`
                  : "Add appliances to calculate distribution"}
              </p>
            </article>

            <article className="hero-metric-tile">
              <div className="metric-tile-header emerald">
                <ShieldCheck size={15} /> Protected Safety Invariants
              </div>
              <div className="metric-tile-value">
                {protectedCount} <small>of {household.devices.length} circuits</small>
              </div>
              <p className="metric-tile-sub">
                Food preservation strictly shielded against curtailment
              </p>
            </article>
          </section>

          {/* Meaningful Next Action Spotlight */}
          <section className="action-spotlight">
            <div className="spotlight-left">
              <div className="spotlight-icon-box">
                <Sparkles size={22} />
              </div>
              <div className="spotlight-content">
                <span className="spotlight-tag">RECOMMENDED NEXT ACTION</span>
                <h3>
                  {plan
                    ? `Active Plan: -${plan.savings.estimatedKwhSaved} kWh (${plan.savings.estimatedPercentSaved}%) Feasible Reduction`
                    : "Simulate a 15% Reduction Goal (Keep Refrigerator Safe)"}
                </h3>
                <p>
                  {plan
                    ? `Estimated daily savings of ${plan.savings.currency}${plan.savings.estimatedCostSaved} with zero curtailment applied to food storage.`
                    : "Evaluate cold-water wash, lighting dimming, and thermostat eco setpoints while preserving food safety."}
                </p>
              </div>
            </div>
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                if (!plan) applyPreset("percent_15");
                setActiveTab("plan");
              }}
            >
              {plan ? "Review Plan Actions & Trade-offs" : "Formulate Energy Plan"} <ArrowRight size={16} />
            </button>
          </section>

          {/* Central Architectural Blueprint & Room Energy Distribution */}
          <section className="blueprint-card">
            <div className="blueprint-header-bar">
              <div>
                <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 700 }}>
                  Architectural Digital Twin Floorplan
                </h2>
                <p style={{ margin: "4px 0 0", fontSize: "13px", color: "var(--text-secondary)" }}>
                  Spatial distribution of loads and protected circuits across residence zones
                </p>
              </div>
              <div className="blueprint-meta-tag">
                <Layers size={13} />
                <span>INTERACTIVE 2D BLUEPRINT</span>
              </div>
            </div>

            <HomeBlueprint
              household={household}
              onSelectRoom={(room) => {
                setRoomFilter(room);
                setActiveTab("inventory");
              }}
            />
          </section>

          {/* Two-Column Detail: Room Breakdown & Engineering Model Invariants */}
          <div className="overview-twin-row">
            {/* Left: Room Breakdown */}
            <article className="panel">
              <div className="panel-header">
                <div className="panel-title">
                  <h2>Zone Energy Distribution</h2>
                  <p>Model share calculated from user wattage and active hours</p>
                </div>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setActiveTab("inventory")}
                  style={{ padding: "6px 12px", fontSize: "12px" }}
                >
                  <Edit2 size={13} /> Edit Rooms
                </button>
              </div>

              <div className="room-breakdown-list">
                {roomDistribution.map((item) => (
                  <div key={item.room} className="room-bar-row">
                    <div className="room-bar-meta">
                      <span>{item.room}</span>
                      <small>{item.kwh} kWh/day ({item.pct}%)</small>
                    </div>
                    <div className="progress-track">
                      <div
                        className="progress-fill"
                        style={{ width: `${Math.min(100, Math.max(6, item.pct))}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </article>

            {/* Right: Transparent Model Assumptions */}
            <article className="panel">
              <div className="panel-header">
                <div className="panel-title">
                  <h2>Physical Assumptions &amp; Invariants</h2>
                  <p>Deterministic mathematical rules grounding the HomePilot twin</p>
                </div>
                <span className="status-badge" style={{ fontSize: "11px" }}>₹0 LOCAL AI</span>
              </div>

              <div className="provenance-strip">
                <div className="provenance-item">
                  <div className="provenance-heading">1. User Inputs</div>
                  <p>Appliance counts, rated wattages, and operating windows configured in My Home.</p>
                </div>
                <div className="provenance-item">
                  <div className="provenance-heading">2. Duty Cycles</div>
                  <p>Compressors in AC (~57%) and fridges (~50%) cycle intermittently, never drawn at 100% continuous.</p>
                </div>
                <div className="provenance-item">
                  <div className="provenance-heading">3. Deterministic Arithmetic</div>
                  <p><code>daily kWh = qty × W × h × duty ÷ 1000</code>. Verified by unit tests.</p>
                </div>
                <div className="provenance-item">
                  <div className="provenance-heading">4. Food Safety Rule</div>
                  <p>Refrigerators and medical loads are strictly shielded against curtailment.</p>
                </div>
              </div>
            </article>
          </div>

          <p className="disclaimer-text">
            <strong>Transparency Notice:</strong> Measured household data is simulated prototype data. Savings, bill impacts, and operational actions are deterministic mathematical model estimates. No physical appliances are actuated.
          </p>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SCREEN 2: MY HOME (HOUSEHOLD BUILDER)                                     */}
      {/* ========================================================================= */}
      {activeTab === "inventory" && (
        <div className="tab-pane">
          <div className="inventory-topbar">
            <div>
              <h2 style={{ margin: 0, fontSize: "20px", fontWeight: 700 }}>Household Appliance Inventory</h2>
              <p style={{ margin: "4px 0 0", fontSize: "13px", color: "var(--text-secondary)" }}>
                {household.devices.length} appliances across {uniqueRooms.length - 1} rooms · {totalHouseholdKwh} kWh/day total baseline
              </p>
            </div>

            <div className="inventory-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setIsResetConfirmOpen(true)}
              >
                <RotateCcw size={15} /> Restore Reference Example
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={handleOpenAddModal}
              >
                <Plus size={16} /> Add Appliance
              </button>
            </div>
          </div>

          {/* Room Filter Pills */}
          <div className="room-filter-row">
            {uniqueRooms.map((room) => {
              const count = room === "All"
                ? household.devices.length
                : household.devices.filter((d) => d.room === room).length;
              return (
                <button
                  key={room}
                  type="button"
                  className={`room-filter-pill ${roomFilter === room ? "active" : ""}`}
                  onClick={() => setRoomFilter(room)}
                >
                  {room} ({count})
                </button>
              );
            })}
          </div>

          {/* Spatial Room Groupings */}
          {Object.entries(devicesByRoom).map(([roomName, devices]) => {
            const roomKwh = Number(devices.reduce((s, d) => s + d.kwh, 0).toFixed(2));
            const roomPct = totalHouseholdKwh > 0 ? ((roomKwh / totalHouseholdKwh) * 100).toFixed(1) : 0;

            return (
              <section key={roomName} className="spatial-room-block">
                <div className="spatial-room-header">
                  <div className="spatial-room-title">
                    <Home size={17} style={{ color: "var(--accent-cyan)" }} />
                    <span>{roomName}</span>
                  </div>
                  <div className="spatial-room-meta">
                    {roomKwh} kWh/day ({roomPct}% of household) · {devices.length} appliance(s)
                  </div>
                </div>

                <div className="appliances-grid">
                  {devices.map((device) => {
                    const Icon = getCategoryIcon(device.category);
                    const meta = CATEGORY_METADATA[device.category] || CATEGORY_METADATA.other;

                    return (
                      <article
                        key={device.id}
                        className={`appliance-card ${device.isProtected ? "protected" : ""}`}
                      >
                        <div className="appliance-header">
                          <div className="appliance-identity">
                            <div className="appliance-icon-box">
                              <Icon size={20} />
                            </div>
                            <div className="appliance-title-group">
                              <h3>{device.name}</h3>
                              <span className="appliance-room-pill">{device.room} · {meta.label}</span>
                            </div>
                          </div>

                          {/* Direct Protection Toggle */}
                          <button
                            type="button"
                            className={`protection-toggle-btn ${
                              device.isProtected ? "is-protected" : "is-unprotected"
                            }`}
                            onClick={() => toggleDeviceProtection(device.name)}
                            title={device.isProtected ? "Click to unprotect" : "Click to protect against curtailment"}
                          >
                            {device.isProtected ? <Lock size={12} /> : <Unlock size={12} />}
                            <span>{device.isProtected ? "Protected" : "Protect"}</span>
                          </button>
                        </div>

                        {/* Specs Micro-Grid */}
                        <div className="specs-table">
                          <div className="spec-cell">
                            <span className="spec-label">Quantity</span>
                            <span className="spec-value">{device.quantity} unit(s)</span>
                          </div>
                          <div className="spec-cell">
                            <span className="spec-label">Rated Watts</span>
                            <span className="spec-value">{device.ratedWatts} W</span>
                          </div>
                          <div className="spec-cell">
                            <span className="spec-label">Daily Runtime</span>
                            <span className="spec-value">{device.dailyHours} hrs/day</span>
                          </div>
                          <div className="spec-cell">
                            <span className="spec-label">Duty Factor</span>
                            <span className="spec-value">{Math.round((device.dutyCycle || 1) * 100)}%</span>
                          </div>
                        </div>

                        <p className="appliance-duty-note">
                          {meta.dutyNote}
                        </p>

                        <div className="appliance-calc-strip">
                          <div>
                            <span style={{ fontSize: "11px", color: "var(--text-muted)", display: "block" }}>
                              Calculated Daily Draw:
                            </span>
                            <span className="calc-kwh">
                              {device.kwh} <small>kWh/day</small>
                            </span>
                          </div>
                          <span className="calc-cost">
                            ~{currency}{(device.kwh * (Number(tariff) || 0.15)).toFixed(2)}/day
                          </span>
                        </div>

                        <div className="appliance-card-actions">
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => handleOpenEditModal(device)}
                            style={{ padding: "6px 12px", fontSize: "12px" }}
                          >
                            <Edit2 size={13} /> Edit
                          </button>
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => setDeleteConfirmDevice(device)}
                            style={{ color: "var(--rose-primary)" }}
                          >
                            <Trash2 size={13} /> Remove
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}

          {filteredDevices.length === 0 && (
            <div className="panel" style={{ textAlign: "center", padding: "48px 24px" }}>
              <Zap size={36} style={{ color: "var(--accent-cyan)", margin: "0 auto 12px" }} />
              <h3>No appliances found in {roomFilter}</h3>
              <p style={{ color: "var(--text-secondary)", marginBottom: "16px" }}>
                Add a new appliance or switch to All Rooms to view your configured inventory.
              </p>
              <button type="button" className="primary-button" onClick={handleOpenAddModal}>
                <Plus size={16} /> Add Appliance Now
              </button>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* SCREEN 3: ENERGY PLAN (GOAL OPTIMIZER)                                    */}
      {/* ========================================================================= */}
      {activeTab === "plan" && (
        <div className="tab-pane">
          {/* Main Visual Centerpiece Card */}
          <section className="plan-centerpiece-card">
            <div className="panel-header">
              <div className="panel-title">
                <h2>Before &amp; After Energy Plan Scenario</h2>
                <p>MCP tool: <code>plan_energy_reduction</code> · Grounded in deterministic physical formulas</p>
              </div>

              <div className="status-badge">
                <ShieldCheck size={14} style={{ color: "var(--emerald-primary)" }} />
                <span>Deterministic Invariants Enforced</span>
              </div>
            </div>

            {/* Plan Formulation Controls Form */}
            <div className="planning-form-container">
              {/* Quick Presets */}
              <div className="presets-row">
                <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase" }}>
                  Quick Presets:
                </span>
                <button
                  type="button"
                  className="preset-chip-btn"
                  onClick={() => applyPreset("percent_15")}
                  disabled={planLoading}
                >
                  Save 15% (Keep Refrigerator Safe)
                </button>
                <button
                  type="button"
                  className="preset-chip-btn"
                  onClick={() => applyPreset("budget_5")}
                  disabled={planLoading}
                >
                  Cap at 5.0 kWh Budget
                </button>
                <button
                  type="button"
                  className="preset-chip-btn"
                  onClick={() => applyPreset("deep_eco")}
                  disabled={planLoading}
                >
                  Deep Eco 30%
                </button>
              </div>

              {/* Input Fields Grid */}
              <div className="planning-inputs-grid">
                <div className="form-field">
                  <label htmlFor="target-percent-input">Target Reduction (%)</label>
                  <input
                    id="target-percent-input"
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    placeholder="e.g. 20"
                    value={targetPercent}
                    onChange={(e) => setTargetPercent(e.target.value)}
                    disabled={planLoading}
                  />
                </div>

                <div className="form-field">
                  <label htmlFor="max-budget-input">Usage Cap Budget (kWh)</label>
                  <input
                    id="max-budget-input"
                    type="number"
                    min="0"
                    step="0.1"
                    placeholder="e.g. 5.0 (optional)"
                    value={maxBudget}
                    onChange={(e) => setMaxBudget(e.target.value)}
                    disabled={planLoading}
                  />
                </div>

                <div className="form-field">
                  <label htmlFor="tariff-input">Utility Tariff (per kWh)</label>
                  <input
                    id="tariff-input"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="e.g. 0.15"
                    value={tariff}
                    onChange={(e) => setTariff(e.target.value)}
                    disabled={planLoading}
                  />
                </div>

                <div className="form-field">
                  <label htmlFor="currency-select">Tariff Currency</label>
                  <select
                    id="currency-select"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    disabled={planLoading}
                  >
                    <option value="$">$ (USD)</option>
                    <option value="₹">₹ (INR)</option>
                    <option value="€">€ (EUR)</option>
                    <option value="£">£ (GBP)</option>
                  </select>
                </div>
              </div>

              {/* Protected Devices Multi-select */}
              <div className="protection-select-box">
                <label>
                  Protected Circuits (Appliances shielded from all reductions &amp; turn-offs):
                </label>
                <div className="protection-chips-grid">
                  {household.devices.map((device) => {
                    const isProt = protectedDevices.some(
                      (p) => p.toLowerCase() === device.name.toLowerCase()
                    );
                    return (
                      <button
                        type="button"
                        key={device.id}
                        onClick={() => toggleDeviceProtection(device.name)}
                        className={`protection-pill-btn ${isProt ? "is-active" : "is-inactive"}`}
                        disabled={planLoading}
                      >
                        {isProt ? <Lock size={13} /> : <Unlock size={13} />}
                        <span>{device.name}</span>
                        <small>({isProt ? "Protected" : "Eligible"})</small>
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                type="button"
                className="primary-button"
                onClick={() => handleCalculatePlan()}
                disabled={planLoading}
                style={{ width: "100%", padding: "12px 20px" }}
              >
                {planLoading ? (
                  <>
                    <LoaderCircle className="spin" size={18} />
                    Calculating Feasible Plan via MCP...
                  </>
                ) : (
                  <>
                    <Sparkles size={18} />
                    Calculate Feasible Plan
                  </>
                )}
              </button>
            </div>

            {/* Error Message */}
            {planError && (
              <div role="alert" className="feasibility-strip partial">
                <AlertCircle size={20} />
                <div>
                  <h4>Planning Error</h4>
                  <p>{planError}</p>
                </div>
              </div>
            )}

            {/* Centerpiece Plan Comparison */}
            {plan && (
              <div>
                {/* Feasibility Alert */}
                <div className={`feasibility-strip ${plan.status}`}>
                  {plan.status === "achieved" ? (
                    <CheckCircle2 size={24} />
                  ) : plan.status === "partial" ? (
                    <ShieldAlert size={24} />
                  ) : (
                    <Info size={24} />
                  )}
                  <div>
                    <h4>
                      {plan.status === "achieved"
                        ? "Goal Feasible & Fully Achieved"
                        : plan.status === "partial"
                        ? "Goal Partially Achieved (Safety Invariants Preserved)"
                        : "No Action Needed"}
                    </h4>
                    <p>{plan.explanation}</p>
                    <div className="contrast-row">
                      <span className="contrast-pill">{plan.target.requestedTargetLabel}</span>
                      <span className="contrast-pill">{plan.savings.plannedReductionLabel}</span>
                    </div>
                  </div>
                </div>

                {/* Scenario Deck: Baseline -> Delta -> Proposed */}
                <div className="scenario-comparison-deck">
                  <div className="scenario-box baseline">
                    <span className="scenario-tag">Current Baseline</span>
                    <div className="scenario-kwh">
                      {plan.baseline.totalKwh} <small>kWh/day</small>
                    </div>
                    <span className="scenario-cost-line">
                      Cost: {plan.savings.currency}{plan.baseline.estimatedCost}/day
                    </span>
                  </div>

                  <div className="scenario-bridge">
                    <div className="delta-savings-badge">
                      <TrendingDown size={16} />
                      <span>-{plan.savings.estimatedKwhSaved} kWh ({plan.savings.estimatedPercentSaved}%)</span>
                    </div>
                    <span className="delta-cost-text">
                      Save {plan.savings.currency}{plan.savings.estimatedCostSaved}/day
                    </span>
                  </div>

                  <div className="scenario-box proposed">
                    <span className="scenario-tag">Proposed Plan</span>
                    <div className="scenario-kwh">
                      {plan.proposed.totalKwh} <small>kWh/day</small>
                    </div>
                    <span className="scenario-cost-line">
                      Cost: {plan.savings.currency}{plan.proposed.estimatedCost}/day
                    </span>
                  </div>
                </div>

                {/* Protected Devices Prominent Shield Card */}
                <div className="protected-summary-card">
                  <div className="shield-icon-circle">
                    <ShieldCheck size={22} />
                  </div>
                  <div className="protected-summary-content">
                    <h4>Protected Circuits Preserved</h4>
                    <p>
                      The following appliances received exactly <strong>0.0 kWh curtailment</strong> to guarantee food preservation and critical safety:
                    </p>
                    <div className="protected-pills-list">
                      {plan.protectedDevices && plan.protectedDevices.length > 0 ? (
                        plan.protectedDevices.map((devName) => (
                          <span key={devName} className="shielded-device-pill">
                            <Lock size={12} /> {devName}
                          </span>
                        ))
                      ) : (
                        <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>None protected</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Applied Physical Operational Actions Grid */}
                <h3 style={{ margin: "24px 0 14px", fontSize: "16px", fontWeight: 700 }}>
                  Selected Operational Actions ({plan.actionsApplied.length})
                </h3>

                {plan.actionsApplied.length === 0 ? (
                  <p style={{ color: "var(--text-secondary)", fontSize: "13px" }}>
                    No operational actions required. Current usage meets the specified goal.
                  </p>
                ) : (
                  <div className="applied-actions-grid">
                    {plan.actionsApplied.map((action) => (
                      <article key={action.id} className="action-item-card">
                        <div className="action-item-top">
                          <span className="action-item-title">{action.name}</span>
                          <span className="action-kwh-delta">-{action.kwhSaved} kWh</span>
                        </div>
                        <span className="action-device-name">Target: {action.deviceName}</span>
                        <div className="action-tradeoff-box">
                          <strong>Trade-off:</strong> {action.tradeOff}
                        </div>
                        <div className="action-assumption-box">
                          <strong>Physical Assumption:</strong> {action.assumption}
                        </div>
                      </article>
                    ))}
                  </div>
                )}

                {/* Audit Trail Decision Log */}
                <div className="audit-accordion">
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => setShowAuditLog((prev) => !prev)}
                    style={{ fontSize: "13px", padding: "6px 0" }}
                  >
                    {showAuditLog ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                    <span>{showAuditLog ? "Hide Calculation Decision Trail" : "Show Calculation Decision Trail (Audit Log)"}</span>
                  </button>

                  {showAuditLog && (
                    <div className="audit-log-box">
                      {plan.decisionLog.map((entry, idx) => (
                        <div key={idx} className="audit-entry-line">
                          <span className={`tag-${entry.type}`}>[{entry.type.toUpperCase()}]</span>{" "}
                          {entry.message}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SCREEN 4: ASK HOMEPILOT (CONVERSATIONAL WORKSPACE)                        */}
      {/* ========================================================================= */}
      {activeTab === "assistant" && (
        <div className="tab-pane">
          <div className="assistant-workspace">
            <section className="chat-card">
              <div className="panel-header">
                <div className="panel-title">
                  <h2>Ask HomePilot</h2>
                  <p>Local AI assistant powered by Ollama (<code>qwen3:4b</code>) with deterministic planner fallback</p>
                </div>
                <div className="status-badge">
                  <Sparkles size={14} style={{ color: "#38bdf8" }} />
                  <span>Local AI Intent Engine</span>
                </div>
              </div>

              {/* Prompt Suggestion Chips */}
              <div className="prompt-suggestions-bar">
                <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" }}>
                  Try asking:
                </span>
                <button
                  type="button"
                  className="prompt-chip"
                  onClick={() => sendQuickPrompt("Reduce my electricity usage by 20%, but keep the fridge safe.")}
                >
                  &ldquo;Reduce electricity by 20%, keep fridge safe&rdquo;
                </button>
                <button
                  type="button"
                  className="prompt-chip"
                  onClick={() => sendQuickPrompt("Keep household usage below 5 kWh.")}
                >
                  &ldquo;Keep usage below 5 kWh&rdquo;
                </button>
                <button
                  type="button"
                  className="prompt-chip"
                  onClick={() => sendQuickPrompt("What is the cheapest feasible plan?")}
                >
                  &ldquo;Cheapest feasible plan?&rdquo;
                </button>
                <button
                  type="button"
                  className="prompt-chip"
                  onClick={() => sendQuickPrompt("Which appliance consumes the most energy?")}
                >
                  &ldquo;Which appliance consumes the most?&rdquo;
                </button>
              </div>

              {/* Messages Area */}
              <div className="chat-history" aria-live="polite">
                {messages.map((message, index) => (
                  <div
                    key={`${index}-${message.role}`}
                    className={`message-bubble ${message.role}`}
                  >
                    <span className="message-sender">{message.role === "user" ? "You" : "HomePilot"}</span>
                    <div className="message-body">{message.text}</div>

                    {message.engine && message.engine !== "system-error" && (
                      <span
                        className={`engine-pill ${
                          message.engine.startsWith("ollama:") ? "ai" : "fallback"
                        }`}
                      >
                        {message.engine.startsWith("ollama:")
                          ? `✨ Local AI (${message.engine.replace("ollama:", "")})`
                          : "⚙️ Deterministic Fallback"}
                      </span>
                    )}

                    {/* Inline Plan Summary Card */}
                    {message.plan && (
                      <div className="inline-plan-card">
                        <div className="inline-plan-header">
                          <span>📊 Optimized Plan Generated</span>
                          <span style={{ color: "var(--emerald-primary)" }}>{message.plan.savings.plannedReductionLabel}</span>
                        </div>
                        <div className="inline-plan-stats">
                          <div className="inline-stat-item">
                            <span className="inline-stat-label">Baseline</span>
                            <span className="inline-stat-value">{message.plan.baseline.totalKwh} kWh</span>
                          </div>
                          <div className="inline-stat-item">
                            <span className="inline-stat-label">Proposed</span>
                            <span className="inline-stat-value">{message.plan.proposed.totalKwh} kWh</span>
                          </div>
                          <div className="inline-stat-item">
                            <span className="inline-stat-label">Saved</span>
                            <span className="inline-stat-value" style={{ color: "var(--emerald-primary)" }}>
                              -{message.plan.savings.estimatedKwhSaved} kWh
                            </span>
                          </div>
                          <div className="inline-stat-item">
                            <span className="inline-stat-label">Protected Circuits</span>
                            <span className="inline-stat-value" style={{ color: "#6ee7b7" }}>
                              {message.plan.protectedDevices?.join(", ") || "None"}
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="secondary-button inline-plan-cta"
                          onClick={() => setActiveTab("plan")}
                        >
                          View Full Plan in Energy Plan Tab <ArrowRight size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                ))}

                {chatLoading && (
                  <div className="message-bubble assistant">
                    <span className="message-sender">HomePilot</span>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--text-secondary)" }}>
                      <LoaderCircle className="spin" size={16} />
                      <span>Evaluating household parameters with MCP tools...</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Chat Input Form */}
              <form className="chat-input-form" onSubmit={sendMessage}>
                <input
                  type="text"
                  className="chat-input-field"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Ask about appliances, reduction goals, or feasibility..."
                  aria-label="Ask HomePilot a question"
                  disabled={chatLoading}
                />
                <button
                  type="submit"
                  className="primary-button"
                  disabled={chatLoading || !chatInput.trim()}
                >
                  {chatLoading ? "Analyzing..." : "Ask"}
                </button>
              </form>
            </section>

            {/* Collapsible Hardware & Telemetry Drawer (Secondary) */}
            <section className="telemetry-collapsible">
              <div
                className="telemetry-toggle-header"
                onClick={() => setShowDiagnostics((prev) => !prev)}
              >
                <div>
                  <h4 style={{ margin: 0, fontSize: "14px", fontWeight: 700 }}>
                    Engineering Diagnostics &amp; Simulated Telemetry
                  </h4>
                  <p style={{ margin: "2px 0 0", fontSize: "12px", color: "var(--text-secondary)" }}>
                    MCP Hardware endpoints: <code>get_energy_usage</code>, <code>get_device_status</code>
                  </p>
                </div>
                <button type="button" className="ghost-button">
                  {showDiagnostics ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>
              </div>

              {showDiagnostics && (
                <div className="telemetry-drawer-body">
                  <div>
                    <h5 style={{ margin: "0 0 10px", fontSize: "13px" }}>
                      Simulated Prototype Fixtures {telemetry ? `(${telemetry.totalKwh} kWh · ${telemetry.date})` : ""}
                    </h5>
                    <div className="telemetry-chip-list">
                      {telemetryDevices.map((d) => (
                        <div key={d.name} className="telemetry-chip-row">
                          <span>{d.name}</span>
                          <span className={`status-badge-inline ${d.status}`}>{d.status}</span>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={loadTelemetry}
                      disabled={telemetryLoading}
                      style={{ marginTop: "12px", padding: "6px 12px", fontSize: "12px" }}
                    >
                      <RefreshCw size={13} className={telemetryLoading ? "spin" : ""} />
                      <span>{telemetryLoading ? "Refreshing..." : "Refresh Readings"}</span>
                    </button>
                  </div>

                  <div>
                    <h5 style={{ margin: "0 0 10px", fontSize: "13px" }}>Algorithmic Telemetry Summary</h5>
                    {!summary ? (
                      <div>
                        <p style={{ fontSize: "12px", color: "var(--text-secondary)", margin: "0 0 10px" }}>
                          Run MCP <code>get_energy_summary</code> to query historical peak consumption.
                        </p>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={generateSummary}
                          disabled={summaryLoading}
                          style={{ padding: "6px 12px", fontSize: "12px" }}
                        >
                          {summaryLoading ? <LoaderCircle className="spin" size={13} /> : <Sparkles size={13} />}
                          <span>{summaryLoading ? "Querying..." : "Run Summary Tool"}</span>
                        </button>
                      </div>
                    ) : (
                      <div style={{ fontSize: "12px", lineHeight: "1.5" }}>
                        <div><strong>Total:</strong> {summary.totalKwh} kWh</div>
                        <div><strong>Peak:</strong> {summary.highestConsumer.name} ({summary.highestConsumer.sharePercent}%)</div>
                        <p style={{ margin: "6px 0 0", color: "var(--text-secondary)" }}>{summary.recommendation}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </section>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: ADD / EDIT APPLIANCE                                               */}
      {/* ========================================================================= */}
      {isModalOpen && (
        <div className="modal-backdrop" onClick={() => setIsModalOpen(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingDeviceId ? "Edit Appliance Parameters" : "Add Appliance to Digital Twin"}</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setIsModalOpen(false)}
                aria-label="Close dialog"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveAppliance} className="modal-form">
              {formError && (
                <div role="alert" className="feasibility-strip partial" style={{ padding: "10px 14px", margin: 0 }}>
                  <AlertCircle size={16} />
                  <p style={{ fontSize: "12px" }}>{formError}</p>
                </div>
              )}

              <div className="modal-row">
                <div className="form-field">
                  <label htmlFor="appliance-name-input">Appliance Display Name *</label>
                  <input
                    id="appliance-name-input"
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="e.g. Living Room AC, Kitchen Fridge"
                    autoFocus
                    required
                  />
                </div>

                <div className="form-field">
                  <label htmlFor="appliance-category-select">Category</label>
                  <select
                    id="appliance-category-select"
                    value={formCategory}
                    onChange={(e) => handleCategoryChange(e.target.value)}
                  >
                    {Object.entries(CATEGORY_METADATA).map(([catKey, meta]) => (
                      <option key={catKey} value={catKey}>
                        {meta.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="modal-row">
                <div className="form-field">
                  <label htmlFor="appliance-room-input">Room / Zone *</label>
                  <input
                    id="appliance-room-input"
                    type="text"
                    value={formRoom}
                    onChange={(e) => setFormRoom(e.target.value)}
                    placeholder="e.g. Living Room, Kitchen, Utility"
                    required
                  />
                </div>

                <div className="form-field">
                  <label htmlFor="appliance-qty-input">Quantity *</label>
                  <input
                    id="appliance-qty-input"
                    type="number"
                    min="1"
                    max="50"
                    step="1"
                    value={formQuantity}
                    onChange={(e) => setFormQuantity(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="modal-row">
                <div className="form-field">
                  <label htmlFor="appliance-watts-input">Rated Power (Watts) *</label>
                  <input
                    id="appliance-watts-input"
                    type="number"
                    min="0"
                    step="1"
                    value={formWatts}
                    onChange={(e) => setFormWatts(e.target.value)}
                    required
                  />
                </div>

                <div className="form-field">
                  <label htmlFor="appliance-hours-input">Daily Operating Window (Hours) *</label>
                  <input
                    id="appliance-hours-input"
                    type="number"
                    min="0"
                    max="24"
                    step="0.5"
                    value={formHours}
                    onChange={(e) => setFormHours(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="form-field">
                <label htmlFor="appliance-duty-input">
                  Compressor / Operating Duty Factor (0.01 – 1.00)
                </label>
                <input
                  id="appliance-duty-input"
                  type="number"
                  min="0.01"
                  max="1.0"
                  step="0.01"
                  value={formDuty}
                  onChange={(e) => setFormDuty(e.target.value)}
                  required
                />
                <small style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "3px" }}>
                  {CATEGORY_METADATA[formCategory]?.dutyNote || "1.00 for continuous operation"}
                </small>
              </div>

              {/* Protection Checkbox */}
              <label className="modal-checkbox-box">
                <input
                  type="checkbox"
                  checked={formProtected}
                  onChange={(e) => setFormProtected(e.target.checked)}
                />
                <div>
                  <strong>Protect Appliance Against Curtailment</strong>
                  <p>
                    Strictly shields this device from all reduction actions and turn-offs during plan generation. (Defaulted for refrigerators and food safety).
                  </p>
                </div>
              </label>

              {/* Live Formula Preview */}
              <div className="formula-preview-box">
                <span className="formula-preview-label">Live Physics Calculation:</span>
                <div className="formula-preview-math">
                  {formQuantity || 1} unit × {formWatts || 0}W × {formHours || 0}h × {formDuty || 1.0} ÷ 1000 ={" "}
                  <strong>{livePreviewKwh} kWh/day</strong>
                </div>
                <span style={{ fontSize: "11px", color: "var(--amber-light)" }}>
                  ~{currency}{(livePreviewKwh * (Number(tariff) || 0.15)).toFixed(2)}/day at {currency}{tariff}/kWh
                </span>
              </div>

              <div className="modal-actions-bar">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setIsModalOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="primary-button">
                  <Check size={16} /> Save Appliance
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: DELETE CONFIRMATION                                                */}
      {/* ========================================================================= */}
      {deleteConfirmDevice && (
        <div className="modal-backdrop" onClick={() => setDeleteConfirmDevice(null)}>
          <div className="modal-dialog confirm-box" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-icon-danger">
              <Trash2 size={24} />
            </div>

            <h3 style={{ margin: "0 0 8px", fontSize: "17px" }}>Confirm Appliance Removal</h3>
            <p style={{ margin: "0 0 16px", fontSize: "13px", color: "var(--text-secondary)" }}>
              Are you sure you want to remove <strong>{deleteConfirmDevice.name}</strong> ({deleteConfirmDevice.room}) from your household twin?
            </p>

            {deleteConfirmDevice.isProtected && (
              <div role="alert" className="feasibility-strip partial" style={{ padding: "10px 14px", marginBottom: "16px" }}>
                <AlertCircle size={16} />
                <p style={{ fontSize: "12px" }}>
                  <strong>Safety Notice:</strong> This device is marked as Protected. Removing it eliminates its safety invariant from planning calculations.
                </p>
              </div>
            )}

            <div className="modal-actions-bar">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setDeleteConfirmDevice(null)}
              >
                Keep Appliance
              </button>
              <button
                type="button"
                className="danger-button"
                onClick={() => handleDeleteDevice(deleteConfirmDevice)}
              >
                <Trash2 size={15} /> Yes, Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: RESET CONFIRMATION                                                 */}
      {/* ========================================================================= */}
      {isResetConfirmOpen && (
        <div className="modal-backdrop" onClick={() => setIsResetConfirmOpen(false)}>
          <div className="modal-dialog confirm-box" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-icon-warning">
              <RotateCcw size={24} />
            </div>

            <h3 style={{ margin: "0 0 8px", fontSize: "17px" }}>Restore Example Household</h3>
            <p style={{ margin: "0 0 16px", fontSize: "13px", color: "var(--text-secondary)" }}>
              This will reset your household model to the documented 4-appliance reference model (AC, Refrigerator, Washer, Lighting).
            </p>

            <div className="modal-actions-bar">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setIsResetConfirmOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={handleResetHousehold}
              >
                <RotateCcw size={15} /> Yes, Restore Defaults
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Architectural Footer */}
      <footer>
        <span>
          <ShieldCheck size={14} style={{ color: "var(--emerald-primary)" }} />
          HOMEPILOT · BUILD, SHIP, SHAPE: AMAZON DEVELOPER HACKATHON · ALEXA+ TRACK
        </span>
        <span>
          Zero Cloud APIs · Deterministic Mathematics · Local AI (Ollama qwen3:4b)
        </span>
      </footer>
    </main>
  );
}

export default App;
