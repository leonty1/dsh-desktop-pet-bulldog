import AppKit
import QuartzCore
import UserNotifications

/// Native AppKit companion controller. Implements the full BigFish feature set
/// on Apple's official APIs:
/// - Borderless transparent NSPanel, `fullScreenAuxiliary` + `canJoinAllSpaces`
///   + `.floating` level, re-asserted every 2 s so the pet stays above
///   full-screen apps.
/// - Faithful port of the Qt helper's status card, multi-task card, animation
///   model, drag/click interactions, right-click menu,
///   idle micro-animations and layout persistence.
/// - Apple official permission handling (UserNotifications + Accessibility).
final class PetController: NSObject {
    static let labels: [String: String] = [
        "IDLE": "休息中",
        "THINKING": "思考中",
        "WORKING": "干活中",
        "WAITING": "等你呢",
        "SUCCESS": "完成啦",
        "ERROR": "出问题了",
        "DISCONNECTED": "已断开",
    ]

    static let statusColors: [String: (bg: String, fg: String)] = [
        "SUCCESS": ("#D9F7E4", "#12B85A"),
        "ERROR": ("#FDE3E3", "#E5484D"),
        "WAITING": ("#FFF0CE", "#D88A00"),
        "THINKING": ("#E2ECFF", "#4C78E8"),
        "WORKING": ("#DDEBFF", "#3478F6"),
        "DISCONNECTED": ("#ECEEF1", "#7B818A"),
    ]

    static let persistentStates: Set<String> = ["THINKING", "WORKING", "WAITING", "ERROR"]

    static let microIntervals: [String: (Double, Double)] = [
        "quiet": (12, 24),
        "normal": (6.5, 12.5),
        "lively": (3.5, 8),
    ]

    /// How long the multi-task card stays open after the list changes, and how long it stays
    /// open after the pointer leaves it. The first is long enough to read three lines; the
    /// second only has to outlast a pointer crossing the bubble.
    static let cardOpenMs = 6000
    static let cardFoldAfterHoverMs = 2000

    let model: AnimationModel
    let manifest: [String: Any]
    let assetRoot: URL
    let layoutURL: URL
    let webuiURL: String
    let eventLogURL: URL?
    let snapshotURL: URL?

    private var frameData: [String: Data] = [:]
    private let imageCache = NSCache<NSString, NSImage>()
    /// Decoded frames are held only in this bounded cache: a 24 fps set is
    /// thousands of frames and each decoded one costs about 0.55 MB.
    private static let decodedFrameCache = 24
    private var maxFrameWidth: CGFloat = 238
    private var maxFrameHeight: CGFloat = 260

    private(set) var panel: NSPanel?
    private(set) var contentView: PetView?

    var scale: Double
    var bubbleScale: Double
    var reducedMotion: Bool
    /// Minutes of quiet before each rung of the drowsiness ladder; zero never reaches it.
    var lieAfterMinutes: Double
    var sleepAfterMinutes: Double
    var activityLevel: String
    var soundEnabled: Bool
    var bubbleMode: String
    var bubbleStates: [String]

    // Durable status
    var displayState = "IDLE"
    var statusState = "IDLE"
    var statusMessage = "我在这儿等新任务哦"
    var statusDetail = "DSH · 等待下一次任务"
    var statusDeadlineMs: Int?
    var overlayState: String?
    var overlayMessage = ""
    var overlayDetail = ""
    var overlayDeadlineMs: Int?
    var task = ""
    var tasks: [[String: Any]] = []
    /// Whether the multi-task card is folded to one line. Only a list of two or more folds;
    /// a single status line is one line already.
    private(set) var cardFolded = false
    /// When the card folds, or nil while it is open on its own or held by the pointer.
    private var foldDeadlineMs: Int?
    /// Whether the pointer is resting on the card, so moving within it does not re-fold.
    private var cardHovered = false
    /// The session ids the last list carried. A new task beginning or finishing changes it;
    /// a task reporting progress does not.
    private var tasksMembership = ""

    // Geometry (pet anchor in AppKit bottom-left coordinates)
    private var petX: CGFloat = 0
    private var petY: CGFloat = 0

    private(set) var dragging = false

    /// The held gaze clip while the cursor hovers off-center, or nil. Tracked so a
    /// hover can replace its own gaze without hijacking a click or drag reaction.
    private var gazeOverlay: String?

    private var animTimer: Timer?
    private var keepFrontTimer: Timer?
    private var microTimer: Timer?
    /// Armed on every sign of life and disarmed by it; firing settles the pet down or
    /// puts it to sleep, one rung each.
    private var lieTimer: Timer?
    private var sleepTimer: Timer?
    private var shakeTimer: Timer?
    private var shakeOrigin: NSPoint?
    private var shakeCount = 0
    private var lastTickMs: Int
    private var dragPetOffsetX: CGFloat = 0
    private var dragPetOffsetY: CGFloat = 8
    private var dragChainID = 0
    private var fadeFromFrame: String?
    private var fadeStarted: CFTimeInterval = 0
    private var fadeDuration: Double = 0.15
    private var snapshotSaved = false
    private var quitting = false

    init(model: AnimationModel,
         manifest: [String: Any],
         assetRoot: URL,
         layoutURL: URL,
         webuiURL: String,
         eventLogURL: URL?,
         snapshotURL: URL?) {
        self.model = model
        self.manifest = manifest
        self.assetRoot = assetRoot
        self.layoutURL = layoutURL
        self.webuiURL = webuiURL
        self.eventLogURL = eventLogURL
        self.snapshotURL = snapshotURL

        let env = ProcessInfo.processInfo.environment
        let layout = PetLayout.load(from: layoutURL)
        if let raw = env["DSH_DAFEIYU_SCALE"], let value = Double(raw) {
            self.scale = Self.clampedScale(value)
        } else {
            self.scale = Self.clampedScale(layout.scale)
        }
        if let raw = env["DSH_DAFEIYU_BUBBLE_SCALE"], let value = Double(raw) {
            self.bubbleScale = Self.clampedBubbleScale(value)
        } else {
            self.bubbleScale = Self.clampedBubbleScale(layout.bubbleScale)
        }
        if let raw = env["DSH_DAFEIYU_REDUCED_MOTION"] {
            self.reducedMotion = raw == "1"
        } else {
            self.reducedMotion = layout.reducedMotion
        }
        self.activityLevel = env["DSH_DAFEIYU_ACTIVITY_LEVEL"] ?? "normal"
        self.lieAfterMinutes = Self.quietMinutes(env["DSH_DAFEIYU_LIE_AFTER_MINUTES"], layout.lieAfterMinutes)
        self.sleepAfterMinutes = Self.quietMinutes(env["DSH_DAFEIYU_SLEEP_AFTER_MINUTES"], layout.sleepAfterMinutes)
        self.soundEnabled = env["DSH_DAFEIYU_SOUND_ENABLED"] != "0"
        let configuredBubbleMode = env["DSH_DAFEIYU_BUBBLE_MODE"]
        self.bubbleMode = ["always", "hidden", "custom"].contains(configuredBubbleMode ?? "")
            ? configuredBubbleMode!
            : layout.bubbleMode
        self.bubbleStates = env["DSH_DAFEIYU_BUBBLE_STATES"]
            .map { $0.split(separator: ",").map { String($0).trimmingCharacters(in: .whitespaces) } }
            ?? layout.bubbleStates
        self.lastTickMs = Self.nowMs()
        super.init()

        if let mfw = manifest["maxFrameWidth"] as? Int { maxFrameWidth = CGFloat(mfw) }
        if let mfh = manifest["maxFrameHeight"] as? Int { maxFrameHeight = CGFloat(mfh) }
        loadFrames()
        if !isHeadless() {
            buildWindow()
            restorePosition()
            startTimers()
            NotificationCenter.default.addObserver(
                self,
                selector: #selector(screenParametersChanged),
                name: NSApplication.didChangeScreenParametersNotification,
                object: nil
            )
        }
    }

    private func isHeadless() -> Bool {
        ProcessInfo.processInfo.arguments.contains("--headless")
    }

    // MARK: - Frames & geometry

    private func loadFrames() {
        for clip in model.clips.values {
            for frame in clip.frames where frameData[frame] == nil {
                frameData[frame] = try? Data(contentsOf: assetRoot.appendingPathComponent(frame))
            }
        }
        imageCache.totalCostLimit = Self.decodedFrameCache * decodedFrameBytes
    }

    private var decodedFrameBytes: Int { Int(maxFrameWidth * maxFrameHeight * 4) }

    private func frameImage(for frame: String) -> NSImage? {
        let key = frame as NSString
        if let cached = imageCache.object(forKey: key) { return cached }
        guard let data = frameData[frame], let image = NSImage(data: data) else { return nil }
        imageCache.setObject(image, forKey: key, cost: decodedFrameBytes)
        return image
    }

    private var petWidth: CGFloat { maxFrameWidth * scale }
    private var petHeight: CGFloat { maxFrameHeight * scale }

    /// The bubble is a two-line caption, not a panel: it carries the state title and the
    /// live work line, and stops there so it never crowds the animal or the desktop. A list
    /// of tasks is the same object, folded to one line once it has been read.
    private var cardHeightPoints: CGFloat {
        if tasks.count >= 2 {
            if cardFolded { return 34 * bubbleScale }
            // The title, up to three rows, and a row naming whatever did not fit. Leaving
            // the last one out made a fourth task print its line on the desktop below the
            // card, because the card was never tall enough to hold it. Each line is 17
            // points apart and 16 tall, and the block starts 28 below the card's top.
            let lines = min(tasks.count, 3) + (tasks.count > 3 ? 1 : 0)
            return (27 + CGFloat(lines) * 17) * bubbleScale
        }
        return 62 * bubbleScale
    }

    /// The task a folded card names: the one that began first, so the work that has been
    /// going longest is what stays on screen. A task with no start yet sorts last.
    static func firstStarted(_ tasks: [[String: Any]]) -> [String: Any]? {
        tasks.min {
            (($0["startedAt"] as? Int) ?? .max) < (($1["startedAt"] as? Int) ?? .max)
        }
    }

    /// Open the card after a change to the list and start the countdown that folds it again.
    /// The pointer holds the card open, so a change under it does not arm the fold.
    func openCardAfterChange() {
        guard tasks.count >= 2 else {
            cardFolded = false
            foldDeadlineMs = nil
            return
        }
        foldDeadlineMs = cardHovered ? nil : Self.nowMs() + Self.cardOpenMs
        if cardFolded {
            cardFolded = false
            resizeAndReposition()
        }
    }

    /// The pointer is on the card: open it and keep it open until the pointer leaves.
    func handleCardHover() {
        guard tasks.count >= 2, !cardHovered else { return }
        cardHovered = true
        foldDeadlineMs = nil
        if !cardFolded { return }
        cardFolded = false
        resizeAndReposition()
    }

    /// The pointer has left the card. It folds again shortly rather than at once, so a
    /// pointer crossing the bubble on its way somewhere else does not flash the list.
    func handleCardHoverExit() {
        guard tasks.count >= 2, cardHovered else { return }
        cardHovered = false
        foldDeadlineMs = Self.nowMs() + Self.cardFoldAfterHoverMs
    }

    /// The open card is a fixed column, wide enough for three lines of project names. A
    /// folded one takes the width its single line needs, so it reads as a chip over the pet
    /// rather than an empty bar the length of the list it hid.
    private var cardWidthPoints: CGFloat {
        let full = 300 * bubbleScale
        guard tasks.count >= 2, cardFolded else { return full }
        let font = NSFont.systemFont(ofSize: max(7.0, 8.5 * bubbleScale))
        let text = Self.taskLine(Self.firstStarted(tasks)) as NSString
        let width = text.size(withAttributes: [.font: font]).width
        // 24 to the text past the dot, 12 before the count, 16 for the count, 13 of padding.
        return min(full, max(110 * bubbleScale, width + 65 * bubbleScale))
    }

    private func windowSize() -> NSSize {
        NSSize(
            width: max(petWidth + 50, cardWidthPoints + 28),
            height: petHeight + cardHeightPoints + 34
        )
    }

    func petRect() -> NSRect {
        let viewSize = contentView?.bounds.size ?? windowSize()
        let offsetX = min(max(petX - (panel?.frame.origin.x ?? 0), 0), viewSize.width - petWidth)
        return NSRect(x: offsetX, y: viewSize.height - petHeight - 8, width: petWidth, height: petHeight)
    }

    /// The part of the window the animal itself covers. Dragging, clicking and hover all
    /// use it, so the empty margin around the sprite and the bubble above it are not
    /// treated as the pet.
    func bodyRect() -> NSRect {
        let pet = petRect()
        let box = model.activeClip.bodyBox
        guard box.count == 4, maxFrameWidth > 0 else { return pet }
        let k = pet.width / maxFrameWidth
        return NSRect(x: pet.minX + CGFloat(box[0]) * k,
                      y: pet.minY + CGFloat(box[1]) * k,
                      width: CGFloat(box[2]) * k,
                      height: CGFloat(box[3]) * k)
    }

    func hitBody(_ point: NSPoint) -> Bool { bodyRect().contains(point) }

    /// The card is a hover target in its own right: resting the pointer on it is how a
    /// folded list opens again. It is only a target while it is drawn, and four points of
    /// slack make the folded one-line pill as easy to catch as the open list.
    func hitBubble(_ point: NSPoint) -> Bool { bubbleVisible() && bubbleRect().insetBy(dx: -4, dy: -4).contains(point) }

    func bubbleRect() -> NSRect {
        let viewSize = contentView?.bounds.size ?? windowSize()
        let cardWidth = cardWidthPoints
        let cardHeight = cardHeightPoints
        let petCenterX = petRect().midX
        let margin: CGFloat = 14
        let minX = margin
        let maxX = max(minX, viewSize.width - cardWidth - margin)
        let cardX = min(max(petCenterX - cardWidth / 2, minX), maxX)
        return NSRect(x: cardX, y: 7, width: cardWidth, height: cardHeight)
    }

    private func screenContaining(_ point: NSPoint) -> NSScreen? {
        NSScreen.screens.first { $0.frame.contains(point) }
    }

    func moveToPet(_ x: CGFloat, _ y: CGFloat) {
        guard let panel = panel else { return }
        let size = windowSize()
        let geometry = screenContaining(NSPoint(x: x, y: y))?.visibleFrame ?? NSScreen.main?.visibleFrame
        let minX = geometry?.minX ?? 0
        let maxX = max(minX, (geometry?.maxX ?? minX + size.width) - size.width + 1)
        let centerOffsetX = (size.width - petWidth) / 2
        let windowX = min(max(x - centerOffsetX, minX), maxX)
        let offsetX = min(max(x - windowX, 0), size.width - petWidth)
        self.petX = windowX + offsetX

        let minY = geometry?.minY ?? 0
        let maxY = max(minY, (geometry?.maxY ?? minY + size.height) - size.height + 1)
        let windowY = min(max(y - 8, minY), maxY)
        self.petY = windowY + 8

        panel.setFrameOrigin(NSPoint(x: windowX, y: windowY))
        contentView?.needsDisplay = true
    }

    private func restorePosition() {
        let layout = PetLayout.load(from: layoutURL)
        let screenHeight = NSScreen.main?.frame.height ?? 982
        if let px = layout.petX, let py = layout.petY {
            let ax = CGFloat(px)
            var ay = CGFloat(py)
            if layout.coordinateSpace == nil && ay < screenHeight * 0.5 {
                // Legacy Qt layout stores top-left coordinates; convert to
                // AppKit bottom-left before first use.
                ay = screenHeight - (ay + petHeight)
            }
            moveToPet(ax, ay)
        } else {
            let geometry = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1512, height: 982)
            moveToPet(geometry.maxX - petWidth - 24, geometry.minY + 24)
        }
        saveLayout()
    }

    func saveLayout() {
        guard let panel = panel else { return }
        let origin = panel.frame.origin
        var layout = PetLayout()
        layout.x = Int(origin.x.rounded())
        layout.y = Int(origin.y.rounded())
        layout.petX = Int(petX.rounded())
        layout.petY = Int(petY.rounded())
        layout.scale = scale
        layout.bubbleScale = bubbleScale
        layout.reducedMotion = reducedMotion
        layout.lieAfterMinutes = lieAfterMinutes
        layout.sleepAfterMinutes = sleepAfterMinutes
        layout.bubbleMode = bubbleMode
        layout.bubbleStates = bubbleStates
        layout.save(to: layoutURL)
    }

    func resizeAndReposition() {
        guard let panel = panel, let contentView = contentView else { return }
        let size = windowSize()
        let origin = panel.frame.origin
        panel.setContentSize(size)
        panel.setFrameOrigin(origin)
        contentView.frame = NSRect(origin: .zero, size: size)
        moveToPet(petX, petY)
        contentView.needsDisplay = true
    }

    // MARK: - Window

    private func buildWindow() {
        let size = windowSize()
        let panel = NSPanel(
            contentRect: NSRect(x: 100, y: 100, width: size.width, height: size.height),
            styleMask: .borderless,
            backing: .buffered,
            defer: false
        )
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        panel.hidesOnDeactivate = false
        panel.ignoresMouseEvents = false
        panel.isMovableByWindowBackground = false
        panel.title = "DSH 法斗"

        let view = PetView(frame: NSRect(x: 0, y: 0, width: size.width, height: size.height))
        view.controller = self
        panel.contentView = view
        self.panel = panel
        self.contentView = view
    }

    func show() {
        guard !isHeadless() else { return }
        panel?.orderFrontRegardless()
        keepFront()
    }

    @objc private func screenParametersChanged() {
        moveToPet(petX, petY)
    }

    // MARK: - Timers

    private var animationInterval: TimeInterval {
        if reducedMotion { return 0.04 }
        // Sub-frame poll: a once-per-frame timer turns one early delivery into a whole-frame hitch.
        return min(0.02, max(0.008, Double(model.activeClip.frameMs) / 3000))
    }

    private func startAnimTimer() {
        animTimer?.invalidate()
        animTimer = Timer.scheduledTimer(withTimeInterval: animationInterval, repeats: true) { [weak self] _ in
            self?.tick()
        }
    }

    private func startTimers() {
        startAnimTimer()
        keepFrontTimer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { [weak self] _ in
            self?.keepFront()
        }
        scheduleMicro()
        noteActivity()
    }

    private func keepFront() {
        guard let panel = panel, !quitting else { return }
        // Re-assert every 2 s: other apps or full-screen transitions can reset
        // the level/collection behavior, which would hide the pet.
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        panel.orderFrontRegardless()
    }

    private func scheduleMicro() {
        microTimer?.invalidate()
        guard !reducedMotion else { return }
        let range = Self.microIntervals[activityLevel] ?? Self.microIntervals["normal"]!
        let delay = Double.random(in: range.0...range.1)
        microTimer = Timer.scheduledTimer(withTimeInterval: delay, repeats: false) { [weak self] _ in
            guard let self = self else { return }
            if !self.dragging {
                let index = Int.random(in: 0..<max(1, self.model.idleMicroClips.count))
                _ = self.model.playIdleMicro(index: index)
                self.contentView?.needsDisplay = true
            }
            self.scheduleMicro()
        }
    }

    /// Re-arm the countdown to each rung of the ladder. Every DSH message and every
    /// interaction is a sign that something is happening, so the pet only settles down
    /// while nothing is.
    private func noteActivity() {
        lieTimer?.invalidate()
        lieTimer = nil
        sleepTimer?.invalidate()
        sleepTimer = nil
        // Lying down only comes over the pet when there is still time before the nap.
        if lieAfterMinutes > 0, sleepAfterMinutes <= 0 || lieAfterMinutes < sleepAfterMinutes {
            lieTimer = Timer.scheduledTimer(withTimeInterval: lieAfterMinutes * 60, repeats: false) { [weak self] _ in
                self?.lieDown()
            }
        }
        guard sleepAfterMinutes > 0 else { return }
        sleepTimer = Timer.scheduledTimer(withTimeInterval: sleepAfterMinutes * 60, repeats: false) { [weak self] _ in
            self?.fallAsleep()
        }
    }

    /// Settle onto the lying body with the eyes still open. The model plays the walk over by
    /// itself: lying and sitting are separate drawings, and a change of drawing is a bridge
    /// clip.
    private func lieDown() {
        guard !dragging, model.baseState == "IDLE", model.overlayClipName == nil else { return }
        _ = model.playOverlay(Self.lieClip)
        contentView?.needsDisplay = true
    }

    /// Lie down for the nap. Coming from sitting, the model walks the pet down first; coming
    /// from the lying rung the two differ only by the lids and the bubbles, so the switch is
    /// a plain crossfade. The nap then holds until `wake` drops it.
    private func fallAsleep() {
        guard !dragging, model.baseState == "IDLE" else { return }
        guard model.overlayClipName == nil || model.overlayClipName == Self.lieClip else { return }
        _ = model.playOverlay(Self.sleepClip)
        contentView?.needsDisplay = true
    }

    /// End the ladder by dropping the overlay. Getting up is the whole of what the model does
    /// with that: it answers the underlay with the rise, which lands on whatever state is
    /// underneath.
    private func wake() {
        if let overlay = model.overlayClipName, Self.napClips.contains(overlay) {
            model.clearOverlay()
        }
        noteActivity()
    }

    /// The ladder's two rungs, and the only overlays a DSH message ends. Other overlays are
    /// click reactions the user started, and a status change must not cut them off. Lying
    /// down borrows the waiting clip: the same lying body, drawn awake.
    static let lieClip = "waiting"
    static let sleepClip = "sleep"
    static let napClips: Set<String> = [lieClip, sleepClip]

    private func tick() {
        let now = Self.nowMs()
        let elapsed = max(0, now - lastTickMs)
        lastTickMs = now
        let hadPulse = model.pulseState != nil
        let previousFrame = model.frame
        let previousClip = model.activeClipName
        let modelElapsed = reducedMotion && model.activeClip.loop ? 0 : elapsed
        model.advance(elapsedMs: modelElapsed, nowMs: now)
        syncFrameTransition(previousFrame: previousFrame, previousClip: previousClip)
        if hadPulse && model.pulseState == nil {
            displayState = model.baseState
        }
        if let deadline = overlayDeadlineMs, now >= deadline {
            clearOverlay()
        }
        if let deadline = foldDeadlineMs, now >= deadline {
            foldDeadlineMs = nil
            cardFolded = true
            resizeAndReposition()
        }
        if animTimer?.timeInterval != animationInterval {
            startAnimTimer()
        }
        contentView?.needsDisplay = true
    }

    private func syncFrameTransition(previousFrame: String, previousClip: String) {
        let currentFrame = model.frame
        guard currentFrame != previousFrame else { return }
        if let duration = AnimationModel.crossfadeDuration(previousClip: previousClip, currentClip: model.activeClipName) {
            fadeFromFrame = previousFrame
            fadeStarted = CACurrentMediaTime()
            fadeDuration = duration
        } else {
            fadeFromFrame = nil
        }
    }

    // MARK: - Interaction

    func beginDrag() {
        guard !dragging else { return }
        wake()
        dragging = true
        dragChainID &+= 1
        // Remember where the pet sits inside the window when the drag starts.
        // During the drag the window moves directly; without re-anchoring the
        // pet it would slide inside the window at the same rate and stay
        // frozen on screen while the bubble moves — a visible desync.
        let rect = petRect()
        dragPetOffsetX = rect.minX
        dragPetOffsetY = rect.minY
        animTimer?.invalidate()
        microTimer?.invalidate()
        _ = model.playOverlay("dragging")
        contentView?.needsDisplay = true
    }

    func updateDrag() {
        guard let panel = panel else { return }
        let viewSize = contentView?.bounds.size ?? windowSize()
        // Re-anchor the pet to the window's current origin using the offsets
        // captured at drag start, so the character and the bubble move as one.
        petX = panel.frame.origin.x + dragPetOffsetX
        petY = panel.frame.origin.y + (viewSize.height - dragPetOffsetY - petHeight)
        contentView?.needsDisplay = true
    }

    func endDrag() {
        guard dragging else { return }
        let now = Self.nowMs()
        model.advance(elapsedMs: 0, nowMs: now)
        model.clearOverlay()
        dragging = false
        lastTickMs = now
        startAnimTimer()
        if !reducedMotion {
            scheduleMicro()
            runDragReleaseChain()
        }
        saveLayout()
        contentView?.needsDisplay = true
    }

    func handleClick(at point: NSPoint, clickCount: Int) {
        wake()
        if clickCount >= 2 {
            _ = model.playOverlay("head_pat")
            showOverlay("好啦好啦，知道你喜欢我~", statusDetail, statusState, 1800)
            contentView?.needsDisplay = true
            return
        }
        let rect = petRect()
        let relativeX = max(0, point.x - rect.minX)
        let relativeY = max(0, point.y - rect.minY)
        if relativeY > rect.height * 0.84, relativeX > rect.width * 0.50, relativeX < rect.width * 0.72 {
            _ = model.playOverlay("paw_offer")
            showOverlay("哎呀，被你踩到爪子了", statusDetail, statusState, 1800)
        } else if relativeY < rect.height * 0.45 {
            _ = model.playOverlay("head_pat")
            showOverlay("摸摸也不能让我少干活哦~", statusDetail, statusState, 1800)
        } else if relativeX > rect.width * 0.72 {
            _ = model.playOverlay("tail")
            showOverlay("尾巴不是进度条啦！", statusDetail, statusState, 1500)
        } else {
            _ = model.playOverlay("poke")
            showOverlay("戳我干嘛，任务还在跑呢", statusDetail, statusState, 1500)
        }
        contentView?.needsDisplay = true
    }

    /// Follow the cursor while it hovers the pet: hold the gaze clip that points
    /// toward the cursor. Only during idle and only over its own gaze, so typing,
    /// a click reaction, or a drag is never hijacked.
    func handleHover(at point: NSPoint) {
        wake()
        guard !dragging, !reducedMotion, model.baseState == "IDLE" else { return }
        if let overlay = model.overlayClipName, overlay != gazeOverlay { return }
        let rect = petRect()
        let dx = point.x - rect.midX
        let dy = point.y - rect.midY
        let dead = rect.width * 0.16
        let target: String?
        if abs(dx) < dead && abs(dy) < dead {
            target = nil
        } else if abs(dx) >= abs(dy) {
            target = dx < 0 ? "look_left" : "look_right"
        } else {
            target = dy < 0 ? "look_up" : "look_down"
        }
        guard target != gazeOverlay else { return }
        if let target {
            if model.playOverlay(target) { gazeOverlay = target }
        } else {
            model.clearOverlay()
            gazeOverlay = nil
        }
        contentView?.needsDisplay = true
    }

    /// Drop the held gaze when the cursor leaves the pet.
    func handleHoverExit() {
        guard gazeOverlay != nil else { return }
        model.clearOverlay()
        gazeOverlay = nil
        contentView?.needsDisplay = true
    }

    func showMenu(with event: NSEvent) {
        guard let contentView = contentView else { return }
        let menu = NSMenu(title: "DSH 法斗")
        let sizeMenu = NSMenu(title: "大小")
        for (label, value) in [("迷你", 0.6), ("小", 0.8), ("标准", 1.0), ("大", 1.25)] {
            let item = NSMenuItem(title: label, action: #selector(changeSize(_:)), keyEquivalent: "")
            item.target = self
            item.tag = Int(value * 100)
            item.state = abs(scale - value) < 0.05 ? .on : .off
            sizeMenu.addItem(item)
        }
        let sizeItem = NSMenuItem(title: "大小", action: nil, keyEquivalent: "")
        sizeItem.submenu = sizeMenu
        menu.addItem(sizeItem)

        let bubbleMenu = NSMenu(title: "气泡大小")
        for (label, value) in [("小", 0.8), ("标准", 1.0), ("大", 1.2)] {
            let item = NSMenuItem(title: label, action: #selector(changeBubbleScale(_:)), keyEquivalent: "")
            item.target = self
            item.tag = Int(value * 100)
            item.state = abs(bubbleScale - value) < 0.05 ? .on : .off
            bubbleMenu.addItem(item)
        }
        let bubbleItem = NSMenuItem(title: "气泡大小", action: nil, keyEquivalent: "")
        bubbleItem.submenu = bubbleMenu
        menu.addItem(bubbleItem)

        let reduced = NSMenuItem(title: "减少动态", action: #selector(toggleReducedMotion(_:)), keyEquivalent: "")
        reduced.target = self
        reduced.state = reducedMotion ? .on : .off
        menu.addItem(reduced)

        let openWeb = NSMenuItem(title: "打开 WebUI", action: #selector(openWebUI(_:)), keyEquivalent: "")
        openWeb.target = self
        menu.addItem(openWeb)

        let accessibility = NSMenuItem(title: "辅助功能权限…", action: #selector(accessibilityPermission(_:)), keyEquivalent: "")
        accessibility.target = self
        menu.addItem(accessibility)

        menu.addItem(.separator())

        let hide = NSMenuItem(title: "本次隐藏", action: #selector(hidePet(_:)), keyEquivalent: "")
        hide.target = self
        menu.addItem(hide)

        let quit = NSMenuItem(title: "本次关闭", action: #selector(quitFromMenu(_:)), keyEquivalent: "")
        quit.target = self
        menu.addItem(quit)

        NSMenu.popUpContextMenu(menu, with: event, for: contentView)
    }

    @objc private func changeSize(_ sender: NSMenuItem) {
        scale = Self.clampedScale(Double(sender.tag) / 100.0)
        resizeAndReposition()
        saveLayout()
        reportSettings(["scale": scale])
    }

    @objc private func changeBubbleScale(_ sender: NSMenuItem) {
        bubbleScale = Self.clampedBubbleScale(Double(sender.tag) / 100.0)
        resizeAndReposition()
        saveLayout()
        reportSettings(["bubbleScale": bubbleScale])
    }

    private func setReducedMotion(_ enabled: Bool) {
        reducedMotion = enabled
        restartAnimTimer()
        if enabled {
            microTimer?.invalidate()
            cancelDragReleaseChain()
        } else {
            scheduleMicro()
        }
    }

    @objc private func toggleReducedMotion(_ sender: NSMenuItem) {
        setReducedMotion(sender.state == .off)
        saveLayout()
        reportSettings(["reducedMotion": reducedMotion])
        contentView?.needsDisplay = true
    }

    @objc private func openWebUI(_ sender: Any?) {
        if let url = URL(string: webuiURL) {
            NSWorkspace.shared.open(url)
        }
    }

    @objc private func accessibilityPermission(_ sender: Any?) {
        Permissions.requestAccessibility()
    }

    @objc private func hidePet(_ sender: Any?) {
        panel?.orderOut(nil)
    }

    @objc private func quitFromMenu(_ sender: Any?) {
        quit(reason: "user")
    }

    // MARK: - Protocol

    func apply(_ message: [String: Any]) {
        logEvent(message)
        guard let kind = message["kind"] as? String else { return }
        switch kind {
        case "shutdown":
            quit(reason: "host")
        case "state", "pulse", "task", "tasks":
            wake()
            switch kind {
            case "state":
                handleState(message)
            case "pulse":
                handlePulse(message)
            case "task":
                handleTask(message)
            default:
                tasks = (message["tasks"] as? [[String: Any]]) ?? []
                // The card reopens for a list that gained or lost a task. An active list
                // rewrites its lines every few seconds, and a fold timer restarted by each
                // of those would never come due.
                let membership = tasks.map { $0["sessionId"] as? String ?? "" }.sorted().joined(separator: "|")
                if membership != tasksMembership {
                    tasksMembership = membership
                    openCardAfterChange()
                }
                resizeAndReposition()
                contentView?.needsDisplay = true
            }
        case "config":
            applyConfig(message)
        default:
            break
        }
        maybeSaveSnapshot()
    }

    private func handleState(_ message: [String: Any]) {
        let state = Self.stringValue(message["state"]) ?? "IDLE"
        let activity = Self.stringValue(message["activity"])
        displayState = state
        model.applyState(state, activity: activity)
        clearOverlay()
        showStatus(
            Self.stringValue(message["message"]) ?? Self.labels[state] ?? state,
            Self.stringValue(message["detail"]) ?? "",
            state,
            Self.persistentStates.contains(state) ? nil : 4200
        )
        contentView?.needsDisplay = true
    }

    private func handlePulse(_ message: [String: Any]) {
        let state = Self.stringValue(message["state"]) ?? "IDLE"
        let ttl = max(250, Self.intValue(message["ttlMs"]) ?? 1800)
        let resumeState = Self.stringValue(message["resumeState"]) ?? model.baseState
        let resumeActivity = Self.stringValue(message["resumeActivity"])
        model.applyPulse(
            state: state,
            ttlMs: ttl,
            nowMs: Self.nowMs(),
            resumeState: resumeState,
            resumeActivity: resumeActivity
        )
        showStatus(
            Self.stringValue(message["resumeMessage"]) ?? Self.labels[resumeState] ?? resumeState,
            Self.stringValue(message["resumeDetail"]) ?? "",
            resumeState,
            Self.persistentStates.contains(resumeState) ? nil : ttl + 2200
        )
        showOverlay(
            Self.stringValue(message["message"]) ?? Self.labels[state] ?? state,
            Self.stringValue(message["detail"]) ?? "",
            state,
            ttl
        )
        if state == "SUCCESS" || state == "ERROR" {
            notifyAlert(state)
        }
        contentView?.needsDisplay = true
    }

    private func handleTask(_ message: [String: Any]) {
        task = Self.stringValue(message["task"]) ?? ""
        showStatus(
            Self.stringValue(message["message"]) ?? task,
            Self.stringValue(message["detail"]) ?? "",
            model.baseState,
            Self.persistentStates.contains(model.baseState) ? nil : 6000
        )
        contentView?.needsDisplay = true
    }

    private func applyConfig(_ message: [String: Any]) {
        var changed = false
        if let value = Self.doubleValue(message["scale"]), value != scale {
            scale = Self.clampedScale(value)
            changed = true
        }
        if let value = Self.doubleValue(message["bubbleScale"]), value != bubbleScale {
            bubbleScale = Self.clampedBubbleScale(value)
            changed = true
        }
        let lieAfter = Self.doubleValue(message["lieAfterMinutes"]).map { Self.clampedMinutes($0) } ?? lieAfterMinutes
        let sleepAfter = Self.doubleValue(message["sleepAfterMinutes"]).map { Self.clampedMinutes($0) } ?? sleepAfterMinutes
        if lieAfter != lieAfterMinutes || sleepAfter != sleepAfterMinutes {
            lieAfterMinutes = lieAfter
            sleepAfterMinutes = sleepAfter
            noteActivity()
        }
        if let value = message["reducedMotion"] as? Bool, value != reducedMotion {
            setReducedMotion(value)
            changed = true
        }
        if let value = message["soundEnabled"] as? Bool {
            soundEnabled = value
        }
        if let value = message["activityLevel"] as? String, ["quiet", "normal", "lively"].contains(value) {
            activityLevel = value
            if !reducedMotion {
                scheduleMicro()
            }
        }
        if let value = message["bubbleMode"] as? String, ["always", "hidden", "custom"].contains(value) {
            bubbleMode = value
            changed = true
        }
        if let value = message["bubbleStates"] as? [String] {
            bubbleStates = value
            changed = true
        }
        if changed {
            resizeAndReposition()
            saveLayout()
        }
    }

    func quit(reason: String, reportClosed: Bool = true) {
        guard !quitting else { return }
        quitting = true
        saveLayout()
        animTimer?.invalidate()
        keepFrontTimer?.invalidate()
        microTimer?.invalidate()
        shakeTimer?.invalidate()
        if reportClosed {
            ProtocolIO.shared.write([
                "protocolVersion": 1,
                "kind": "closed",
                "reason": reason,
                "timestamp": Self.nowMs(),
            ])
        }
        panel?.close()
        NSApp.terminate(nil)
    }

    // MARK: - Status helpers

    private func showStatus(_ message: String, _ detail: String, _ state: String, _ ttlMs: Int?) {
        statusMessage = message
        statusDetail = detail
        statusState = state
        statusDeadlineMs = ttlMs.map { Self.nowMs() + $0 }
    }

    private func showOverlay(_ message: String, _ detail: String, _ state: String, _ ttlMs: Int) {
        overlayMessage = message
        overlayDetail = detail.isEmpty ? statusDetail : detail
        overlayState = state
        overlayDeadlineMs = Self.nowMs() + ttlMs
    }

    private func clearOverlay() {
        overlayMessage = ""
        overlayDetail = ""
        overlayState = nil
        overlayDeadlineMs = nil
    }

    private func runDragReleaseChain() {
        dragChainID &+= 1
        playDragReleaseStage(0, token: dragChainID)
    }

    /// Play release -> dizzy -> protest, each stage for its own animation's length,
    /// then hand back to the base state. A new grab or a manifest without the stage
    /// clips aborts the chain quietly.
    private func playDragReleaseStage(_ index: Int, token: Int) {
        guard token == dragChainID, !dragging else { return }
        guard !reducedMotion, index < AnimationModel.dragReleaseClips.count else {
            clearDragReleaseOverlay()
            return
        }

        let clipName = AnimationModel.dragReleaseClips[index]
        guard let holdMs = model.clipLengthMs(clipName) else {
            clearDragReleaseOverlay()
            return
        }
        let previousFrame = model.frame
        let previousClip = model.activeClipName
        guard model.playOverlay(clipName) else {
            clearDragReleaseOverlay()
            return
        }
        syncFrameTransition(previousFrame: previousFrame, previousClip: previousClip)
        contentView?.needsDisplay = true

        DispatchQueue.main.asyncAfter(deadline: .now() + Double(holdMs) / 1000.0) { [weak self] in
            self?.playDragReleaseStage(index + 1, token: token)
        }
    }

    private func clearDragReleaseOverlay() {
        guard !dragging else { return }
        let previousFrame = model.frame
        let previousClip = model.activeClipName
        model.clearOverlay()
        syncFrameTransition(previousFrame: previousFrame, previousClip: previousClip)
        contentView?.needsDisplay = true
    }

    private func cancelDragReleaseChain() {
        dragChainID &+= 1
        let releaseClips = Set(AnimationModel.dragReleaseClips)
        if !dragging, releaseClips.contains(model.activeClipName) {
            clearDragReleaseOverlay()
        }
    }

    func currentCard() -> (title: String, detail: String, state: String)? {
        let now = Self.nowMs()
        if !overlayMessage.isEmpty, overlayDeadlineMs == nil || now < overlayDeadlineMs! {
            return (overlayMessage, overlayDetail, overlayState ?? statusState)
        }
        if !statusMessage.isEmpty, statusDeadlineMs == nil || now < statusDeadlineMs! {
            return (statusMessage, statusDetail, statusState)
        }
        return nil
    }

    private func bubbleVisible() -> Bool {
        if bubbleMode == "hidden" { return false }
        if bubbleMode == "always" { return true }
        if tasks.count >= 2 {
            return tasks.contains { task in
                guard let state = task["state"] as? String else { return false }
                return bubbleStates.contains(state)
            }
        }
        return bubbleStates.contains(overlayState ?? statusState)
    }

    private func notifyAlert(_ state: String) {
        if soundEnabled {
            let filename = state == "SUCCESS" ? "success" : "error"
            if let url = Bundle.main.resourceURL?
                .appendingPathComponent("assets/sounds/\(filename).wav"),
               let sound = NSSound(contentsOf: url, byReference: true) {
                sound.play()
            }
        }
        shakeWindow()
        Permissions.requestNotificationAuthorizationIfNeeded()
        guard Bundle.main.bundleIdentifier != nil else { return }
        let content = UNMutableNotificationContent()
        content.title = state == "SUCCESS" ? "任务完成" : "任务出错"
        content.body = state == "SUCCESS" ? "DSH 任务已完成" : "DSH 任务遇到问题"
        content.sound = soundEnabled ? .default : nil
        let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request) { error in
            if let error = error {
                FileHandle.standardError.write(Data("Notification error: \(error)\n".utf8))
            }
        }
    }

    private func shakeWindow() {
        guard let panel = panel else { return }
        shakeTimer?.invalidate()
        shakeOrigin = panel.frame.origin
        shakeCount = 0
        shakeTimer = Timer.scheduledTimer(withTimeInterval: 0.03, repeats: true) { [weak self] _ in
            self?.shakeTick()
        }
    }

    private func shakeTick() {
        guard let panel = panel, let origin = shakeOrigin else {
            shakeTimer?.invalidate()
            shakeTimer = nil
            return
        }
        let offsets: [(CGFloat, CGFloat)] = [(6, 0), (-6, 0), (4, 0), (-4, 0), (2, 0), (-2, 0), (0, 0)]
        if shakeCount < offsets.count {
            let offset = offsets[shakeCount]
            panel.setFrameOrigin(NSPoint(x: origin.x + offset.0, y: origin.y + offset.1))
            shakeCount += 1
        } else {
            shakeTimer?.invalidate()
            shakeTimer = nil
            panel.setFrameOrigin(origin)
        }
    }

    private func restartAnimTimer() {
        lastTickMs = Self.nowMs()
        startAnimTimer()
    }

    // MARK: - Drawing

    func drawPet(in view: NSView) {
        guard let image = frameImage(for: model.frame) else { return }

        var fadeAlpha: CGFloat = 1
        var fadeImage: NSImage?
        if let fromFrame = fadeFromFrame, let fromImage = frameImage(for: fromFrame) {
            let elapsed = CACurrentMediaTime() - fadeStarted
            if elapsed < fadeDuration {
                fadeAlpha = min(1, pow(CGFloat(elapsed / fadeDuration), 0.7))
                fadeImage = fromImage
            } else {
                fadeFromFrame = nil
            }
        }

        let pet = petRect()
        var y = pet.minY
        let card = bubbleRect()
        let bubbleBottom = card.maxY + 12
        if bubbleBottom > y {
            y = bubbleBottom
        }
        let centerX = pet.minX + pet.width / 2
        let centerY = y + pet.height / 2

        func draw(_ img: NSImage, alpha: CGFloat) {
            NSGraphicsContext.saveGraphicsState()
            guard let ctx = NSGraphicsContext.current?.cgContext else {
                NSGraphicsContext.restoreGraphicsState()
                return
            }
            ctx.saveGState()
            ctx.translateBy(x: centerX, y: centerY)
            // The content view is flipped (top-left origin). NSImage drawing
            // does not compensate for a flipped context, which would render
            // the pet vertically mirrored. Mirror about the image's own
            // center so it draws right-side up while staying in place.
            ctx.scaleBy(x: 1, y: -1)
            img.draw(
                in: NSRect(x: -pet.width / 2, y: -pet.height / 2, width: pet.width, height: pet.height),
                from: NSRect(origin: .zero, size: img.size),
                operation: .sourceOver,
                fraction: alpha
            )
            ctx.restoreGState()
            NSGraphicsContext.restoreGraphicsState()
        }

        if fadeAlpha < 1, let fadeImage = fadeImage {
            draw(fadeImage, alpha: 1)
        }
        draw(image, alpha: fadeAlpha)
    }

    func drawCard(in view: NSView) {
        guard bubbleVisible() else { return }
        let rect = bubbleRect()
        if tasks.count >= 2 {
            Self.drawTaskCard(rect: rect, tasks: tasks, folded: cardFolded, bubbleScale: bubbleScale)
        } else if let card = currentCard() {
            drawStatusCard(rect: rect, card: card)
        }
    }

    private func drawStatusCard(rect: NSRect, card: (title: String, detail: String, state: String)) {
        let s = bubbleScale
        let corner: CGFloat = 13 * s
        let shadow1 = NSRect(x: rect.minX + 1, y: rect.minY + 6, width: rect.width - 2, height: rect.height)
        let shadow2 = NSRect(x: rect.minX, y: rect.minY + 3, width: rect.width, height: rect.height)
        NSColor(calibratedWhite: 0.05, alpha: 0.05).setFill()
        NSBezierPath(roundedRect: shadow1, xRadius: corner, yRadius: corner).fill()
        NSColor(calibratedWhite: 0.08, alpha: 0.08).setFill()
        NSBezierPath(roundedRect: shadow2, xRadius: corner, yRadius: corner).fill()

        let cardPath = NSBezierPath(roundedRect: rect, xRadius: corner, yRadius: corner)
        NSColor(calibratedRed: 0.988, green: 0.988, blue: 0.992, alpha: 0.97).setFill()
        cardPath.fill()
        NSColor(calibratedWhite: 0.85, alpha: 0.8).setStroke()
        cardPath.lineWidth = 1
        cardPath.stroke()

        let iconCenter = NSPoint(x: rect.maxX - 27 * s, y: rect.midY)
        drawStatusIcon(center: iconCenter, state: card.state, scale: s)

        let textX = rect.minX + 13 * s
        let textWidth = max(40, rect.width - 64 * s)
        let titleFont = NSFont.systemFont(ofSize: max(8.0, 10.5 * s), weight: .semibold)
        let detailFont = NSFont.systemFont(ofSize: max(7.0, 8.5 * s))
        Self.drawText(
            card.title,
            in: NSRect(x: textX, y: rect.minY + 10 * s, width: textWidth, height: max(12, 21 * s)),
            font: titleFont,
            color: Self.hex("#25282D")
        )
        Self.drawText(
            card.detail,
            in: NSRect(x: textX, y: rect.minY + 32 * s, width: textWidth, height: max(12, 19 * s)),
            font: detailFont,
            color: Self.hex("#747981")
        )
    }

    /// The state glyph. Its marks are placed as fractions of the disc so the icon keeps
    /// the same look at any `bubbleScale`.
    private func drawStatusIcon(center: NSPoint, state: String, scale s: CGFloat) {
        let (bgHex, fgHex) = Self.statusColors[state] ?? ("#ECEEF1", "#747A84")
        let radius: CGFloat = 15 * s
        let u = radius / 15
        Self.hex(bgHex).setFill()
        NSBezierPath(ovalIn: NSRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2)).fill()

        let foreground = Self.hex(fgHex)
        let lineWidth: CGFloat = 2.4 * u
        switch state {
        case "SUCCESS":
            strokeLine(from: NSPoint(x: center.x - 7 * u, y: center.y),
                       to: NSPoint(x: center.x - 2 * u, y: center.y + 5.5 * u),
                       width: lineWidth, color: foreground)
            strokeLine(from: NSPoint(x: center.x - 2 * u, y: center.y + 5.5 * u),
                       to: NSPoint(x: center.x + 8 * u, y: center.y - 7 * u),
                       width: lineWidth, color: foreground)
        case "ERROR":
            strokeLine(from: NSPoint(x: center.x - 6 * u, y: center.y - 6 * u),
                       to: NSPoint(x: center.x + 6 * u, y: center.y + 6 * u),
                       width: lineWidth, color: foreground)
            strokeLine(from: NSPoint(x: center.x + 6 * u, y: center.y - 6 * u),
                       to: NSPoint(x: center.x - 6 * u, y: center.y + 6 * u),
                       width: lineWidth, color: foreground)
        case "WAITING":
            strokeLine(from: NSPoint(x: center.x, y: center.y - 7 * u),
                       to: NSPoint(x: center.x, y: center.y + 2 * u),
                       width: lineWidth, color: foreground)
            foreground.setFill()
            NSBezierPath(ovalIn: NSRect(x: center.x - 1.5 * u, y: center.y + 5.5 * u, width: 3 * u, height: 3 * u)).fill()
        case "THINKING", "WORKING":
            foreground.setFill()
            for offset in [-6.0, 0.0, 6.0] {
                NSBezierPath(ovalIn: NSRect(x: center.x + CGFloat(offset) * u - 2 * u,
                                            y: center.y - 2 * u,
                                            width: 4 * u,
                                            height: 4 * u)).fill()
            }
        default:
            foreground.setFill()
            NSBezierPath(ovalIn: NSRect(x: center.x - 3.5 * u, y: center.y - 3.5 * u, width: 7 * u, height: 7 * u)).fill()
        }
    }

    /// The multi-task card, open or folded. Static and taking its inputs because the card
    /// is the one part of the pet that has to be checked by eye and cannot be screenshotted:
    /// a transparent window captures black. A harness renders it offscreen instead.
    static func drawTaskCard(rect: NSRect, tasks: [[String: Any]], folded: Bool, bubbleScale s: CGFloat) {
        let corner: CGFloat = 13 * s
        NSColor(calibratedWhite: 0.05, alpha: 0.05).setFill()
        NSBezierPath(roundedRect: NSRect(x: rect.minX + 1, y: rect.minY + 6, width: rect.width - 2, height: rect.height),
                     xRadius: corner, yRadius: corner).fill()
        let cardPath = NSBezierPath(roundedRect: rect, xRadius: corner, yRadius: corner)
        NSColor(calibratedRed: 0.988, green: 0.988, blue: 0.992, alpha: 0.97).setFill()
        cardPath.fill()
        NSColor(calibratedWhite: 0.85, alpha: 0.8).setStroke()
        cardPath.lineWidth = 1
        cardPath.stroke()

        let textX = rect.minX + 13 * s
        let textWidth = max(40, rect.width - 26 * s)
        let detailFont = NSFont.systemFont(ofSize: max(7.0, 8.5 * s))

        if folded {
            // One line: the task that began first, and how many others are waiting behind
            // it. The count is set against the right edge so the line and the count never
            // collide however long the project name is.
            drawTaskRow(x: textX, y: rect.minY + 9 * s, width: textWidth - 34 * s, task: Self.firstStarted(tasks), font: detailFont, scale: s)
            Self.drawText(
                "+\(max(0, tasks.count - 1))",
                in: NSRect(x: rect.maxX - 44 * s, y: rect.minY + 9 * s, width: 31 * s, height: max(12, 16 * s)),
                font: detailFont,
                color: Self.hex("#9AA0A6"),
                alignsRight: true
            )
            return
        }

        let titleFont = NSFont.systemFont(ofSize: max(8.0, 10.5 * s), weight: .semibold)
        Self.drawText(
            "\(tasks.count) 个任务进行中",
            in: NSRect(x: textX, y: rect.minY + 8 * s, width: textWidth, height: max(12, 18 * s)),
            font: titleFont,
            color: Self.hex("#25282D")
        )

        for (index, task) in tasks.prefix(3).enumerated() {
            drawTaskRow(x: textX, y: rect.minY + (28 + CGFloat(index) * 17) * s, width: textWidth, task: task, font: detailFont, scale: s)
        }
        if tasks.count > 3 {
            Self.drawText(
                "还有 \(tasks.count - 3) 个任务…",
                in: NSRect(x: textX + 11 * s, y: rect.minY + (28 + 3 * 17) * s,
                           width: textWidth, height: max(12, 16 * s)),
                font: detailFont,
                color: Self.hex("#9AA0A6")
            )
        }
    }

    /// One task: a dot in the color of its state, and a `状态 · 名称` line beside it.
    private static func drawTaskRow(x: CGFloat, y: CGFloat, width: CGFloat, task: [String: Any]?, font: NSFont, scale s: CGFloat) {
        guard let task else { return }
        let state = Self.stringValue(task["state"]) ?? "IDLE"
        let (_, fgHex) = Self.statusColors[state] ?? ("#ECEEF1", "#747A84")
        Self.hex(fgHex).setFill()
        NSBezierPath(ovalIn: NSRect(x: x, y: y + 3 * s, width: 6 * s, height: 6 * s)).fill()
        Self.drawText(
            taskLine(task),
            in: NSRect(x: x + 11 * s, y: y, width: max(20, width - 11 * s), height: max(12, 16 * s)),
            font: font,
            color: Self.hex("#747981")
        )
    }

    /// What one task reads as: its state and the project it belongs to, falling back to
    /// the task line and then the message. The folded card measures this string to size
    /// itself, so the two cannot disagree about what the line says.
    static func taskLine(_ task: [String: Any]?) -> String {
        let state = Self.stringValue(task?["state"]) ?? "IDLE"
        let stateLabel = Self.labels[state] ?? state
        let label = Self.stringValue(task?["project"])
            ?? Self.stringValue(task?["task"])
            ?? Self.stringValue(task?["message"])
            ?? stateLabel
        return "\(stateLabel) · \(label)"
    }

    private static func drawText(_ text: String, in rect: NSRect, font: NSFont, color: NSColor, alignsRight: Bool = false) {
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineBreakMode = .byTruncatingTail
        if alignsRight { paragraph.alignment = .right }
        let attributes: [NSAttributedString.Key: Any] = [
            .font: font,
            .foregroundColor: color,
            .paragraphStyle: paragraph,
        ]
        (text as NSString).draw(in: rect, withAttributes: attributes)
    }

    private func strokeLine(from: NSPoint, to: NSPoint, width: CGFloat, color: NSColor) {
        color.setStroke()
        let path = NSBezierPath()
        path.lineWidth = width
        path.lineCapStyle = .round
        path.move(to: from)
        path.line(to: to)
        path.stroke()
    }

    // MARK: - Misc

    private func maybeSaveSnapshot() {
        guard let snapshotURL = snapshotURL, !snapshotSaved, !isHeadless() else { return }
        snapshotSaved = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.18) { [weak self] in
            guard let self = self, let view = self.contentView else { return }
            if let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) {
                view.cacheDisplay(in: view.bounds, to: rep)
                if let data = rep.representation(using: .png, properties: [:]) {
                    try? data.write(to: snapshotURL)
                }
            }
        }
    }

    private func logEvent(_ message: [String: Any]) {
        guard let eventLogURL = eventLogURL,
              let data = try? JSONSerialization.data(withJSONObject: message),
              let line = String(data: data, encoding: .utf8) else { return }
        let payload = Data((line + "\n").utf8)
        if let handle = try? FileHandle(forWritingTo: eventLogURL) {
            defer { try? handle.close() }
            _ = try? handle.seekToEnd()
            try? handle.write(contentsOf: payload)
        } else {
            try? payload.write(to: eventLogURL)
        }
    }

    static func clampedScale(_ value: Double) -> Double {
        min(1.4, max(0.55, value))
    }

    static func clampedBubbleScale(_ value: Double) -> Double {
        min(1.2, max(0.8, value))
    }

    /// Minutes of quiet before a rung of the drowsiness ladder, within the range the
    /// settings slider offers. Zero means the rung is never reached.
    static func clampedMinutes(_ value: Double) -> Double {
        min(180, max(0, value))
    }

    /// How long a rung of the drowsiness ladder waits, from the environment when DSH runs
    /// the helper and from the saved layout for a helper started on its own.
    private static func quietMinutes(_ raw: String?, _ fallback: Double) -> Double {
        clampedMinutes(raw.flatMap(Double.init) ?? fallback)
    }

    private static func stringValue(_ value: Any?) -> String? {
        if let string = value as? String { return string }
        if let number = value as? NSNumber { return number.stringValue }
        return nil
    }

    private static func intValue(_ value: Any?) -> Int? {
        if let int = value as? Int { return int }
        if let double = value as? Double { return Int(double) }
        if let string = value as? String { return Int(string) }
        return nil
    }

    private static func doubleValue(_ value: Any?) -> Double? {
        if let double = value as? Double { return double }
        if let int = value as? Int { return Double(int) }
        if let string = value as? String { return Double(string) }
        return nil
    }

    private static func nowMs() -> Int {
        Int(Date().timeIntervalSince1970 * 1000)
    }

    private func reportSettings(_ values: [String: Any]) {
        ProtocolIO.shared.write([
            "protocolVersion": 1,
            "kind": "settings",
            "timestamp": Self.nowMs(),
        ].merging(values) { _, new in new })
    }

    private static func hex(_ hex: String) -> NSColor {
        let value = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        if value.count == 6 {
            let red = Double(Int(value.prefix(2), radix: 16) ?? 0) / 255
            let green = Double(Int(value.dropFirst(2).prefix(2), radix: 16) ?? 0) / 255
            let blue = Double(Int(value.dropFirst(4).prefix(2), radix: 16) ?? 0) / 255
            return NSColor(calibratedRed: red, green: green, blue: blue, alpha: 1)
        }
        return .gray
    }
}
