import Cocoa

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let controller = StatusBarController()
let delegate = AppDelegate(controller: controller)
app.delegate = delegate
app.run()
