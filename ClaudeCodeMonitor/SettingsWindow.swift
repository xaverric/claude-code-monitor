import Cocoa

class SettingsWindow: NSObject {
    private var window: NSWindow?
    private var intervalPopup: NSPopUpButton!
    private var loginCheckbox: NSButton!
    private let homeDir = NSHomeDirectory() + "/.claude-code-monitor"
    private let settingsFile: String
    private let launchAgentLabel = "com.claude-code-monitor"
    private let intervals: [(String, Int)] = [
        ("1 minute", 1),
        ("2 minutes", 2),
        ("5 minutes", 5),
        ("10 minutes", 10),
        ("15 minutes", 15),
    ]

    override init() {
        settingsFile = homeDir + "/settings.json"
        super.init()
    }

    func showWindow() {
        if let existing = window {
            existing.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            return
        }

        let win = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 320, height: 140),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        win.title = "Claude Code Monitor Settings"
        win.center()
        win.isReleasedWhenClosed = false

        let content = win.contentView!

        // Interval label
        let label = NSTextField(labelWithString: "Polling interval:")
        label.frame = NSRect(x: 20, y: 95, width: 120, height: 20)
        content.addSubview(label)

        // Interval popup
        intervalPopup = NSPopUpButton(frame: NSRect(x: 150, y: 90, width: 140, height: 28))
        for (title, _) in intervals {
            intervalPopup.addItem(withTitle: title)
        }
        let currentInterval = readInterval()
        if let idx = intervals.firstIndex(where: { $0.1 == currentInterval }) {
            intervalPopup.selectItem(at: idx)
        }
        intervalPopup.target = self
        intervalPopup.action = #selector(intervalChanged)
        content.addSubview(intervalPopup)

        // Launch at login checkbox
        loginCheckbox = NSButton(checkboxWithTitle: "Launch at Login", target: self, action: #selector(loginToggled))
        loginCheckbox.frame = NSRect(x: 20, y: 50, width: 260, height: 20)
        loginCheckbox.state = isLaunchAgentInstalled() ? .on : .off
        content.addSubview(loginCheckbox)

        window = win
        win.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc func intervalChanged() {
        let idx = intervalPopup.indexOfSelectedItem
        guard idx >= 0, idx < intervals.count else { return }
        let minutes = intervals[idx].1
        writeSettings(intervalMinutes: minutes)
    }

    @objc func loginToggled() {
        if loginCheckbox.state == .on {
            installLaunchAgent()
        } else {
            removeLaunchAgent()
        }
    }

    private func readInterval() -> Int {
        guard let data = FileManager.default.contents(atPath: settingsFile),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let interval = json["intervalMinutes"] as? Int else {
            return 5
        }
        return interval
    }

    private func writeSettings(intervalMinutes: Int) {
        try? FileManager.default.createDirectory(atPath: homeDir, withIntermediateDirectories: true)
        var settings: [String: Any] = [:]
        if let data = FileManager.default.contents(atPath: settingsFile),
           let existing = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            settings = existing
        }
        settings["intervalMinutes"] = intervalMinutes
        if let jsonData = try? JSONSerialization.data(withJSONObject: settings, options: [.prettyPrinted, .sortedKeys]) {
            try? jsonData.write(to: URL(fileURLWithPath: settingsFile))
        }
    }

    private func launchAgentPath() -> String {
        NSHomeDirectory() + "/Library/LaunchAgents/\(launchAgentLabel).plist"
    }

    private func isLaunchAgentInstalled() -> Bool {
        FileManager.default.fileExists(atPath: launchAgentPath())
    }

    private func installLaunchAgent() {
        let agentsDir = NSHomeDirectory() + "/Library/LaunchAgents"
        try? FileManager.default.createDirectory(atPath: agentsDir, withIntermediateDirectories: true)

        let execPath = Bundle.main.executablePath ?? ""
        let plist = """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0">
        <dict>
            <key>Label</key>
            <string>\(launchAgentLabel)</string>
            <key>ProgramArguments</key>
            <array>
                <string>\(execPath)</string>
            </array>
            <key>RunAtLoad</key>
            <true/>
            <key>KeepAlive</key>
            <false/>
        </dict>
        </plist>
        """
        try? plist.write(toFile: launchAgentPath(), atomically: true, encoding: .utf8)
    }

    private func removeLaunchAgent() {
        try? FileManager.default.removeItem(atPath: launchAgentPath())
    }
}
