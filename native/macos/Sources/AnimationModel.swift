import Foundation

/// Port of the original `runtime/animation_model.py` — a pure animation state
/// machine with no UI dependency. Keeps durable DSH state separate from
/// temporary visual overlays so a click, idle micro-animation, or success
/// pulse always returns to the newest Agent state.
final class AnimationModel {
    struct Clip {
        let name: String
        let frames: [String]
        let frameMs: Int
        let loop: Bool
        /// The body this clip stands on, as the skin names it, or nil for a clip that is
        /// itself the move from one body to the other. See `bodyBridges`.
        let body: String?
        /// The box the sprite's own pixels occupy, as `x, y, width, height` in logical
        /// frame units, or empty when the skin does not declare one. The UI uses it as the
        /// grab and hover region so the empty margin around the animal is not a hit target.
        let bodyBox: [Int]
    }

    static let states: Set<String> = [
        "IDLE", "THINKING", "WORKING", "WAITING", "SUCCESS", "ERROR", "DISCONNECTED",
    ]

    /// The skin draws two bodies, sitting and lying, and a dissolve between them reads as
    /// the animal coming apart. Every clip says which one it stands on, so a change of
    /// state that changes the body plays the bridge clip for it first. A bridge names no
    /// body of its own, which is what keeps one bridge from chaining into another.
    static let bodyBridges: [String: String] = [
        "sitting>lying": "lie_down",
        "lying>sitting": "wake_up",
    ]

    /// Which drawing each bridge ends on, so the clip queued behind it knows where it starts.
    static let bridgeArrives: [String: String] = [
        "lie_down": "lying",
        "wake_up": "sitting",
    ]

    /// Drag-release reaction, in order. Each stage holds for its own animation's
    /// length (`clipLengthMs`), so a stage always ends where it was drawn to end; the
    /// fixed holds these carried were from when the stages were single-frame poses.
    /// Shared with the UI layer (mirrors `DRAG_RELEASE_CLIPS` in `runtime/helper.py`).
    static let dragReleaseClips: [String] = [
        "dragging_release",
        "dragging_dizzy",
        "dragging_protest",
    ]

    /// Clips that switch without a blend: the eye dart keeps its snap, and the drag family
    /// follows the pointer, so a delayed fade would repaint the old pose after a mouse event
    /// has already drawn the new one. Mirrors `NON_CROSSFADE_CLIPS` in `animation_model.py`.
    private static let nonCrossfadeClips: Set<String> = [
        "glance",
        "dragging",
        "dragging_release",
        "dragging_dizzy",
        "dragging_protest",
    ]

    /// Same rules as the Python `crossfade_duration`: dragging switches atomically so
    /// the pet tracks the pointer without a smear. Every clip is one rig pose, so a
    /// short blend is enough to hide the frame swap between states.
    static func crossfadeDuration(previousClip: String, currentClip: String) -> Double? {
        if nonCrossfadeClips.contains(previousClip) || nonCrossfadeClips.contains(currentClip) {
            return nil
        }
        return previousClip != currentClip ? 0.10 : 0.045
    }

    private(set) var clips: [String: Clip] = [:]
    private var stateMap: [String: String] = [:]
    private var workingActivityMap: [String: String] = [:]
    private(set) var idleMicroClips: [String] = []

    private(set) var baseState = "IDLE"
    private(set) var baseActivity: String?
    private(set) var baseClipName = "idle"
    private(set) var overlayClipName: String?
    /// The body on screen, which a bridge leaves alone until it runs out.
    private(set) var body: String?
    /// The clip a body bridge is on its way to, if one is playing.
    private var pendingClipName: String?
    private(set) var pulseState: String?
    private(set) var pulseDeadlineMs: Int?
    private(set) var pulseClipName: String?
    private(set) var activeClipName = "idle"
    private(set) var frameIndex = 0
    private(set) var frameElapsedMs = 0

    init(manifest: [String: Any]) {
        if let clipsDict = manifest["clips"] as? [String: Any] {
            for (name, value) in clipsDict {
                guard let v = value as? [String: Any],
                      let frames = v["frames"] as? [String] else { continue }
                clips[name] = Clip(
                    name: name,
                    frames: frames,
                    frameMs: Self.asInt(v["frameMs"], fallback: 180),
                    loop: (v["loop"] as? Bool) ?? false,
                    body: v["body"] as? String,
                    bodyBox: (v["bodyBox"] as? [Int]) ?? []
                )
            }
        }
        if let map = manifest["stateMap"] as? [String: String] { stateMap = map }
        if let map = manifest["workingActivityMap"] as? [String: String] { workingActivityMap = map }
        if let micros = manifest["idleMicroClips"] as? [String] { idleMicroClips = micros }
        if let idleClip = stateMap["IDLE"], !idleClip.isEmpty {
            baseClipName = idleClip
            activeClipName = idleClip
        }
        body = clips[activeClipName]?.body
    }

    var activeClip: Clip {
        clips[activeClipName] ?? Clip(name: activeClipName, frames: [], frameMs: 180, loop: false, body: nil, bodyBox: [])
    }

    var frame: String {
        activeClip.frames.isEmpty ? "" : activeClip.frames[frameIndex]
    }

    /// How long one run of a clip takes, or nil when the skin has no such clip.
    func clipLengthMs(_ clipName: String) -> Int? {
        guard let clip = clips[clipName] else { return nil }
        return clip.frames.count * clip.frameMs
    }

    func applyState(_ state: String, activity: String? = nil) {
        guard Self.states.contains(state) else { return }
        baseState = state
        baseActivity = activity
        baseClipName = clip(for: state, activity: activity)
        pulseState = nil
        pulseDeadlineMs = nil
        pulseClipName = nil
        if overlayClipName == nil {
            activate(baseClipName)
        }
    }

    func applyPulse(state: String, ttlMs: Int, nowMs: Int, resumeState: String?, resumeActivity: String?) {
        guard Self.states.contains(state), ttlMs > 0 else { return }
        if let resume = resumeState, Self.states.contains(resume) {
            baseState = resume
            baseActivity = resumeActivity
            baseClipName = clip(for: resume, activity: resumeActivity)
        }
        pulseState = state
        pulseDeadlineMs = nowMs + ttlMs
        pulseClipName = clip(for: state, activity: nil)
        if overlayClipName == nil {
            activate(pulseClipName ?? baseClipName)
        }
    }

    @discardableResult
    func playOverlay(_ clipName: String) -> Bool {
        guard clips[clipName] != nil else { return false }
        overlayClipName = clipName
        activate(clipName)
        return true
    }

    func clearOverlay() {
        overlayClipName = nil
        activate(underlayClipName)
    }

    @discardableResult
    func playIdleMicro(index: Int = 0) -> Bool {
        guard baseState == "IDLE", overlayClipName == nil, pulseState == nil else { return false }
        guard !idleMicroClips.isEmpty else { return false }
        return playOverlay(idleMicroClips[index % idleMicroClips.count])
    }

    func advance(elapsedMs: Int, nowMs: Int) {
        guard elapsedMs >= 0 else { return }
        if let deadline = pulseDeadlineMs, nowMs >= deadline {
            pulseState = nil
            pulseDeadlineMs = nil
            pulseClipName = nil
            if overlayClipName == nil {
                activate(baseClipName)
            }
        }

        let clip = activeClip
        guard clip.frames.count > 1 else { return }
        frameElapsedMs += elapsedMs
        while frameElapsedMs >= clip.frameMs {
            frameElapsedMs -= clip.frameMs
            if frameIndex + 1 < clip.frames.count {
                frameIndex += 1
                continue
            }
            if clip.loop {
                frameIndex = 0
                continue
            }
            if let pending = pendingClipName {
                // The bridge is over, so the drawing it arrived on is the one on screen, and
                // the clip it was carrying starts from there.
                body = Self.bridgeArrives[clip.name] ?? body
                pendingClipName = nil
                activate(pending)
            } else if overlayClipName != nil {
                // A one-shot overlay is what a click or a drag release leaves behind, and
                // running out is the end of it: the clip underneath takes the frame back.
                overlayClipName = nil
                activate(underlayClipName)
            } else {
                frameIndex = clip.frames.count - 1
            }
            break
        }
    }

    func clip(for state: String, activity: String?) -> String {
        if state == "WORKING", let activity = activity, let mapped = workingActivityMap[activity] {
            return mapped
        }
        return stateMap[state] ?? stateMap["IDLE"] ?? baseClipName
    }

    private var underlayClipName: String {
        pulseClipName ?? baseClipName
    }

    /// Start a clip, taking the body bridge first when the clip needs another body.
    ///
    /// A state change that lands on the other drawing is neither a cut nor a dissolve: it is
    /// the bridge clip, and the requested clip starts on the bridge's last frame, which is
    /// the same drawing at rest. A change that arrives while a bridge is in flight joins the
    /// queue instead of cutting into it, because mid-bridge both drawings are on screen at
    /// once; the bridge finishes and the next one starts from where it landed.
    private func activate(_ clipName: String) {
        guard activeClipName != clipName else { return }
        if Self.nonCrossfadeClips.contains(clipName) {
            // The drag family follows the pointer, so it takes the frame now and drops the
            // transition that was in flight.
            pendingClipName = nil
            setClip(clipName)
            return
        }
        if pendingClipName != nil {
            pendingClipName = clipName
            return
        }
        let between = Self.bodyBridges["\(body ?? "")>\(clips[clipName]?.body ?? "")"]
        if let between, clips[between] != nil {
            pendingClipName = clipName
            setClip(between)
            return
        }
        setClip(clipName)
    }

    private func setClip(_ clipName: String) {
        activeClipName = clipName
        frameIndex = 0
        frameElapsedMs = 0
        // A bridge names no body: it is on its way to one, and the screen only arrives when
        // it runs out.
        body = clips[clipName]?.body ?? body
    }

    private static func asInt(_ value: Any?, fallback: Int) -> Int {
        if let i = value as? Int { return i }
        if let d = value as? Double { return Int(d) }
        if let s = value as? String { return Int(s) ?? fallback }
        return fallback
    }
}
