# Claude Code Monitor

Background monitor for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) usage. Tracks rate limits, token usage, costs, and session activity. Ships as a **native macOS menu bar app** and a **cross-platform Node.js CLI**.

![macOS 12+](https://img.shields.io/badge/macOS-12%2B-blue) ![Node.js 18+](https://img.shields.io/badge/Node.js-18%2B-green) ![Zero Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen) ![License MIT](https://img.shields.io/badge/license-MIT-blue)

## What It Does

- **Rate limit tracking** — session (5h) and weekly (7d) utilization from the Anthropic API
- **Per-model token tracking** — Opus, Sonnet, Haiku with input/output/cache breakdown
- **Cost estimation** — calculated from actual token usage and current pricing
- **Session monitoring** — active sessions, file counts, disk usage
- **Live HTML dashboard** — auto-updated charts built with Chart.js
- **Zero dependencies** — pure Node.js, no `npm install` needed

## Installation

### Option A: macOS Menu Bar App (Recommended for macOS)

Download the pre-built `.app` from [Releases](https://github.com/marekjilek/claude-code-monitor/releases), or build from source:

```bash
git clone https://github.com/marekjilek/claude-code-monitor.git
cd claude-code-monitor
bash build.sh
open ClaudeCodeMonitor.app
```

The menu bar app:
- Shows rate limits in the menu bar: `[gauge] 5h:42% 7d:18%`
- Starts/stops the daemon automatically
- Provides View Report, Pause/Resume, Settings, Launch at Login
- Requires **macOS 12+** and **Node.js 18+** (for the daemon backend)

To install permanently, move `ClaudeCodeMonitor.app` to `/Applications/` and enable "Launch at Login" in Settings.

### Option B: CLI (macOS, Linux, Windows)

```bash
git clone https://github.com/marekjilek/claude-code-monitor.git
cd claude-code-monitor

# Start the background daemon
node cli.js start

# View stats
node cli.js stats

# Open HTML dashboard
node cli.js chart
```

Or install globally via npm:

```bash
npm install -g claude-code-monitor
claude-monitor start
```

Requires **Node.js 18+**.

### Option C: macOS Menu Bar via CLI

If you have the source cloned, you can build and launch the menu bar app from the CLI:

```bash
node cli.js menubar
```

This auto-compiles the Swift app on first run (requires Xcode Command Line Tools).

## CLI Commands

| Command | Description |
|---|---|
| `start` | Start the background daemon (collects every 5 min) |
| `stop` | Stop the daemon |
| `status` | Show daemon status, data summary, recent logs |
| `stats [date]` | Show statistics in terminal (default: today) |
| `chart` | Open the live HTML dashboard |
| `export <path>` | Export report to a specific file |
| `snapshot` | Collect and print a single snapshot now |
| `menubar` | Launch macOS menu bar app (macOS only) |
| `menubar-stop` | Stop the menu bar app |

## Menu Bar App

The native macOS app sits in your menu bar and shows real-time rate limit utilization.

**Menu items:**
- **View Report** — opens the HTML dashboard in your browser
- **Pause/Resume Gathering** — temporarily stops data collection
- **Settings** — polling interval (1–15 min), launch at login
- **Quit** — stops the app and daemon

**Settings** are stored in `~/.claude-code-monitor/settings.json`.

## How It Works

Every N minutes (default 5), the daemon collects a snapshot:

1. Scans `~/.claude/projects/*/*.jsonl` for session files
2. Parses JSONL entries for token usage, tool calls, models
3. Fetches rate limits from the Anthropic API (minimal Haiku call, ~$0.00001)
4. Saves snapshot to `~/.claude-code-monitor/data/YYYY-MM-DD.json`
5. Rebuilds the HTML dashboard
6. Writes `menubar.json` for the menu bar display

**Rate limit access** requires Claude Code to be authenticated (OAuth token stored in macOS Keychain under `Claude Code-credentials`). On Linux/Windows, rate limit data is unavailable but all other metrics work.

## Data Storage

```
~/.claude-code-monitor/
  data/
    2026-03-11.json       # daily snapshot arrays
    report.html           # auto-generated dashboard
  settings.json           # { "intervalMinutes": 5 }
  menubar.json            # current state for menu bar
  .daemon.pid             # running daemon PID
  .daemon.log             # daemon log
```

## Building from Source

### macOS Menu Bar App

Requirements: macOS 12+, Xcode Command Line Tools, Node.js 18+

```bash
# Install Xcode CLI tools (if not already)
xcode-select --install

# Build
bash build.sh

# Run
open ClaudeCodeMonitor.app
```

The build script:
1. Generates the app icon (gauge icon via CoreGraphics)
2. Compiles 4 Swift source files into a `.app` bundle
3. Creates `ClaudeCodeMonitor.app/` with proper Info.plist

### CLI Only

No build step needed. Just requires Node.js 18+:

```bash
node cli.js start
```

## Architecture

```
cli.js                  CLI entry point, command router
daemon.js               Background process, timer, data persistence
collector.js            Session scanning, JSONL parsing, rate limit API
chart.js                HTML dashboard generation (Chart.js)
build.sh                Compiles Swift sources into .app bundle

ClaudeCodeMonitor/      macOS menu bar app (Swift)
  main.swift            NSApplication entry
  StatusBarController.swift   Menu bar item, menu, refresh timer
  DaemonManager.swift   Start/stop daemon.js as child process
  SettingsWindow.swift  Interval + launch-at-login settings
  generate-icon.swift   App icon generator (CoreGraphics)
  Info.plist            Bundle config (LSUIElement=true)
```

## Pricing Model

Cost estimation uses current Claude API pricing (per 1M tokens):

| Model | Input | Output | Cache Read | Cache Write |
|---|---|---|---|---|
| Opus | $15.00 | $75.00 | $1.50 | $18.75 |
| Sonnet | $3.00 | $15.00 | $0.30 | $3.75 |
| Haiku | $0.80 | $4.00 | $0.08 | $1.00 |

## License

MIT
