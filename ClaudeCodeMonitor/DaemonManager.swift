import Foundation

class DaemonManager {
    private var daemonProcess: Process?
    private let homeDir = NSHomeDirectory() + "/.claude-code-monitor"

    func startDaemon() {
        guard daemonProcess == nil else { return }

        let daemonPath = findDaemonScript()
        guard let scriptPath = daemonPath else {
            NSLog("ClaudeCodeMonitor: daemon.js not found")
            return
        }

        let nodePath = findNode()
        guard let node = nodePath else {
            NSLog("ClaudeCodeMonitor: node not found")
            return
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: node)
        process.arguments = [scriptPath]
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice

        process.terminationHandler = { [weak self] proc in
            NSLog("ClaudeCodeMonitor: daemon exited with code \(proc.terminationStatus)")
            self?.daemonProcess = nil
        }

        do {
            try process.run()
            daemonProcess = process
            NSLog("ClaudeCodeMonitor: daemon started (PID: \(process.processIdentifier))")
        } catch {
            NSLog("ClaudeCodeMonitor: failed to start daemon: \(error)")
        }
    }

    func stopDaemon() {
        guard let process = daemonProcess, process.isRunning else {
            cleanupExistingDaemon()
            return
        }
        process.interrupt()
        process.waitUntilExit()
        daemonProcess = nil
        NSLog("ClaudeCodeMonitor: daemon stopped")
    }

    var isDaemonRunning: Bool {
        daemonProcess?.isRunning ?? false
    }

    private func findDaemonScript() -> String? {
        // Look next to the .app bundle
        let bundle = Bundle.main.bundlePath
        let appDir = (bundle as NSString).deletingLastPathComponent
        let adjacent = (appDir as NSString).appendingPathComponent("daemon.js")
        if FileManager.default.fileExists(atPath: adjacent) {
            return adjacent
        }

        // Look in the source directory (two levels up from MacOS binary)
        let srcDir = ((bundle as NSString).deletingLastPathComponent as NSString).deletingLastPathComponent
        let srcDaemon = (srcDir as NSString).appendingPathComponent("daemon.js")
        if FileManager.default.fileExists(atPath: srcDaemon) {
            return srcDaemon
        }

        // Fallback: check settings.json for configured path
        let settingsPath = homeDir + "/settings.json"
        if let data = FileManager.default.contents(atPath: settingsPath),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let configured = json["daemonPath"] as? String,
           FileManager.default.fileExists(atPath: configured) {
            return configured
        }

        return nil
    }

    private func findNode() -> String? {
        // Try common paths
        let candidates = [
            "/usr/local/bin/node",
            "/opt/homebrew/bin/node",
            "/usr/bin/node"
        ]
        for path in candidates {
            if FileManager.default.fileExists(atPath: path) {
                return path
            }
        }

        // Fallback: use /usr/bin/env to resolve
        let pipe = Pipe()
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = ["which", "node"]
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice
        do {
            try process.run()
            process.waitUntilExit()
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            let result = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
            if let result = result, !result.isEmpty, FileManager.default.fileExists(atPath: result) {
                return result
            }
        } catch {}

        return nil
    }

    private func cleanupExistingDaemon() {
        let pidFile = homeDir + "/.daemon.pid"
        guard let pidStr = try? String(contentsOfFile: pidFile, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines),
              let pid = Int32(pidStr) else { return }
        kill(pid, SIGTERM)
    }
}
