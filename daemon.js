const fs = require("fs");
const path = require("path");
const os = require("os");
const { collectSnapshotWithLimits } = require("./collector");

const HOME_DIR = path.join(os.homedir(), ".claude-code-monitor");
const DATA_DIR = path.join(HOME_DIR, "data");
const PID_FILE = path.join(HOME_DIR, ".daemon.pid");
const LOG_FILE = path.join(HOME_DIR, ".daemon.log");
const REPORT_FILE = path.join(DATA_DIR, "report.html");
const MENUBAR_JSON = path.join(HOME_DIR, "menubar.json");
const MENUBAR_PID_FILE = path.join(HOME_DIR, ".menubar.pid");
const PAUSE_FILE = path.join(HOME_DIR, ".paused");
const SETTINGS_FILE = path.join(HOME_DIR, "settings.json");

function getIntervalMs() {
  const flagIdx = process.argv.indexOf("--interval");
  if (flagIdx !== -1 && process.argv[flagIdx + 1]) {
    return parseInt(process.argv[flagIdx + 1], 10);
  }
  try {
    const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
    if (settings.intervalMinutes) return settings.intervalMinutes * 60 * 1000;
  } catch {}
  return 5 * 60 * 1000;
}

function ensureDataDir() {
  if (!fs.existsSync(HOME_DIR)) fs.mkdirSync(HOME_DIR, { recursive: true });
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function getDataFile() {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(DATA_DIR, `${date}.json`);
}

function appendSnapshot(snapshot) {
  ensureDataDir();
  const file = getDataFile();
  let data = [];
  if (fs.existsSync(file)) {
    try {
      data = JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch {
      data = [];
    }
  }
  data.push(snapshot);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function rebuildReport() {
  const { loadData, generateHtml } = require("./chart");
  const snapshots = loadData();
  if (snapshots.length > 0) {
    generateHtml(snapshots, REPORT_FILE);
  }
}

function writeMenubarJson(snapshot, paused) {
  const data = {
    session5h: snapshot?.rateLimits?.sessionUtilization ?? null,
    weekly7d: snapshot?.rateLimits?.weeklyUtilization ?? null,
    sessionReset: snapshot?.rateLimits?.sessionResetAt ?? null,
    weeklyReset: snapshot?.rateLimits?.weeklyResetAt ?? null,
    status: snapshot?.rateLimits?.status ?? null,
    activeCount: snapshot?.activeSessionCount ?? 0,
    todayCost: snapshot?.todayMetrics?.estimatedCost ?? 0,
    paused,
    timestamp: Date.now(),
  };
  try {
    fs.writeFileSync(MENUBAR_JSON, JSON.stringify(data, null, 2));
  } catch {}
}

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(LOG_FILE, line);
}

async function tick() {
  if (fs.existsSync(PAUSE_FILE)) {
    log("Paused - skipping collection");
    writeMenubarJson(null, true);
    return;
  }

  try {
    const snapshot = await collectSnapshotWithLimits();
    appendSnapshot(snapshot);
    rebuildReport();
    writeMenubarJson(snapshot, false);
    const rl = snapshot.rateLimits;
    const rlStr = rl
      ? `, session: ${rl.sessionUtilization}%, week: ${rl.weeklyUtilization}%`
      : "";
    log(
      `Snapshot: ${snapshot.activeSessionCount} active, ${snapshot.recentHourMetrics.messages} msgs/hr, ${snapshot.totalSessionFiles} files${rlStr}`
    );
  } catch (err) {
    log(`Error: ${err.message}`);
  }
}

function run() {
  ensureDataDir();
  fs.writeFileSync(PID_FILE, String(process.pid));
  log(`Daemon started (PID: ${process.pid})`);

  const intervalMs = getIntervalMs();
  log(`Interval: ${intervalMs / 1000}s`);
  tick();
  const interval = setInterval(tick, intervalMs);

  const cleanup = () => {
    clearInterval(interval);
    if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
    log(`Daemon stopped (PID: ${process.pid})`);
    process.exit(0);
  };

  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);
  process.on("uncaughtException", (err) => {
    log(`Uncaught exception: ${err.message}`);
  });
}

module.exports = { HOME_DIR, PID_FILE, LOG_FILE, DATA_DIR, REPORT_FILE, MENUBAR_JSON, MENUBAR_PID_FILE, PAUSE_FILE };

if (require.main === module) {
  run();
}
