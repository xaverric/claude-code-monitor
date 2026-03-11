const fs = require("fs");
const path = require("path");
const os = require("os");

const CLAUDE_DIR = path.join(os.homedir(), ".claude");
const PROJECTS_DIR = path.join(CLAUDE_DIR, "projects");
const STATS_CACHE = path.join(CLAUDE_DIR, "stats-cache.json");

const MODEL_PRICING = {
  opus: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  sonnet: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  haiku: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};

function getModelTier(model) {
  if (!model) return null;
  const m = model.toLowerCase();
  if (m.includes("opus")) return "opus";
  if (m.includes("sonnet")) return "sonnet";
  if (m.includes("haiku")) return "haiku";
  return null;
}

function calcCost(tokens, tier) {
  if (!tier || !MODEL_PRICING[tier]) return 0;
  const p = MODEL_PRICING[tier];
  return (
    ((tokens.input || 0) * p.input +
      (tokens.output || 0) * p.output +
      (tokens.cacheRead || 0) * p.cacheRead +
      (tokens.cacheWrite || 0) * p.cacheWrite) /
    1_000_000
  );
}

function scanSessions() {
  const sessions = [];
  if (!fs.existsSync(PROJECTS_DIR)) return sessions;

  for (const project of fs.readdirSync(PROJECTS_DIR)) {
    const projectDir = path.join(PROJECTS_DIR, project);
    try {
      if (!fs.statSync(projectDir).isDirectory()) continue;
    } catch {
      continue;
    }

    const jsonlFiles = fs
      .readdirSync(projectDir)
      .filter((f) => f.endsWith(".jsonl"));

    for (const file of jsonlFiles) {
      const filePath = path.join(projectDir, file);
      try {
        const stat = fs.statSync(filePath);
        sessions.push({
          project,
          sessionId: file.replace(".jsonl", ""),
          path: filePath,
          size: stat.size,
          lastModified: stat.mtimeMs,
        });
      } catch {
        // skip inaccessible files
      }
    }
  }
  return sessions;
}

function parseSessionFile(filePath, since = 0) {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n").filter(Boolean);

  let messages = 0;
  let userMessages = 0;
  let assistantMessages = 0;
  let toolCalls = 0;
  let lastTimestamp = 0;
  let firstTimestamp = Infinity;

  // per-model token tracking
  const modelTokens = {};

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);

      const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : 0;
      if (ts > lastTimestamp) lastTimestamp = ts;
      if (ts && ts < firstTimestamp) firstTimestamp = ts;

      // skip entries before the cutoff
      if (since && ts && ts < since) continue;

      if (entry.type === "user") {
        messages++;
        userMessages++;
      }

      if (entry.type === "assistant") {
        messages++;
        assistantMessages++;
      }

      const msg = entry.message || {};
      const usage = msg.usage;
      const model = msg.model;

      if (usage && model) {
        if (!modelTokens[model]) {
          modelTokens[model] = {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            responses: 0,
            cost: 0,
          };
        }
        const mt = modelTokens[model];
        mt.input += usage.input_tokens || 0;
        mt.output += usage.output_tokens || 0;
        mt.cacheRead += usage.cache_read_input_tokens || 0;
        mt.cacheWrite += usage.cache_creation_input_tokens || 0;
        mt.responses++;

        const tier = getModelTier(model);
        mt.cost += calcCost(
          {
            input: usage.input_tokens || 0,
            output: usage.output_tokens || 0,
            cacheRead: usage.cache_read_input_tokens || 0,
            cacheWrite: usage.cache_creation_input_tokens || 0,
          },
          tier
        );
      }

      // count tool uses from content array
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === "tool_use") toolCalls++;
        }
      }
    } catch {
      // skip malformed lines
    }
  }

  // aggregate totals
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let totalCost = 0;
  for (const mt of Object.values(modelTokens)) {
    tokens.input += mt.input;
    tokens.output += mt.output;
    tokens.cacheRead += mt.cacheRead;
    tokens.cacheWrite += mt.cacheWrite;
    totalCost += mt.cost;
  }

  return {
    messages,
    userMessages,
    assistantMessages,
    toolCalls,
    tokens,
    modelTokens,
    totalCost,
    firstTimestamp: firstTimestamp === Infinity ? 0 : firstTimestamp,
    lastTimestamp,
    lineCount: lines.length,
  };
}

function readStatsCache() {
  if (!fs.existsSync(STATS_CACHE)) return null;
  try {
    return JSON.parse(fs.readFileSync(STATS_CACHE, "utf-8"));
  } catch {
    return null;
  }
}

function collectSnapshot() {
  const now = Date.now();
  const fiveMinAgo = now - 5 * 60 * 1000;
  const oneHourAgo = now - 60 * 60 * 1000;

  const allSessions = scanSessions();
  const activeSessions = allSessions.filter(
    (s) => s.lastModified > fiveMinAgo
  );
  const recentSessions = allSessions.filter(
    (s) => s.lastModified > oneHourAgo
  );

  let totalTokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let totalMessages = 0;
  let totalToolCalls = 0;
  let totalCost = 0;
  const modelBreakdown = {};

  for (const session of recentSessions) {
    try {
      const parsed = parseSessionFile(session.path, oneHourAgo);
      totalMessages += parsed.messages;
      totalToolCalls += parsed.toolCalls;
      totalTokens.input += parsed.tokens.input;
      totalTokens.output += parsed.tokens.output;
      totalTokens.cacheRead += parsed.tokens.cacheRead;
      totalTokens.cacheWrite += parsed.tokens.cacheWrite;
      totalCost += parsed.totalCost;

      for (const [model, mt] of Object.entries(parsed.modelTokens)) {
        if (!modelBreakdown[model]) {
          modelBreakdown[model] = {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            responses: 0,
            cost: 0,
          };
        }
        const mb = modelBreakdown[model];
        mb.input += mt.input;
        mb.output += mt.output;
        mb.cacheRead += mt.cacheRead;
        mb.cacheWrite += mt.cacheWrite;
        mb.responses += mt.responses;
        mb.cost += mt.cost;
      }
    } catch {
      // skip unreadable sessions
    }
  }

  function aggregateSessions(sessions, since = 0) {
    let tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    let messages = 0;
    let cost = 0;
    const models = {};
    for (const session of sessions) {
      try {
        const parsed = parseSessionFile(session.path, since);
        messages += parsed.messages;
        tokens.input += parsed.tokens.input;
        tokens.output += parsed.tokens.output;
        tokens.cacheRead += parsed.tokens.cacheRead;
        tokens.cacheWrite += parsed.tokens.cacheWrite;
        cost += parsed.totalCost;
        for (const [model, mt] of Object.entries(parsed.modelTokens)) {
          if (!models[model]) {
            models[model] = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, responses: 0, cost: 0 };
          }
          const m = models[model];
          m.input += mt.input;
          m.output += mt.output;
          m.cacheRead += mt.cacheRead;
          m.cacheWrite += mt.cacheWrite;
          m.responses += mt.responses;
          m.cost += mt.cost;
        }
      } catch { /* skip */ }
    }
    return { sessions: sessions.length, messages, tokens, models, estimatedCost: Math.round(cost * 10000) / 10000 };
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayTs = todayStart.getTime();
  const todayMetrics = aggregateSessions(allSessions.filter((s) => s.lastModified > todayTs), todayTs);

  // this week (Monday 00:00)
  const weekStart = new Date();
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const weekTs = weekStart.getTime();
  const weekMetrics = aggregateSessions(allSessions.filter((s) => s.lastModified > weekTs), weekTs);

  const statsCache = readStatsCache();

  return {
    timestamp: now,
    isoTime: new Date(now).toISOString(),
    totalSessionFiles: allSessions.length,
    activeSessionCount: activeSessions.length,
    recentSessionCount: recentSessions.length,
    activeSessions: activeSessions.map((s) => ({
      project: s.project,
      sessionId: s.sessionId,
      size: s.size,
      lastModified: s.lastModified,
    })),
    recentHourMetrics: {
      messages: totalMessages,
      toolCalls: totalToolCalls,
      tokens: totalTokens,
      models: modelBreakdown,
      estimatedCost: Math.round(totalCost * 10000) / 10000,
    },
    todayMetrics,
    weekMetrics,
    statsCache: statsCache
      ? {
          totalSessions: statsCache.totalSessions,
          totalMessages: statsCache.totalMessages,
          lastComputedDate: statsCache.lastComputedDate,
          modelUsage: statsCache.modelUsage,
          dailyActivity: statsCache.dailyActivity,
          hourCounts: statsCache.hourCounts,
        }
      : null,
    totalDiskUsage: allSessions.reduce((sum, s) => sum + s.size, 0),
    _allSessions: allSessions,
  };
}

const { execSync } = require("child_process");
const https = require("https");

function getOAuthToken() {
  try {
    const raw = execSync(
      'security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null',
      { encoding: "utf-8", timeout: 5000 }
    ).trim();
    const creds = JSON.parse(raw);
    return creds?.claudeAiOauth?.accessToken || null;
  } catch {
    return null;
  }
}

function fetchRateLimits() {
  const token = getOAuthToken();
  if (!token) return Promise.resolve(null);

  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1,
      messages: [{ role: "user", content: "." }],
    });

    const req = https.request(
      {
        hostname: "api.anthropic.com",
        path: "/v1/messages",
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "x-api-key": token,
          "Content-Type": "application/json",
          "anthropic-version": "2023-06-01",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        const headers = res.headers;
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            resolve(null);
            return;
          }
          const fiveH = parseFloat(headers["anthropic-ratelimit-unified-5h-utilization"]);
          const sevenD = parseFloat(headers["anthropic-ratelimit-unified-7d-utilization"]);
          if (isNaN(fiveH) && isNaN(sevenD)) {
            resolve(null);
            return;
          }
          const fiveHReset = headers["anthropic-ratelimit-unified-5h-reset"];
          const sevenDReset = headers["anthropic-ratelimit-unified-7d-reset"];

          resolve({
            sessionUtilization: isNaN(fiveH) ? null : Math.round(fiveH * 10000) / 100,
            weeklyUtilization: isNaN(sevenD) ? null : Math.round(sevenD * 10000) / 100,
            sessionResetAt: fiveHReset ? new Date(parseInt(fiveHReset) * 1000).toISOString() : null,
            weeklyResetAt: sevenDReset ? new Date(parseInt(sevenDReset) * 1000).toISOString() : null,
            status: headers["anthropic-ratelimit-unified-status"],
            sessionStatus: headers["anthropic-ratelimit-unified-5h-status"],
            weeklyStatus: headers["anthropic-ratelimit-unified-7d-status"],
            overageStatus: headers["anthropic-ratelimit-unified-overage-status"],
            claim: headers["anthropic-ratelimit-unified-representative-claim"],
          });
        });
      }
    );
    req.on("error", () => resolve(null));
    req.setTimeout(10000, () => { req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}

async function collectSnapshotWithLimits() {
  const snapshot = collectSnapshot();
  const allSessions = snapshot._allSessions;
  delete snapshot._allSessions;

  try {
    snapshot.rateLimits = await fetchRateLimits();
  } catch {
    snapshot.rateLimits = null;
  }

  // compute monthly accounting period metrics (1st of month)
  const periodStart = new Date();
  periodStart.setDate(1);
  periodStart.setHours(0, 0, 0, 0);
  const periodEnd = new Date(periodStart);
  periodEnd.setMonth(periodEnd.getMonth() + 1);
  snapshot.periodMetrics = aggregateSessionsFromList(
    allSessions.filter((s) => s.lastModified > periodStart.getTime()),
    periodStart.getTime(),
    periodEnd.getTime()
  );

  return snapshot;
}

function aggregateSessionsFromList(sessions, periodStart, periodEnd) {
  let tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let messages = 0;
  let cost = 0;
  const models = {};
  for (const session of sessions) {
    try {
      const parsed = parseSessionFile(session.path, periodStart);
      messages += parsed.messages;
      tokens.input += parsed.tokens.input;
      tokens.output += parsed.tokens.output;
      tokens.cacheRead += parsed.tokens.cacheRead;
      tokens.cacheWrite += parsed.tokens.cacheWrite;
      cost += parsed.totalCost;
      for (const [model, mt] of Object.entries(parsed.modelTokens)) {
        if (!models[model]) {
          models[model] = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, responses: 0, cost: 0 };
        }
        const m = models[model];
        m.input += mt.input;
        m.output += mt.output;
        m.cacheRead += mt.cacheRead;
        m.cacheWrite += mt.cacheWrite;
        m.responses += mt.responses;
        m.cost += mt.cost;
      }
    } catch { /* skip */ }
  }
  return {
    sessions: sessions.length,
    messages,
    tokens,
    models,
    estimatedCost: Math.round(cost * 10000) / 10000,
    periodStart: new Date(periodStart).toISOString(),
    periodEnd: new Date(periodEnd).toISOString(),
  };
}

module.exports = {
  collectSnapshot,
  collectSnapshotWithLimits,
  fetchRateLimits,
  scanSessions,
  parseSessionFile,
  readStatsCache,
  calcCost,
  getModelTier,
  MODEL_PRICING,
};
