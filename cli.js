#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawn, execSync } = require("child_process");
const { PID_FILE, LOG_FILE, DATA_DIR, REPORT_FILE, HOME_DIR, MENUBAR_PID_FILE } = require("./daemon");
const { collectSnapshot, collectSnapshotWithLimits, fetchRateLimits, getModelTier } = require("./collector");
const { loadData, generateHtml } = require("./chart");

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
  gray: "\x1b[90m",
  white: "\x1b[37m",
};

const paint = (color, text) => `${c[color]}${text}${c.reset}`;

function readPid() {
  if (!fs.existsSync(PID_FILE)) return null;
  const pid = parseInt(fs.readFileSync(PID_FILE, "utf-8").trim());
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    fs.unlinkSync(PID_FILE);
    return null;
  }
}

function readMenubarPid() {
  if (!fs.existsSync(MENUBAR_PID_FILE)) return null;
  const pid = parseInt(fs.readFileSync(MENUBAR_PID_FILE, "utf-8").trim());
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    fs.unlinkSync(MENUBAR_PID_FILE);
    return null;
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function formatNum(n) {
  return n.toLocaleString();
}

function formatTokens(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function makeBar(pct, width = 40) {
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  const color = pct > 80 ? "red" : pct > 50 ? "yellow" : "green";
  return paint(color, "\u2588".repeat(filled)) + paint("dim", "\u2591".repeat(empty));
}

const commands = {
  start() {
    const existingPid = readPid();
    if (existingPid) {
      console.log(paint("yellow", `Daemon already running (PID: ${existingPid})`));
      return;
    }

    const child = spawn(process.execPath, [path.join(__dirname, "daemon.js")], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();

    setTimeout(() => {
      const pid = readPid();
      if (pid) {
        console.log(paint("green", `Daemon started (PID: ${pid})`));
        console.log(paint("dim", "Collecting snapshots every 5 minutes"));
        console.log(paint("dim", `Report: ${REPORT_FILE}`));
      } else {
        console.log(paint("red", "Failed to start daemon"));
      }
    }, 500);
  },

  stop() {
    const pid = readPid();
    if (!pid) {
      console.log(paint("yellow", "Daemon is not running"));
      return;
    }
    process.kill(pid, "SIGTERM");
    console.log(paint("green", `Daemon stopped (PID: ${pid})`));
  },

  status() {
    const pid = readPid();
    console.log(paint("bold", "Claude Code Monitor") + " " + paint("dim", "v1.0.0"));
    console.log();

    if (pid) {
      console.log(paint("green", "  RUNNING") + paint("dim", ` (PID: ${pid})`));
    } else {
      console.log(paint("red", "  STOPPED"));
    }
    console.log();

    if (fs.existsSync(DATA_DIR)) {
      const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"));
      let totalSnapshots = 0;
      let oldestDate = null;
      let newestDate = null;

      for (const f of files) {
        const date = f.replace(".json", "");
        if (!oldestDate || date < oldestDate) oldestDate = date;
        if (!newestDate || date > newestDate) newestDate = date;
        try {
          const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf-8"));
          totalSnapshots += data.length;
        } catch {}
      }

      console.log(paint("cyan", "  Data:"));
      console.log(`    Files:     ${files.length} day(s)`);
      console.log(`    Snapshots: ${totalSnapshots}`);
      if (oldestDate) console.log(`    Range:     ${oldestDate} to ${newestDate}`);
      console.log(`    Report:    ${REPORT_FILE}`);
    } else {
      console.log(paint("dim", "  No data collected yet"));
    }
    console.log();

    if (fs.existsSync(LOG_FILE)) {
      const lines = fs.readFileSync(LOG_FILE, "utf-8").trim().split("\n");
      console.log(paint("cyan", "  Recent log:"));
      for (const line of lines.slice(-5)) {
        console.log(paint("dim", `    ${line}`));
      }
    }
  },

  stats(args) {
    const date = args[0] || new Date().toISOString().slice(0, 10);
    const snapshots = loadData(date, date);

    if (!snapshots.length) {
      console.log(paint("yellow", `No data for ${date}`));
      console.log(paint("dim", "Is the daemon running? Use: node cli.js start"));
      return;
    }

    const last = snapshots[snapshots.length - 1];

    console.log(paint("bold", `Claude Code Stats`) + paint("dim", ` [${date}]`));
    console.log(paint("dim", `${snapshots.length} snapshots\n`));

    // rate limits from latest snapshot
    if (last.rateLimits) {
      const rl = last.rateLimits;
      console.log(paint("yellow", "  Rate Limits"));
      console.log(`    Session (5h):   ${makeBar(rl.sessionUtilization)} ${rl.sessionUtilization}%`);
      console.log(`    Weekly  (7d):   ${makeBar(rl.weeklyUtilization)} ${rl.weeklyUtilization}%`);
      if (rl.sessionResetAt) console.log(paint("dim", `    Session resets:  ${new Date(rl.sessionResetAt).toLocaleString()}`));
      if (rl.weeklyResetAt) console.log(paint("dim", `    Weekly resets:   ${new Date(rl.weeklyResetAt).toLocaleString()}`));
      console.log();
    }

    const peakActive = Math.max(...snapshots.map((s) => s.activeSessionCount));
    const peakMsgs = Math.max(...snapshots.map((s) => s.recentHourMetrics.messages));
    const peakTools = Math.max(...snapshots.map((s) => s.recentHourMetrics.toolCalls));

    console.log(paint("magenta", "  Sessions"));
    console.log(`    Total files:    ${last.totalSessionFiles}`);
    console.log(`    Peak active:    ${peakActive}`);
    console.log(`    Disk usage:     ${formatBytes(last.totalDiskUsage)}`);
    console.log();

    console.log(paint("blue", "  Activity (hourly snapshots)"));
    console.log(`    Peak msgs/hr:   ${formatNum(peakMsgs)}`);
    console.log(`    Peak tools/hr:  ${formatNum(peakTools)}`);
    console.log();

    if (last.todayMetrics) {
      const tm = last.todayMetrics;
      console.log(paint("cyan", "  Today's Usage"));
      console.log(`    Sessions:       ${tm.sessions}`);
      console.log(`    Messages:       ${formatNum(tm.messages)}`);
      console.log(`    Est. cost:      $${tm.estimatedCost.toFixed(4)}`);
      console.log();

      if (Object.keys(tm.models).length > 0) {
        console.log(paint("cyan", "  Today's Models"));
        for (const [model, data] of Object.entries(tm.models)) {
          const short = model.replace("claude-", "");
          const tier = getModelTier(model);
          const badge = tier ? `[${tier.toUpperCase()}]` : "[???]";
          console.log(`    ${paint("magenta", badge.padEnd(9))} ${short}`);
          console.log(
            `              in: ${formatTokens(data.input).padStart(8)}  out: ${formatTokens(data.output).padStart(8)}  cache_r: ${formatTokens(data.cacheRead).padStart(8)}  cache_w: ${formatTokens(data.cacheWrite).padStart(8)}  cost: $${data.cost.toFixed(4)}`
          );
        }
        console.log();
      }
    }

    if (last.statsCache?.modelUsage) {
      console.log(paint("green", "  All-time Models (stats-cache)"));
      for (const [model, usage] of Object.entries(last.statsCache.modelUsage)) {
        const short = model.replace("claude-", "").slice(0, 28);
        const tier = getModelTier(model);
        const badge = tier ? `[${tier.toUpperCase()}]` : "[???]";
        console.log(
          `    ${paint("green", badge.padEnd(9))} ${short.padEnd(29)} in:${formatTokens(usage.inputTokens).padStart(8)}  out:${formatTokens(usage.outputTokens).padStart(8)}  cache:${formatTokens(usage.cacheReadInputTokens).padStart(10)}`
        );
      }
      console.log();
    }

    console.log(paint("dim", "  Timeline (last 15 snapshots):"));
    const recent = snapshots.slice(-15);
    const maxBar = 40;
    const maxMsg = Math.max(...recent.map((s) => s.recentHourMetrics.messages), 1);
    for (const s of recent) {
      const time = new Date(s.timestamp).toLocaleTimeString().slice(0, 5);
      const barLen = Math.round((s.recentHourMetrics.messages / maxMsg) * maxBar);
      const bar = "\u2588".repeat(barLen);
      const active = s.activeSessionCount > 0 ? paint("green", "*") : " ";
      console.log(`    ${paint("dim", time)} ${active} ${paint("blue", bar)} ${s.recentHourMetrics.messages}`);
    }
  },

  chart() {
    if (!fs.existsSync(REPORT_FILE)) {
      // generate on-the-fly if daemon hasn't built one yet
      const snapshots = loadData();
      if (!snapshots.length) {
        console.log(paint("yellow", "No data yet. Start the daemon first: node cli.js start"));
        return;
      }
      generateHtml(snapshots, REPORT_FILE);
    }

    console.log(paint("green", `Opening report: ${REPORT_FILE}`));
    const openCmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    try {
      execSync(`${openCmd} "${REPORT_FILE}"`, { stdio: "ignore" });
    } catch {
      console.log(paint("dim", "Could not open automatically. Open manually:"));
      console.log(paint("dim", `  ${REPORT_FILE}`));
    }
  },

  export(args) {
    const dest = args[0];
    if (!dest) {
      console.log(paint("red", "Usage: node cli.js export <path>"));
      console.log(paint("dim", "  node cli.js export ~/Desktop/claude-report.html"));
      console.log(paint("dim", "  node cli.js export ./report.html"));
      return;
    }

    // resolve relative paths against cwd
    const target = path.resolve(dest);

    // make sure we have a fresh report
    const snapshots = loadData();
    if (!snapshots.length) {
      console.log(paint("yellow", "No data to export"));
      return;
    }
    generateHtml(snapshots, target);
    console.log(paint("green", `Report exported to: ${target}`));
    console.log(paint("dim", `${snapshots.length} snapshots`));
  },

  async snapshot() {
    console.log(paint("dim", "Collecting snapshot + rate limits...\n"));
    const snapshot = await collectSnapshotWithLimits();

    console.log(paint("bold", "Current Snapshot") + paint("dim", ` [${snapshot.isoTime.slice(0, 19)}]`));
    console.log();

    // rate limits first - the key data
    if (snapshot.rateLimits) {
      const rl = snapshot.rateLimits;
      console.log(paint("yellow", "  Rate Limits (from Anthropic API)"));
      const bar5h = makeBar(rl.sessionUtilization, 40);
      const bar7d = makeBar(rl.weeklyUtilization, 40);
      console.log(`    Session (5h):   ${bar5h} ${rl.sessionUtilization}%`);
      console.log(`    Weekly  (7d):   ${bar7d} ${rl.weeklyUtilization}%`);
      if (rl.sessionResetAt) console.log(paint("dim", `    Session resets:  ${new Date(rl.sessionResetAt).toLocaleString()}`));
      if (rl.weeklyResetAt) console.log(paint("dim", `    Weekly resets:   ${new Date(rl.weeklyResetAt).toLocaleString()}`));
      console.log(paint("dim", `    Status: ${rl.status} | Overage: ${rl.overageStatus}`));
    } else {
      console.log(paint("dim", "  Rate limits: unavailable (no OAuth token)"));
    }
    console.log();

    console.log(`  Active sessions:  ${snapshot.activeSessionCount}`);
    console.log(`  Total files:      ${snapshot.totalSessionFiles}`);
    console.log(`  Disk:             ${formatBytes(snapshot.totalDiskUsage)}`);
    console.log();
    console.log(paint("cyan", "  Recent hour:"));
    console.log(`    Messages:       ${formatNum(snapshot.recentHourMetrics.messages)}`);
    console.log(`    Tool calls:     ${formatNum(snapshot.recentHourMetrics.toolCalls)}`);
    console.log(`    Cost:           $${snapshot.recentHourMetrics.estimatedCost.toFixed(4)}`);
    console.log();

    if (Object.keys(snapshot.recentHourMetrics.models).length > 0) {
      console.log(paint("cyan", "  Models (recent hour):"));
      for (const [model, data] of Object.entries(snapshot.recentHourMetrics.models)) {
        const short = model.replace("claude-", "");
        console.log(`    ${short}: ${data.responses} responses, ${formatTokens(data.output)} out, $${data.cost.toFixed(4)}`);
      }
      console.log();
    }

    if (snapshot.todayMetrics) {
      console.log(paint("magenta", "  Today's totals:"));
      console.log(`    Sessions:       ${snapshot.todayMetrics.sessions}`);
      console.log(`    Messages:       ${formatNum(snapshot.todayMetrics.messages)}`);
      console.log(`    Cost:           $${snapshot.todayMetrics.estimatedCost.toFixed(4)}`);
      for (const [model, data] of Object.entries(snapshot.todayMetrics.models)) {
        const short = model.replace("claude-", "");
        console.log(`    ${short}: in=${formatTokens(data.input)} out=${formatTokens(data.output)} cache=${formatTokens(data.cacheRead)} cost=$${data.cost.toFixed(4)}`);
      }
    }
  },

  menubar() {
    if (process.platform !== "darwin") {
      console.log(paint("red", "Menu bar app is only available on macOS"));
      return;
    }

    const appPath = path.join(__dirname, "ClaudeCodeMonitor.app");
    const buildScript = path.join(__dirname, "build.sh");
    const binaryPath = path.join(appPath, "Contents", "MacOS", "ClaudeCodeMonitor");
    const srcDir = path.join(__dirname, "ClaudeCodeMonitor");

    let needsBuild = !fs.existsSync(binaryPath);
    if (!needsBuild && fs.existsSync(srcDir)) {
      const binMtime = fs.statSync(binaryPath).mtimeMs;
      const srcFiles = fs.readdirSync(srcDir).filter(f => f.endsWith(".swift") || f === "Info.plist");
      needsBuild = srcFiles.some(f => fs.statSync(path.join(srcDir, f)).mtimeMs > binMtime);
    }

    if (needsBuild) {
      console.log(paint("dim", "Building ClaudeCodeMonitor.app..."));
      try {
        execSync(`bash "${buildScript}"`, { stdio: "pipe", timeout: 120000 });
        console.log(paint("green", "Built successfully"));
      } catch (err) {
        console.log(paint("red", "Build failed:"));
        console.log(paint("dim", err.stderr?.toString() || err.message));
        return;
      }
    }

    console.log(paint("green", "Launching ClaudeCodeMonitor.app..."));
    try {
      execSync(`open "${appPath}"`, { stdio: "ignore" });
      console.log(paint("dim", "Menu bar app launched. Daemon starts automatically."));
    } catch (err) {
      console.log(paint("red", "Failed to launch app"));
    }
  },

  "menubar-stop"() {
    const appPath = path.join(__dirname, "ClaudeCodeMonitor.app");
    try {
      execSync(`osascript -e 'quit app "ClaudeCodeMonitor"'`, { stdio: "ignore", timeout: 5000 });
      console.log(paint("green", "Menu bar app stopped (daemon will terminate)"));
    } catch {
      // Fallback: kill by process name
      try {
        execSync("pkill -f ClaudeCodeMonitor.app/Contents/MacOS/ClaudeCodeMonitor", { stdio: "ignore" });
        console.log(paint("green", "Menu bar app killed"));
      } catch {
        console.log(paint("yellow", "Menu bar app is not running"));
      }
    }
  },
};

function printUsage() {
  console.log(paint("bold", "Claude Code Monitor") + paint("dim", " - background usage tracker\n"));
  console.log("Usage: claude-monitor <command> [options]\n");
  console.log("Commands:");
  console.log(`  ${paint("green", "start")}              Start the background daemon`);
  console.log(`  ${paint("red", "stop")}               Stop the daemon`);
  console.log(`  ${paint("cyan", "status")}             Show daemon status and data summary`);
  console.log(`  ${paint("blue", "stats")}  [date]      Show collected statistics (default: today)`);
  console.log(`  ${paint("magenta", "chart")}              Open the live HTML dashboard`);
  console.log(`  ${paint("yellow", "export")} <path>      Export report to a specific path`);
  console.log(`  ${paint("gray", "snapshot")}           Collect and print a single snapshot now`);
  console.log(`  ${paint("cyan", "menubar")}            Launch macOS menu bar app (macOS only)`);
  console.log(`  ${paint("red", "menubar-stop")}       Stop the menu bar app`);
  console.log(`\nExamples:`);
  console.log(paint("dim", "  claude-monitor start"));
  console.log(paint("dim", "  claude-monitor chart               # open live dashboard"));
  console.log(paint("dim", "  claude-monitor stats               # today's terminal stats"));
  console.log(paint("dim", "  claude-monitor stats 2026-03-07"));
  console.log(paint("dim", "  claude-monitor export ~/Desktop/report.html"));
  console.log(paint("dim", "  claude-monitor menubar             # macOS menu bar app"));
}

const [cmd, ...args] = process.argv.slice(2);

if (!cmd || !commands[cmd]) {
  printUsage();
  process.exit(cmd ? 1 : 0);
} else {
  commands[cmd](args);
}
