const fs = require("fs");
const path = require("path");
const { DATA_DIR } = require("./daemon");
const { MODEL_PRICING, getModelTier } = require("./collector");

function loadData(from, to) {
  if (!fs.existsSync(DATA_DIR)) return [];

  const files = fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();

  let snapshots = [];
  for (const file of files) {
    const date = file.replace(".json", "");
    if (from && date < from) continue;
    if (to && date > to) continue;
    try {
      const data = JSON.parse(
        fs.readFileSync(path.join(DATA_DIR, file), "utf-8")
      );
      snapshots = snapshots.concat(data);
    } catch {
      // skip corrupt files
    }
  }
  return snapshots;
}

function extractModelTimeSeries(snapshots) {
  const allModels = new Set();
  for (const s of snapshots) {
    if (s.recentHourMetrics?.models) {
      for (const m of Object.keys(s.recentHourMetrics.models)) allModels.add(m);
    }
  }

  const series = {};
  for (const model of allModels) {
    const short = model.replace("claude-", "");
    series[short] = {
      input: snapshots.map(
        (s) => s.recentHourMetrics?.models?.[model]?.input || 0
      ),
      output: snapshots.map(
        (s) => s.recentHourMetrics?.models?.[model]?.output || 0
      ),
      cacheRead: snapshots.map(
        (s) => s.recentHourMetrics?.models?.[model]?.cacheRead || 0
      ),
      cost: snapshots.map(
        (s) =>
          Math.round((s.recentHourMetrics?.models?.[model]?.cost || 0) * 10000) /
          10000
      ),
      responses: snapshots.map(
        (s) => s.recentHourMetrics?.models?.[model]?.responses || 0
      ),
    };
  }
  return series;
}

// ── Formatting ────────────────────────────────────────────────

function fmtNum(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return n.toLocaleString();
}

function fmtHeroCost(n) {
  if (n >= 10) return "$" + Math.round(n).toLocaleString();
  if (n >= 1) return "$" + n.toFixed(1);
  return "$" + n.toFixed(2);
}

function gaugeColor(pct) {
  if (pct > 80) return "#ef4444";
  if (pct > 50) return "#f59e0b";
  return "#22c55e";
}

// ── HTML Builders ─────────────────────────────────────────────

function buildStatsTableHtml(latest) {
  const t = latest.todayMetrics;
  const w = latest.weekMetrics;
  const p = latest.periodMetrics;
  const a = latest.statsCache;
  const v = (m, fn) => (m ? fn(m) : "&mdash;");
  const n = (m) => v(m, (x) => fmtNum(x.messages));
  const s = (m) => v(m, (x) => x.sessions);
  const c = (m) => v(m, (x) => "$" + x.estimatedCost.toFixed(2));
  const o = (m) => v(m, (x) => fmtNum(x.tokens.output));
  const allCol = a
    ? `<th>All Time</th>`
    : "";
  const allCell = (val) => (a ? `<td>${val}</td>` : "");

  return `<table class="stats-table">
    <thead><tr><th></th><th>Today</th><th>This Week</th><th>This Month</th>${allCol}</tr></thead>
    <tbody>
      <tr><td class="rl">Sessions</td><td>${s(t)}</td><td>${s(w)}</td><td>${s(p)}</td>${allCell(a?.totalSessions ?? "&mdash;")}</tr>
      <tr><td class="rl">Messages</td><td>${n(t)}</td><td>${n(w)}</td><td>${n(p)}</td>${allCell(a ? fmtNum(a.totalMessages || 0) : "&mdash;")}</tr>
      <tr class="cost-row"><td class="rl">Cost</td><td>${c(t)}</td><td>${c(w)}</td><td>${c(p)}</td>${allCell("&mdash;")}</tr>
      <tr><td class="rl">Output</td><td>${o(t)}</td><td>${o(w)}</td><td>${o(p)}</td>${allCell("&mdash;")}</tr>
    </tbody>
  </table>`;
}

function buildModelTableHtml(metrics) {
  if (!metrics?.models) return "<p class=\"empty\">No model data</p>";
  const sorted = Object.entries(metrics.models).sort((a, b) => b[1].cost - a[1].cost);
  let rows = "";
  for (const [model, data] of sorted) {
    const short = model.replace("claude-", "");
    const tier = getModelTier(model);
    const tierLabel = tier ? tier.charAt(0).toUpperCase() + tier.slice(1) : "?";
    rows += `<tr>
      <td><span class="model-badge model-${tier}">${tierLabel}</span>${short}</td>
      <td>${data.responses.toLocaleString()}</td>
      <td>${fmtNum(data.input)}</td>
      <td>${fmtNum(data.output)}</td>
      <td>${fmtNum(data.cacheRead)}</td>
      <td>$${data.cost.toFixed(2)}</td>
    </tr>`;
  }
  return `<table>
    <thead><tr><th>Model</th><th>Resp</th><th>Input</th><th>Output</th><th>Cache</th><th>Cost</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function buildPrevMonthsHtml(snapshots) {
  const periods = new Map();
  for (const s of snapshots) {
    if (!s.periodMetrics?.periodStart) continue;
    const month = s.periodMetrics.periodStart.slice(0, 7);
    periods.set(month, s);
  }
  if (periods.size < 2) return "";
  const sorted = [...periods.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  const past = sorted.slice(1);
  if (!past.length) return "";

  let rows = "";
  for (const [, snap] of past) {
    const pm = snap.periodMetrics;
    const label = new Date(pm.periodStart).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
    });
    rows += `<tr>
      <td>${label}</td>
      <td>${pm.sessions}</td>
      <td>${fmtNum(pm.messages)}</td>
      <td>$${pm.estimatedCost.toFixed(2)}</td>
    </tr>`;
  }
  return `
    <div class="prev-months">
      <h3 class="section-title">Previous Months</h3>
      <table>
        <thead><tr><th>Month</th><th>Sess</th><th>Msgs</th><th>Cost</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ── Main Generator ────────────────────────────────────────────

function generateHtml(snapshots, outputPath) {
  if (!snapshots.length) {
    fs.writeFileSync(
      outputPath,
      "<!DOCTYPE html><html><body style=\"font-family:Inter,sans-serif;display:grid;place-items:center;height:100vh\"><h1>No data yet</h1></body></html>"
    );
    return outputPath;
  }

  const isoTimes = snapshots.map((s) => s.isoTime);
  const activeSessions = snapshots.map((s) => s.activeSessionCount);
  const messages = snapshots.map((s) => s.recentHourMetrics.messages);
  const toolCalls = snapshots.map((s) => s.recentHourMetrics.toolCalls);
  const inputTokens = snapshots.map((s) => s.recentHourMetrics.tokens.input);
  const outputTokens = snapshots.map((s) => s.recentHourMetrics.tokens.output);
  const cacheRead = snapshots.map((s) => s.recentHourMetrics.tokens.cacheRead);
  const cacheWrite = snapshots.map((s) => s.recentHourMetrics.tokens.cacheWrite);
  const cost = snapshots.map((s) => s.recentHourMetrics.estimatedCost);
  const costToday = snapshots.map((s) => s.todayMetrics?.estimatedCost || 0);
  const costWeek = snapshots.map((s) => s.weekMetrics?.estimatedCost || 0);
  const costPeriod = snapshots.map((s) => s.periodMetrics?.estimatedCost || 0);
  const totalFiles = snapshots.map((s) => s.totalSessionFiles);
  const diskUsage = snapshots.map(
    (s) => Math.round((s.totalDiskUsage / 1024 / 1024) * 100) / 100
  );
  const sessionUtil = snapshots.map((s) => s.rateLimits?.sessionUtilization ?? null);
  const weeklyUtil = snapshots.map((s) => s.rateLimits?.weeklyUtilization ?? null);

  // reset annotations for rate limit chart
  const sessionResets = new Set();
  const weeklyResets = new Set();
  for (const s of snapshots) {
    if (s.rateLimits?.sessionResetAt) sessionResets.add(s.rateLimits.sessionResetAt);
    if (s.rateLimits?.weeklyResetAt) weeklyResets.add(s.rateLimits.weeklyResetAt);
  }
  const fmtReset = (iso) => {
    const d = new Date(iso);
    return (
      d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) +
      " " +
      d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })
    );
  };
  const resetAnnotations = [];
  for (const r of sessionResets) {
    resetAnnotations.push({ time: r, label: `Session reset ${fmtReset(r)}`, color: "#ef4444" });
  }
  for (const r of weeklyResets) {
    resetAnnotations.push({ time: r, label: `Weekly reset ${fmtReset(r)}`, color: "#3b82f6" });
  }

  const latest = snapshots[snapshots.length - 1];
  const latestWithLimits =
    [...snapshots].reverse().find((s) => s.rateLimits?.sessionUtilization != null) || latest;

  // hero data
  const heroCost = latest.periodMetrics?.estimatedCost ?? latest.todayMetrics?.estimatedCost ?? 0;
  const heroPeriodLabel = latest.periodMetrics
    ? new Date(latest.periodMetrics.periodStart).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      })
    : "Current Period";
  const heroSessionPct = latestWithLimits?.rateLimits?.sessionUtilization;
  const heroWeeklyPct = latestWithLimits?.rateLimits?.weeklyUtilization;
  const sessionResetAt = latestWithLimits?.rateLimits?.sessionResetAt;
  const weeklyResetAt = latestWithLimits?.rateLimits?.weeklyResetAt;
  const rlStatus = latestWithLimits?.rateLimits?.status;
  const rlOverage = latestWithLimits?.rateLimits?.overageStatus;

  // stats table
  const statsTable = buildStatsTableHtml(latest);

  // bottom grid
  const modelTable = buildModelTableHtml(latest.periodMetrics);
  const prevMonths = buildPrevMonthsHtml(snapshots);

  // hero gauge html with reset times
  const fmtResetLabel = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    const day = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    const time = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    return `${day} ${time}`;
  };

  const heroSessionGauge =
    heroSessionPct != null
      ? `<div class="hero-metric gauge">
          <div class="hero-number secondary">${heroSessionPct}%</div>
          <div class="hero-label">Session (5h)</div>
          <div class="hero-gauge"><div class="hero-gauge-fill" style="width:${Math.min(heroSessionPct, 100)}%;background:${gaugeColor(heroSessionPct)}"></div></div>
          ${sessionResetAt ? `<div class="hero-reset">Resets ${fmtResetLabel(sessionResetAt)}</div>` : ""}
        </div>`
      : "";
  const heroWeeklyGauge =
    heroWeeklyPct != null
      ? `<div class="hero-metric gauge">
          <div class="hero-number secondary">${heroWeeklyPct}%</div>
          <div class="hero-label">Weekly (7d)</div>
          <div class="hero-gauge"><div class="hero-gauge-fill" style="width:${Math.min(heroWeeklyPct, 100)}%;background:${gaugeColor(heroWeeklyPct)}"></div></div>
          ${weeklyResetAt ? `<div class="hero-reset">Resets ${fmtResetLabel(weeklyResetAt)}</div>` : ""}
        </div>`
      : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Claude Code Monitor</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3"></script>
<script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation@3"></script>
<script src="https://cdn.jsdelivr.net/npm/hammerjs@2"></script>
<script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-zoom@2"></script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #f8f8f8;
    --surface: #fff;
    --border: #e5e5e5;
    --border-light: #f0f0f0;
    --text: #111;
    --text-secondary: #555;
    --text-muted: #999;
    --accent: #6366f1;
    --accent-hover: #4f46e5;
    --accent-light: rgba(99,102,241,0.07);
    --green: #22c55e;
    --amber: #f59e0b;
    --red: #ef4444;
    --blue: #3b82f6;
    --radius: 10px;
    --shadow: 0 1px 2px rgba(0,0,0,0.04);
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    background: var(--bg); color: var(--text);
    padding: 48px 40px; max-width: 1440px; margin: 0 auto;
    line-height: 1.5; -webkit-font-smoothing: antialiased;
  }

  /* Header */
  .page-header { margin-bottom: 48px; }
  .page-header h1 { font-size: 1.1em; font-weight: 700; color: var(--text-muted); letter-spacing: 0.05em; text-transform: uppercase; }
  .page-header .meta { font-size: 0.75em; color: var(--text-muted); margin-top: 4px; }

  /* Hero */
  .hero {
    display: flex; align-items: flex-start; gap: 64px;
    padding-bottom: 48px; border-bottom: 1px solid var(--border); margin-bottom: 48px;
  }
  .hero-metric {}
  .hero-number { font-size: 3em; font-weight: 800; color: var(--text); line-height: 1; }
  .hero-number.secondary { font-size: 2.2em; }
  .hero-label { font-size: 0.7em; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.1em; margin-top: 8px; font-weight: 600; }
  .hero-metric.gauge { flex: 1; min-width: 180px; }
  .hero-gauge { width: 100%; height: 8px; background: var(--border); border-radius: 4px; margin-top: 10px; }
  .hero-gauge-fill { height: 100%; border-radius: 4px; transition: width 0.3s; }
  .hero-reset { font-size: 0.7em; color: var(--text-muted); margin-top: 6px; letter-spacing: 0.02em; }
  .hero-note { font-size: 0.72em; color: var(--text-muted); margin-top: 12px; }

  /* Stats table */
  .stats-wrap { margin-bottom: 48px; }
  .stats-table { width: 100%; }
  .stats-table th { text-align: right; padding: 6px 20px; font-size: 0.7em; }
  .stats-table th:first-child { text-align: left; }
  .stats-table td { text-align: right; padding: 6px 20px; font-variant-numeric: tabular-nums; font-weight: 600; }
  .stats-table .rl { text-align: left; font-weight: 400; color: var(--text-secondary); }
  .stats-table .cost-row td { color: var(--accent); }
  .stats-table .cost-row .rl { color: var(--text-secondary); }
  .system-bar {
    font-size: 0.75em; color: var(--text-muted); margin-top: 12px;
    display: flex; gap: 24px; flex-wrap: wrap;
  }
  .system-bar span { white-space: nowrap; }

  /* Section titles */
  .section-title {
    font-size: 0.85em; font-weight: 700; color: var(--text);
    margin-bottom: 16px; letter-spacing: -0.01em;
  }

  /* Chart boxes */
  .chart-box {
    background: var(--surface); border-radius: var(--radius);
    padding: 16px; border: 1px solid var(--border);
    box-shadow: var(--shadow);
  }
  .chart-box h3 {
    font-size: 0.72em; color: var(--text-muted); margin-bottom: 10px;
    font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;
  }
  .chart-header {
    display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;
  }
  .chart-header h3 { margin-bottom: 0; }
  .chart-actions { display: flex; gap: 6px; }

  /* Full-width chart sections */
  .chart-section { margin-bottom: 48px; }
  .chart-section .chart-box canvas { max-height: 280px; }

  /* Chart grids */
  .chart-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 48px; }
  .chart-grid-2 canvas { max-height: 220px; }

  /* Full-width sections */
  .full-section { margin-bottom: 48px; }
  .prev-months { margin-top: 24px; }

  /* Tables */
  table { width: 100%; border-collapse: separate; border-spacing: 0; }
  th, td { padding: 8px 12px; text-align: left; font-size: 0.8em; }
  th {
    color: var(--text-muted); font-weight: 600; text-transform: uppercase;
    font-size: 0.65em; letter-spacing: 0.6px; border-bottom: 2px solid var(--border);
  }
  td { border-bottom: 1px solid var(--border-light); }
  tbody tr { transition: background 200ms; }
  tbody tr:hover { background: var(--accent-light); }
  .empty { color: var(--text-muted); font-size: 0.85em; padding: 16px 0; }

  /* Model badges */
  .model-badge {
    display: inline-block; padding: 2px 7px; border-radius: 4px;
    font-size: 0.7em; font-weight: 700; color: #fff; margin-right: 6px;
  }
  .model-opus { background: #7c3aed; }
  .model-sonnet { background: #2563eb; }
  .model-haiku { background: #059669; }
  .model-null { background: var(--text-muted); }

  /* Buttons */
  .csv-btn, .fs-btn {
    font-size: 11px; padding: 3px 8px; border: 1px solid var(--border);
    border-radius: 5px; background: var(--surface); color: var(--text-muted);
    cursor: pointer; font-family: inherit; transition: all 200ms;
  }
  .csv-btn:hover, .fs-btn:hover { color: var(--accent); border-color: var(--accent); }
  .btn-reset-zoom {
    background: var(--accent); color: #fff; border: none; border-radius: 6px;
    padding: 5px 12px; font-size: 0.72em; cursor: pointer; font-weight: 600;
  }
  .btn-reset-zoom:hover { background: var(--accent-hover); }

  /* Fullscreen */
  .chart-box.fullscreen {
    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
    z-index: 9999; border-radius: 0; padding: 32px; overflow: auto;
  }
  .chart-box.fullscreen canvas { max-height: calc(100vh - 90px) !important; }

  /* Snapshot filters */
  .filter-bar {
    display: flex; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; align-items: center;
  }
  .filter-bar label {
    font-size: 0.75em; color: var(--text-muted); font-weight: 600;
  }
  .filter-bar select {
    padding: 4px 8px; border: 1px solid var(--border); border-radius: 4px;
    font-size: 12px; font-family: inherit;
  }
  .snapshot-count { font-size: 0.72em; color: var(--text-muted); }

  /* Rate limits chart */
  .rl-chart canvas { max-height: 300px; }
  .toggle-label {
    font-size: 11px; font-weight: 400; text-transform: none;
    letter-spacing: 0; cursor: pointer; user-select: none; color: var(--text-muted);
  }
  .toggle-label input { margin-right: 4px; cursor: pointer; }

  /* Zoom hint */
  .zoom-bar {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 24px;
  }
  .zoom-hint { font-size: 0.72em; color: var(--text-muted); }

  /* Snapshot table scroll */
  .snapshot-scroll { max-height: 700px; overflow-y: auto; }

  @media (max-width: 960px) {
    body { padding: 24px 16px; }
    .hero { flex-direction: column; gap: 24px; }
    .chart-grid-2 { grid-template-columns: 1fr; }
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { transition-duration: 0.01ms !important; }
  }
</style>
</head>
<body>

<!-- Header -->
<div class="page-header">
  <h1>Claude Code Monitor</h1>
  <p class="meta">${snapshots.length} snapshots &middot; ${isoTimes[0]?.slice(0, 16).replace("T", " ") || "N/A"} &ndash; ${isoTimes[isoTimes.length - 1]?.slice(0, 16).replace("T", " ") || "N/A"}</p>
</div>

<!-- Hero -->
<div class="hero">
  <div class="hero-metric">
    <div class="hero-number">${fmtHeroCost(heroCost)}</div>
    <div class="hero-label">Est. Cost &middot; ${heroPeriodLabel}</div>
    ${rlStatus ? `<div class="hero-note">${rlStatus}${rlOverage && rlOverage !== "N/A" ? " &middot; Overage: " + rlOverage : ""}</div>` : ""}
  </div>
  ${heroSessionGauge}
  ${heroWeeklyGauge}
</div>

<!-- Stats -->
<div class="stats-wrap">
  ${statsTable}
  <div class="system-bar">
    <span>${totalFiles[totalFiles.length - 1] || 0} session files</span>
    <span>${diskUsage[diskUsage.length - 1] || 0} MB disk</span>
    <span>Peak: ${Math.max(...activeSessions, 0)} active, ${fmtNum(Math.max(...messages, 0))} msgs/hr</span>
  </div>
</div>

<!-- Rate Limits -->
<div class="chart-section rl-chart">
  <div class="chart-box">
    <div class="chart-header">
      <h3 style="display:flex;align-items:center;gap:10px">
        Rate Limit Utilization
        <label class="toggle-label"><input type="checkbox" id="toggleResets">Reset lines</label>
      </h3>
      <span class="chart-actions">
        <button class="csv-btn" onclick="exportCSV('chartRateLimits')">CSV</button>
        <button class="fs-btn" onclick="toggleFullscreen(this)">&#x26F6;</button>
      </span>
    </div>
    <canvas id="chartRateLimits"></canvas>
  </div>
</div>

<!-- Full-width charts -->
<div class="zoom-bar">
  <span class="section-title" style="margin-bottom:0">Time Series</span>
  <span style="display:flex;align-items:center;gap:12px">
    <span class="zoom-hint">Drag to zoom &middot; Scroll to zoom &middot; Double-click to reset</span>
    <button class="btn-reset-zoom" onclick="resetAllZoom()">Reset Zoom</button>
  </span>
</div>

<div class="chart-section">
  <div class="chart-box">
    <div class="chart-header">
      <h3>Estimated Cost ($)</h3>
      <span class="chart-actions">
        <button class="csv-btn" onclick="exportCSV('chartCost')">CSV</button>
        <button class="fs-btn" onclick="toggleFullscreen(this)">&#x26F6;</button>
      </span>
    </div>
    <canvas id="chartCost"></canvas>
  </div>
</div>

<div class="chart-section">
  <div class="chart-box">
    <div class="chart-header">
      <h3>Token Usage (recent hour)</h3>
      <span class="chart-actions">
        <button class="csv-btn" onclick="exportCSV('chartTokens')">CSV</button>
        <button class="fs-btn" onclick="toggleFullscreen(this)">&#x26F6;</button>
      </span>
    </div>
    <canvas id="chartTokens"></canvas>
  </div>
</div>

<!-- Model Breakdown (full width) -->
<div class="full-section">
  <div class="section-title">Model Breakdown &middot; ${heroPeriodLabel}</div>
  <div class="chart-box">
    ${modelTable}
    ${prevMonths}
  </div>
</div>

<!-- Secondary charts: 2x2 -->
<div class="chart-grid-2">
  <div class="chart-box">
    <div class="chart-header">
      <h3>Active Sessions</h3>
      <span class="chart-actions"><button class="csv-btn" onclick="exportCSV('chartSessions')">CSV</button><button class="fs-btn" onclick="toggleFullscreen(this)">&#x26F6;</button></span>
    </div>
    <canvas id="chartSessions"></canvas>
  </div>
  <div class="chart-box">
    <div class="chart-header">
      <h3>Messages (recent hour)</h3>
      <span class="chart-actions"><button class="csv-btn" onclick="exportCSV('chartMessages')">CSV</button><button class="fs-btn" onclick="toggleFullscreen(this)">&#x26F6;</button></span>
    </div>
    <canvas id="chartMessages"></canvas>
  </div>
  <div class="chart-box">
    <div class="chart-header">
      <h3>Tool Calls (recent hour)</h3>
      <span class="chart-actions"><button class="csv-btn" onclick="exportCSV('chartToolCalls')">CSV</button><button class="fs-btn" onclick="toggleFullscreen(this)">&#x26F6;</button></span>
    </div>
    <canvas id="chartToolCalls"></canvas>
  </div>
  <div class="chart-box">
    <div class="chart-header">
      <h3>Disk Usage &amp; Session Files</h3>
      <span class="chart-actions"><button class="csv-btn" onclick="exportCSV('chartDisk')">CSV</button><button class="fs-btn" onclick="toggleFullscreen(this)">&#x26F6;</button></span>
    </div>
    <canvas id="chartDisk"></canvas>
  </div>
</div>

<!-- Snapshots (full width, at end) -->
<div class="full-section">
  <div class="section-title" style="display:flex;align-items:center;justify-content:space-between">
    Snapshots
    <button class="csv-btn" onclick="exportSnapshotCSV()">Export CSV</button>
  </div>
  <div class="chart-box">
    <div class="filter-bar">
      <label>Day: <select id="filterDay" onchange="filterSnapshots()"></select></label>
      <label>Session: <select id="filterSession" onchange="filterSnapshots()" style="max-width:320px"></select></label>
      <span id="snapshotCount" class="snapshot-count"></span>
    </div>
    <div class="snapshot-scroll">
      <table>
        <thead><tr><th>Time</th><th>Sess%</th><th>Week%</th><th>Active</th><th>Msgs/hr</th><th>Tools/hr</th><th>Cost/hr</th><th>Cost (day)</th><th>Output</th><th>Cache Read</th></tr></thead>
        <tbody id="snapshotBody"></tbody>
      </table>
    </div>
  </div>
</div>

<script>
const labels = ${JSON.stringify(isoTimes)};
const allCharts = [];
const chartById = {};

const chartOpts = () => ({
  responsive: true,
  maintainAspectRatio: true,
  plugins: {
    legend: { display: true, labels: { color: '#888', font: { size: 10 } } },
    zoom: {
      zoom: {
        drag: { enabled: true, backgroundColor: 'rgba(99,102,241,0.1)', borderColor: '#6366f1', borderWidth: 1 },
        wheel: { enabled: true, speed: 0.05 },
        mode: 'x',
      },
      pan: { enabled: true, mode: 'x', modifierKey: 'ctrl' },
      limits: { x: { minRange: 60000 } },
    }
  },
  scales: {
    x: {
      type: 'time',
      time: {
        tooltipFormat: 'EEE, MMM d, HH:mm',
        displayFormats: { minute: 'HH:mm', hour: 'HH:mm', day: 'EEE, MMM d', week: 'MMM d', month: 'MMM yyyy' }
      },
      ticks: {
        color: '#aaa',
        maxTicksLimit: 14,
        callback: function(value, index, ticks) {
          const d = new Date(value);
          const prev = index > 0 ? new Date(ticks[index - 1].value) : null;
          if (!prev || d.toDateString() !== prev.toDateString()) {
            return [d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
                    d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })];
          }
          return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
        }
      },
      grid: { color: '#f0f0f0' }
    },
    y: { beginAtZero: true, ticks: { color: '#aaa' }, grid: { color: '#f0f0f0' } }
  }
});

const makeDs = (label, data, color, fill = false) => ({
  label, data: data.map((v, i) => ({ x: labels[i], y: v })),
  borderColor: color, backgroundColor: fill ? color + '18' : undefined,
  fill, tension: 0.3, pointRadius: labels.length > 200 ? 0 : 1.5, borderWidth: 2, spanGaps: true
});

function registerChart(chart) {
  allCharts.push(chart);
  chartById[chart.canvas.id] = chart;
  chart.canvas.addEventListener('dblclick', () => chart.resetZoom());
  return chart;
}

function resetAllZoom() { allCharts.forEach(c => c.resetZoom()); }

function toggleFullscreen(btn) {
  const box = btn.closest('.chart-box');
  const isFs = box.classList.toggle('fullscreen');
  btn.textContent = isFs ? '\\u2716' : '\\u26F6';
  const canvas = box.querySelector('canvas');
  if (canvas && chartById[canvas.id]) setTimeout(() => chartById[canvas.id].resize(), 50);
}

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    const fs = document.querySelector('.chart-box.fullscreen');
    if (fs) {
      fs.classList.remove('fullscreen');
      fs.querySelector('.fs-btn').textContent = '\\u26F6';
      const canvas = fs.querySelector('canvas');
      if (canvas && chartById[canvas.id]) setTimeout(() => chartById[canvas.id].resize(), 50);
    }
  }
});

function exportCSV(chartId) {
  const chart = chartById[chartId];
  if (!chart) return;
  const ds = chart.data.datasets || [];
  const header = ['Time', ...ds.map(d => d.label || 'Value')];
  const len = Math.max(...ds.map(d => d.data.length), 0);
  const rows = [];
  for (let i = 0; i < len; i++) {
    const time = ds[0]?.data[i]?.x || '';
    rows.push([time, ...ds.map(d => d.data[i]?.y ?? '')]);
  }
  const csv = [header, ...rows].map(r => r.map(v => typeof v === 'string' && v.includes(',') ? '"' + v + '"' : v).join(',')).join('\\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = chartId + '.csv';
  a.click();
}

// Rate Limits chart
(() => {
  const resets = ${JSON.stringify(Array.from(resetAnnotations))};
  const annotations = {};
  resets.forEach((r, i) => {
    annotations['reset' + i] = {
      type: 'line', xMin: r.time, xMax: r.time,
      borderColor: r.color, borderWidth: 2, borderDash: [6, 4],
      display: false,
      label: {
        display: true, content: r.label, position: 'end',
        backgroundColor: r.color, color: '#fff',
        font: { size: 10, weight: 'bold' }, padding: { x: 6, y: 3 }, borderRadius: 4,
      }
    };
  });
  const rlOpts = chartOpts();
  rlOpts.scales.y = { ...rlOpts.scales.y, min: 0, max: 100, ticks: { ...rlOpts.scales.y.ticks, callback: v => v + '%' } };
  rlOpts.plugins.annotation = { annotations };
  const rlChart = registerChart(new Chart(document.getElementById('chartRateLimits'), {
    type: 'line',
    data: { datasets: [
      makeDs('Session (5h)', ${JSON.stringify(sessionUtil)}, '#ef4444', true),
      makeDs('Weekly (7d)', ${JSON.stringify(weeklyUtil)}, '#3b82f6', true),
    ] },
    options: rlOpts
  }));
  document.getElementById('toggleResets').addEventListener('change', function() {
    const show = this.checked;
    Object.keys(rlChart.options.plugins.annotation.annotations).forEach(k => {
      rlChart.options.plugins.annotation.annotations[k].display = show;
    });
    rlChart.update();
  });
})();

// Cost chart
registerChart(new Chart(document.getElementById('chartCost'), {
  type: 'line', data: { datasets: [
    makeDs('Last hour', ${JSON.stringify(cost)}, '#d97706', true),
    makeDs('Today', ${JSON.stringify(costToday)}, '#6366f1'),
    makeDs('Week', ${JSON.stringify(costWeek)}, '#3b82f6'),
    makeDs('Period', ${JSON.stringify(costPeriod)}, '#059669'),
  ] }, options: chartOpts()
}));

// Token chart
registerChart(new Chart(document.getElementById('chartTokens'), {
  type: 'line', data: { datasets: [
    makeDs('Input', ${JSON.stringify(inputTokens)}, '#6366f1'),
    makeDs('Output', ${JSON.stringify(outputTokens)}, '#3b82f6'),
    makeDs('Cache Read', ${JSON.stringify(cacheRead)}, '#059669'),
    makeDs('Cache Write', ${JSON.stringify(cacheWrite)}, '#d97706'),
  ] }, options: chartOpts()
}));

// Secondary charts
registerChart(new Chart(document.getElementById('chartSessions'), {
  type: 'line', data: { datasets: [makeDs('Active Sessions', ${JSON.stringify(activeSessions)}, '#6366f1', true)] }, options: chartOpts()
}));
registerChart(new Chart(document.getElementById('chartMessages'), {
  type: 'line', data: { datasets: [makeDs('Messages', ${JSON.stringify(messages)}, '#3b82f6', true)] }, options: chartOpts()
}));
registerChart(new Chart(document.getElementById('chartToolCalls'), {
  type: 'line', data: { datasets: [makeDs('Tool Calls', ${JSON.stringify(toolCalls)}, '#059669', true)] }, options: chartOpts()
}));
registerChart(new Chart(document.getElementById('chartDisk'), {
  type: 'line', data: { datasets: [
    makeDs('Disk (MB)', ${JSON.stringify(diskUsage)}, '#ec4899'),
    makeDs('Session Files', ${JSON.stringify(totalFiles)}, '#d97706'),
  ] }, options: chartOpts()
}));

// Snapshot table
const snapshotData = ${JSON.stringify(
    snapshots.map((s) => ({
      ts: s.timestamp,
      iso: s.isoTime,
      date: s.isoTime.slice(0, 10),
      rl5: s.rateLimits?.sessionUtilization,
      rl7: s.rateLimits?.weeklyUtilization,
      active: s.activeSessionCount,
      msgs: s.recentHourMetrics.messages,
      tools: s.recentHourMetrics.toolCalls,
      costHr: Math.round(s.recentHourMetrics.estimatedCost * 100) / 100,
      costDay: Math.round((s.todayMetrics?.estimatedCost || 0) * 100) / 100,
      output: s.recentHourMetrics.tokens.output,
      cacheRead: s.recentHourMetrics.tokens.cacheRead,
      sessions: (s.activeSessions || []).map(
        (a) => a.sessionId.slice(0, 8) + " (" + a.project.replace(/-Users-[^-]+-/, "~/").slice(0, 30) + ")"
      ),
    }))
  )};

(() => {
  const daySelect = document.getElementById('filterDay');
  const sessionSelect = document.getElementById('filterSession');
  const tbody = document.getElementById('snapshotBody');
  const countEl = document.getElementById('snapshotCount');

  const days = [...new Set(snapshotData.map(s => s.date))].sort().reverse();
  const allSessions = [...new Set(snapshotData.flatMap(s => s.sessions))].sort();

  daySelect.innerHTML = '<option value="">All</option>' + days.map(d => '<option value="' + d + '">' + d + '</option>').join('');
  sessionSelect.innerHTML = '<option value="">All</option>' + allSessions.map(s => '<option value="' + s + '">' + s + '</option>').join('');

  window.exportSnapshotCSV = function() {
    const dayVal = daySelect.value;
    const sessVal = sessionSelect.value;
    let filtered = snapshotData;
    if (dayVal) filtered = filtered.filter(s => s.date === dayVal);
    if (sessVal) filtered = filtered.filter(s => s.sessions.includes(sessVal));
    const header = ['Time','Session%','Weekly%','Active','Msgs/hr','Tools/hr','Cost/hr','Cost (day)','Output','Cache Read'];
    const rows = filtered.slice().reverse().map(s => {
      const d = new Date(s.ts);
      return [s.iso, s.rl5 != null ? s.rl5 : '', s.rl7 != null ? s.rl7 : '', s.active, s.msgs, s.tools, s.costHr, s.costDay, s.output, s.cacheRead];
    });
    const csv = [header, ...rows].map(r => r.join(',')).join('\\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'snapshots' + (dayVal ? '_' + dayVal : '') + '.csv';
    a.click();
  };

  window.filterSnapshots = function() {
    const dayVal = daySelect.value;
    const sessVal = sessionSelect.value;
    let filtered = snapshotData;
    if (dayVal) filtered = filtered.filter(s => s.date === dayVal);
    if (sessVal) filtered = filtered.filter(s => s.sessions.includes(sessVal));

    const rows = filtered.slice().reverse().slice(0, 500).map(s => {
      const d = new Date(s.ts);
      const dateStr = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      const timeStr = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
      return '<tr>' +
        '<td style="white-space:nowrap">' + dateStr + ' ' + timeStr + '</td>' +
        '<td>' + (s.rl5 != null ? s.rl5 + '%' : '-') + '</td>' +
        '<td>' + (s.rl7 != null ? s.rl7 + '%' : '-') + '</td>' +
        '<td>' + s.active + '</td>' +
        '<td>' + s.msgs.toLocaleString() + '</td>' +
        '<td>' + s.tools.toLocaleString() + '</td>' +
        '<td>$' + s.costHr.toFixed(2) + '</td>' +
        '<td style="font-weight:600">$' + s.costDay.toFixed(2) + '</td>' +
        '<td>' + s.output.toLocaleString() + '</td>' +
        '<td>' + s.cacheRead.toLocaleString() + '</td>' +
        '</tr>';
    });
    tbody.innerHTML = rows.join('');
    countEl.textContent = filtered.length + ' snapshots' + (filtered.length > 500 ? ' (showing 500)' : '');
  };
  filterSnapshots();
})();
</script>
</body>
</html>`;

  fs.writeFileSync(outputPath, html);
  return outputPath;
}

module.exports = { loadData, generateHtml };
