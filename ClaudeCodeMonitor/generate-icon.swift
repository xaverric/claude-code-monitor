import Cocoa

func lerp(_ a: CGFloat, _ b: CGFloat, _ t: CGFloat) -> CGFloat { a + (b - a) * t }

func col(_ r: CGFloat, _ g: CGFloat, _ b: CGFloat, _ a: CGFloat = 1) -> [CGFloat] {
    [r / 255, g / 255, b / 255, a]
}

func makeColor(_ cs: CGColorSpace, _ c: [CGFloat]) -> CGColor {
    CGColor(colorSpace: cs, components: c)!
}

func drawAppIcon(ctx: CGContext, s: CGFloat) {
    let cs = CGColorSpaceCreateDeviceRGB()
    let center = CGPoint(x: s / 2, y: s * 0.47)

    // Background rounded rect
    let cr = s * 0.22
    let bgRect = CGRect(x: 0, y: 0, width: s, height: s)
    let bgPath = CGPath(roundedRect: bgRect, cornerWidth: cr, cornerHeight: cr, transform: nil)

    // Dark gradient fill
    ctx.saveGState()
    ctx.addPath(bgPath)
    ctx.clip()
    let bgGrad = CGGradient(colorsSpace: cs,
        colors: [makeColor(cs, col(12, 12, 26)), makeColor(cs, col(24, 24, 44))] as CFArray,
        locations: [0, 1])!
    ctx.drawLinearGradient(bgGrad, start: CGPoint(x: 0, y: s), end: CGPoint(x: s, y: 0), options: [])
    ctx.restoreGState()

    // Subtle radial glow
    ctx.saveGState()
    ctx.addPath(bgPath)
    ctx.clip()
    let glowGrad = CGGradient(colorsSpace: cs,
        colors: [makeColor(cs, [0, 0.28, 0.32, 0.18]), makeColor(cs, [0, 0.1, 0.12, 0])] as CFArray,
        locations: [0, 1])!
    ctx.drawRadialGradient(glowGrad, startCenter: center, startRadius: 0,
        endCenter: center, endRadius: s * 0.55, options: [])
    ctx.restoreGState()

    // Gauge parameters
    let gaugeR = s * 0.30
    let arcW = s * 0.05
    let startDeg: CGFloat = 225
    let totalDeg: CGFloat = 270
    let value: CGFloat = 0.62

    func angleFor(_ p: CGFloat) -> CGFloat { (startDeg - p * totalDeg) * .pi / 180 }

    // Background arc
    ctx.saveGState()
    ctx.setStrokeColor(makeColor(cs, [0.18, 0.18, 0.26, 0.5]))
    ctx.setLineWidth(arcW)
    ctx.setLineCap(.round)
    ctx.addArc(center: center, radius: gaugeR, startAngle: angleFor(0), endAngle: angleFor(1), clockwise: true)
    ctx.strokePath()
    ctx.restoreGState()

    // Colored arc segments
    let teal: [CGFloat] = col(0, 210, 210)
    let amber: [CGFloat] = col(240, 176, 30)
    let red: [CGFloat] = col(232, 52, 44)

    func segColor(_ p: CGFloat) -> [CGFloat] {
        if p < 0.5 { return (0..<4).map { lerp(teal[$0], amber[$0], p * 2) } }
        return (0..<4).map { lerp(amber[$0], red[$0], (p - 0.5) * 2) }
    }

    let segs = 50
    for i in 0..<segs {
        let p = CGFloat(i) / CGFloat(segs)
        if p >= value { break }
        let pNext = min(CGFloat(i + 1) / CGFloat(segs), value)
        ctx.saveGState()
        ctx.setStrokeColor(makeColor(cs, segColor(p)))
        ctx.setLineWidth(arcW)
        ctx.setLineCap(.butt)
        ctx.addArc(center: center, radius: gaugeR, startAngle: angleFor(p), endAngle: angleFor(pNext), clockwise: true)
        ctx.strokePath()
        ctx.restoreGState()
    }

    // Round caps at arc endpoints
    let capR = arcW / 2
    let capStart = CGPoint(x: center.x + gaugeR * cos(angleFor(0)), y: center.y + gaugeR * sin(angleFor(0)))
    ctx.setFillColor(makeColor(cs, teal))
    ctx.fillEllipse(in: CGRect(x: capStart.x - capR, y: capStart.y - capR, width: capR * 2, height: capR * 2))

    let valAngle = angleFor(value)
    let capEnd = CGPoint(x: center.x + gaugeR * cos(valAngle), y: center.y + gaugeR * sin(valAngle))
    ctx.setFillColor(makeColor(cs, segColor(value - 0.01)))
    ctx.fillEllipse(in: CGRect(x: capEnd.x - capR, y: capEnd.y - capR, width: capR * 2, height: capR * 2))

    // Outer tick marks
    for i in 0...8 {
        let p = CGFloat(i) / 8
        let a = angleFor(p)
        let r1 = gaugeR + arcW / 2 + s * 0.012
        let r2 = r1 + s * 0.020
        ctx.setStrokeColor(makeColor(cs, [1, 1, 1, 0.2]))
        ctx.setLineWidth(s * 0.007)
        ctx.setLineCap(.round)
        ctx.move(to: CGPoint(x: center.x + r1 * cos(a), y: center.y + r1 * sin(a)))
        ctx.addLine(to: CGPoint(x: center.x + r2 * cos(a), y: center.y + r2 * sin(a)))
        ctx.strokePath()
    }

    // Needle
    let needleLen = gaugeR * 0.75
    let tip = CGPoint(x: center.x + needleLen * cos(valAngle), y: center.y + needleLen * sin(valAngle))

    ctx.setStrokeColor(makeColor(cs, [1, 1, 1, 0.92]))
    ctx.setLineWidth(s * 0.016)
    ctx.setLineCap(.round)
    ctx.move(to: center)
    ctx.addLine(to: tip)
    ctx.strokePath()

    // Needle tip glow
    ctx.saveGState()
    let tipGlow = CGGradient(colorsSpace: cs,
        colors: [makeColor(cs, [1, 1, 1, 0.3]), makeColor(cs, [1, 1, 1, 0])] as CFArray,
        locations: [0, 1])!
    ctx.drawRadialGradient(tipGlow, startCenter: tip, startRadius: 0,
        endCenter: tip, endRadius: s * 0.04, options: [])
    ctx.restoreGState()

    // Center hub
    let hubR = s * 0.022
    ctx.setFillColor(makeColor(cs, [1, 1, 1, 1]))
    ctx.fillEllipse(in: CGRect(x: center.x - hubR, y: center.y - hubR, width: hubR * 2, height: hubR * 2))
    let dotR = hubR * 0.35
    ctx.setFillColor(makeColor(cs, col(16, 16, 30)))
    ctx.fillEllipse(in: CGRect(x: center.x - dotR, y: center.y - dotR, width: dotR * 2, height: dotR * 2))

    // Outer subtle border
    ctx.saveGState()
    ctx.addPath(bgPath)
    ctx.setStrokeColor(makeColor(cs, [1, 1, 1, 0.06]))
    ctx.setLineWidth(s * 0.004)
    ctx.strokePath()
    ctx.restoreGState()
}

// Generate icon set
let outputDir = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "."
let iconsetDir = outputDir + "/AppIcon.iconset"
try? FileManager.default.createDirectory(atPath: iconsetDir, withIntermediateDirectories: true)

let sizes: [(String, Int)] = [
    ("icon_16x16", 16), ("icon_16x16@2x", 32),
    ("icon_32x32", 32), ("icon_32x32@2x", 64),
    ("icon_128x128", 128), ("icon_128x128@2x", 256),
    ("icon_256x256", 256), ("icon_256x256@2x", 512),
    ("icon_512x512", 512), ("icon_512x512@2x", 1024),
]

let colorSpace = CGColorSpaceCreateDeviceRGB()
for (name, px) in sizes {
    guard let ctx = CGContext(data: nil, width: px, height: px, bitsPerComponent: 8,
        bytesPerRow: 0, space: colorSpace,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { continue }

    drawAppIcon(ctx: ctx, s: CGFloat(px))

    guard let img = ctx.makeImage() else { continue }
    let rep = NSBitmapImageRep(cgImage: img)
    guard let png = rep.representation(using: .png, properties: [:]) else { continue }
    try? png.write(to: URL(fileURLWithPath: "\(iconsetDir)/\(name).png"))
}

print("Icon set generated")
