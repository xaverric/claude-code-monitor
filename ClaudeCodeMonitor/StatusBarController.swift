import Cocoa

class StatusBarController {
    let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    let homeDir = NSHomeDirectory() + "/.claude-code-monitor"
    var pauseItem: NSMenuItem!
    var settingsWindow: SettingsWindow?
    var refreshTimer: Timer?

    init() {
        setupStatusItem()
        buildMenu()
        startRefreshTimer()
        refreshData()
    }

    func setupStatusItem() {
        guard let button = statusItem.button else { return }
        button.image = createMenuBarIcon()
        button.imagePosition = .imageLeft
        button.title = " --"
    }

    private func createMenuBarIcon() -> NSImage {
        let size = NSSize(width: 16, height: 16)
        let image = NSImage(size: size, flipped: false) { _ in
            guard let ctx = NSGraphicsContext.current?.cgContext else { return false }

            let center = CGPoint(x: 8, y: 7.5)
            let radius: CGFloat = 5.5
            let startDeg: CGFloat = 225
            let totalDeg: CGFloat = 270

            func angleFor(_ p: CGFloat) -> CGFloat { (startDeg - p * totalDeg) * .pi / 180 }

            // Gauge arc
            ctx.setStrokeColor(NSColor.black.cgColor)
            ctx.setLineWidth(2.0)
            ctx.setLineCap(.round)
            ctx.addArc(center: center, radius: radius, startAngle: angleFor(0), endAngle: angleFor(1), clockwise: true)
            ctx.strokePath()

            // Needle at ~60%
            let needleA = angleFor(0.6)
            let tip = CGPoint(x: center.x + 3.8 * cos(needleA), y: center.y + 3.8 * sin(needleA))
            ctx.setLineWidth(1.4)
            ctx.setLineCap(.round)
            ctx.move(to: center)
            ctx.addLine(to: tip)
            ctx.strokePath()

            // Center dot
            ctx.setFillColor(NSColor.black.cgColor)
            ctx.fillEllipse(in: CGRect(x: center.x - 1.2, y: center.y - 1.2, width: 2.4, height: 2.4))

            return true
        }
        image.isTemplate = true
        return image
    }

    func buildMenu() {
        let menu = NSMenu()

        let viewReport = NSMenuItem(title: "View Report", action: #selector(openReport), keyEquivalent: "r")
        viewReport.target = self
        menu.addItem(viewReport)

        menu.addItem(NSMenuItem.separator())

        pauseItem = NSMenuItem(title: "Pause Gathering", action: #selector(togglePause), keyEquivalent: "p")
        pauseItem.target = self
        menu.addItem(pauseItem)

        menu.addItem(NSMenuItem.separator())

        let settingsItem = NSMenuItem(title: "Settings...", action: #selector(openSettings), keyEquivalent: ",")
        settingsItem.target = self
        menu.addItem(settingsItem)

        let quit = NSMenuItem(title: "Quit", action: #selector(quitApp), keyEquivalent: "q")
        quit.target = self
        menu.addItem(quit)

        statusItem.menu = menu
        updatePauseMenuItem()
    }

    func startRefreshTimer() {
        refreshTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            self?.refreshData()
        }
    }

    func refreshData() {
        let jsonPath = homeDir + "/menubar.json"
        guard let data = FileManager.default.contents(atPath: jsonPath),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            updateDisplay(session: nil, weekly: nil)
            return
        }

        let paused = json["paused"] as? Bool ?? false
        if paused {
            statusItem.button?.title = " paused"
        } else {
            let session = json["session5h"] as? Double
            let weekly = json["weekly7d"] as? Double
            updateDisplay(session: session, weekly: weekly)
        }
        updatePauseMenuItem()
    }

    func updateDisplay(session: Double?, weekly: Double?) {
        guard let button = statusItem.button else { return }
        let sVal = session.map { String(format: "%.0f%%", $0) } ?? "--"
        let wVal = weekly.map { String(format: "%.0f%%", $0) } ?? "--"
        button.title = " 5h:\(sVal) 7d:\(wVal)"
    }

    func isPaused() -> Bool {
        FileManager.default.fileExists(atPath: homeDir + "/.paused")
    }

    func updatePauseMenuItem() {
        pauseItem?.title = isPaused() ? "Resume Gathering" : "Pause Gathering"
    }

    @objc func openReport() {
        let reportPath = homeDir + "/data/report.html"
        if FileManager.default.fileExists(atPath: reportPath) {
            NSWorkspace.shared.open(URL(fileURLWithPath: reportPath))
        }
    }

    @objc func togglePause() {
        let pauseFile = homeDir + "/.paused"
        if isPaused() {
            try? FileManager.default.removeItem(atPath: pauseFile)
        } else {
            try? "".write(toFile: pauseFile, atomically: true, encoding: .utf8)
        }
        updatePauseMenuItem()
        refreshData()
    }

    @objc func openSettings() {
        if settingsWindow == nil {
            settingsWindow = SettingsWindow()
        }
        settingsWindow?.showWindow()
    }

    @objc func quitApp() {
        NSApplication.shared.terminate(nil)
    }
}

class AppDelegate: NSObject, NSApplicationDelegate {
    let controller: StatusBarController
    let daemonManager = DaemonManager()

    init(controller: StatusBarController) {
        self.controller = controller
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        daemonManager.startDaemon()
    }

    func applicationWillTerminate(_ notification: Notification) {
        daemonManager.stopDaemon()
    }
}
