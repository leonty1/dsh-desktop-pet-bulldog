import XCTest
@testable import BigFishCore

/// The Swift state machine, run against the real `assets/pet-manifest.json`
/// rather than a fixture, so a clip the skin renames or retimes cannot keep
/// passing a test that describes the old one. The Python port answers to the
/// same manifest: `runtime/animation_model.py` and `clip_length_ms` are checked
/// against these same facts, and a rule that changes on one side has to change
/// on the other.
final class AnimationModelTests: XCTestCase {
    private static let manifest: [String: Any] = {
        var url = URL(fileURLWithPath: #filePath)
        url.deleteLastPathComponent() // Tests/
        url.deleteLastPathComponent() // macos/
        url.deleteLastPathComponent() // native/
        url.deleteLastPathComponent() // repo root
        let manifestURL = url.appendingPathComponent("assets/pet-manifest.json")
        let data = try! Data(contentsOf: manifestURL)
        return try! JSONSerialization.jsonObject(with: data) as! [String: Any]
    }()

    private func makeModel() -> AnimationModel {
        AnimationModel(manifest: Self.manifest)
    }

    // MARK: - Ports of the Python suite

    func testWorkingActivitySelectsPersistentLoop() {
        let model = makeModel()
        model.applyState("WORKING", activity: "searching")
        XCTAssertEqual(model.activeClipName, "working")
        for tick in 0..<12 {
            model.advance(elapsedMs: 150, nowMs: tick * 150)
        }
        XCTAssertEqual(model.activeClipName, "working")
    }

    func testInteractionReturnsToLatestAgentState() {
        let model = makeModel()
        model.applyState("THINKING")
        XCTAssertTrue(model.playOverlay("head_pat"))
        model.applyState("WAITING")
        // head_pat is a 48-frame overlay (~4s at 83ms); the walk-through must
        // outlast it to observe the hand-back to the base state.
        for tick in 0..<30 {
            model.advance(elapsedMs: 200, nowMs: tick * 200)
        }
        XCTAssertEqual(model.activeClipName, "waiting")
        XCTAssertEqual(model.baseState, "WAITING")
    }

    func testPulseExpiresToCurrentBaseState() {
        let model = makeModel()
        model.applyState("WORKING", activity: "editing")
        model.applyPulse(
            state: "SUCCESS",
            ttlMs: 1000,
            nowMs: 100,
            resumeState: "IDLE",
            resumeActivity: nil
        )
        XCTAssertEqual(model.activeClipName, "success")
        model.advance(elapsedMs: 100, nowMs: 1200)
        XCTAssertEqual(model.activeClipName, "idle")
    }

    func testIdleMicroDoesNotInterruptAgentWork() {
        let model = makeModel()
        model.applyState("THINKING")
        XCTAssertFalse(model.playIdleMicro())
        XCTAssertEqual(model.activeClipName, "thinking")
    }

    func testDragOverlayReturnsToLatestAgentState() {
        let model = makeModel()
        model.applyState("THINKING")
        XCTAssertTrue(model.playOverlay("dragging"))
        model.applyState("WAITING")
        model.clearOverlay()
        XCTAssertEqual(model.activeClipName, "waiting")
        XCTAssertEqual(model.baseState, "WAITING")
    }

    func testDragTransitionsNeverCrossfade() {
        XCTAssertNil(AnimationModel.crossfadeDuration(previousClip: "idle", currentClip: "dragging"))
        XCTAssertNil(AnimationModel.crossfadeDuration(previousClip: "dragging", currentClip: "thinking"))
        XCTAssertNil(AnimationModel.crossfadeDuration(previousClip: "blink", currentClip: "idle"))
        for stage in ["dragging_release", "dragging_dizzy", "dragging_protest"] {
            XCTAssertNil(AnimationModel.crossfadeDuration(previousClip: "idle", currentClip: stage), stage)
            XCTAssertNil(AnimationModel.crossfadeDuration(previousClip: stage, currentClip: "idle"), stage)
        }
        XCTAssertEqual(
            AnimationModel.crossfadeDuration(previousClip: "thinking", currentClip: "working")!,
            0.10,
            accuracy: 0.0001
        )
        XCTAssertEqual(
            AnimationModel.crossfadeDuration(previousClip: "working", currentClip: "working")!,
            0.045,
            accuracy: 0.0001
        )
    }

    func testDragStageClipsAreRegistered() {
        // All three stages are real animations now, and the chain holds each for its own
        // length, so a stage that stopped being one would cut off mid-motion.
        let stages: [(name: String, loop: Bool, frames: Int)] = [
            ("dragging_release", false, 24),
            ("dragging_dizzy", true, 64),
            ("dragging_protest", true, 44),
        ]
        let model = makeModel()
        guard let clips = Self.manifest["clips"] as? [String: Any] else {
            return XCTFail("manifest has no clips")
        }
        for (name, loop, frames) in stages {
            guard let clip = clips[name] as? [String: Any] else {
                XCTFail("missing clip \(name)")
                continue
            }
            XCTAssertEqual((clip["frames"] as? [String])?.count, frames, name)
            XCTAssertEqual(clip["loop"] as? Bool, loop, name)
            XCTAssertTrue(model.playOverlay(name), name)
        }
    }

    func testDragStageAdvancesToItsLastFrame() {
        let model = makeModel()
        model.applyState("IDLE")
        XCTAssertTrue(model.playOverlay("dragging_dizzy"))
        for tick in 0..<10 {
            model.advance(elapsedMs: 260, nowMs: tick * 260)
        }
        XCTAssertEqual(model.activeClipName, "dragging_dizzy")
        model.clearOverlay()
        XCTAssertEqual(model.activeClipName, "idle")
    }

    func testDragReleaseChainMatchesRegisteredStageClips() {
        let clips = AnimationModel.dragReleaseClips
        XCTAssertEqual(clips, ["dragging_release", "dragging_dizzy", "dragging_protest"])
        // Every stage holds for its own animation's length, so a stage missing from the
        // manifest would abort the chain rather than run short.
        let model = makeModel()
        for name in clips {
            guard let length = model.clipLengthMs(name) else {
                return XCTFail("\(name) is not registered in the manifest")
            }
            XCTAssertGreaterThan(length, 0, name)
            XCTAssertTrue(model.playOverlay(name), name)
        }
    }

    // MARK: - Additional Swift-side edge cases

    func testUnknownStateIsIgnored() {
        let model = makeModel()
        model.applyState("BOGUS")
        XCTAssertEqual(model.baseState, "IDLE")
        XCTAssertEqual(model.activeClipName, "idle")
    }

    func testPulseWithNonPositiveTtlIsIgnored() {
        let model = makeModel()
        model.applyState("WORKING", activity: "editing")
        model.applyPulse(
            state: "SUCCESS",
            ttlMs: 0,
            nowMs: 100,
            resumeState: nil,
            resumeActivity: nil
        )
        XCTAssertNil(model.pulseState)
        XCTAssertEqual(model.activeClipName, "working")
    }

    func testUnknownOverlayReturnsFalse() {
        let model = makeModel()
        XCTAssertFalse(model.playOverlay("does_not_exist"))
    }

    func testStateMapCoversEveryState() {
        let model = makeModel()
        let expected: [(state: String, clip: String)] = [
            ("IDLE", "idle"),
            ("THINKING", "thinking"),
            ("WORKING", "working"),
            ("WAITING", "waiting"),
            ("SUCCESS", "success"),
            ("ERROR", "error"),
            ("DISCONNECTED", "idle"),
        ]
        for (state, clip) in expected {
            XCTAssertEqual(model.clip(for: state, activity: nil), clip)
        }
    }

    func testWorkingActivityMap() {
        let model = makeModel()
        let cases: [(activity: String, clip: String)] = [
            ("searching", "working"),
            ("commanding", "working_command"),
            ("editing", "working"),
            ("testing", "working_command"),
            ("using-tool", "working"),
        ]
        for (activity, clip) in cases {
            XCTAssertEqual(model.clip(for: "WORKING", activity: activity), clip)
        }
    }

    func testPulseResumeStateUpdatesBaseState() {
        let model = makeModel()
        model.applyState("THINKING")
        model.applyPulse(
            state: "SUCCESS",
            ttlMs: 1000,
            nowMs: 100,
            resumeState: "WAITING",
            resumeActivity: nil
        )
        XCTAssertEqual(model.baseState, "WAITING")
        XCTAssertEqual(model.activeClipName, "success")
        model.advance(elapsedMs: 100, nowMs: 1200)
        XCTAssertEqual(model.activeClipName, "waiting")
    }

    func testIdleMicroPlaysWhenIdle() {
        let model = makeModel()
        model.applyState("IDLE")
        XCTAssertTrue(model.playIdleMicro(index: 0))
        XCTAssertEqual(model.overlayClipName, "eat_token")
        XCTAssertEqual(model.activeClipName, "eat_token")
    }

    func testIdleMicroReturnsToIdleWhenFinished() {
        let model = makeModel()
        model.applyState("IDLE")
        XCTAssertTrue(model.playIdleMicro(index: 0)) // eat_token: 120 frames x 42ms (~5s)
        for tick in 0..<70 {
            model.advance(elapsedMs: 100, nowMs: tick * 100)
        }
        XCTAssertEqual(model.activeClipName, "idle")
    }

    func testSameInputSequenceYieldsSameEndState() {
        func run() -> (clip: String, base: String) {
            let model = makeModel()
            model.applyState("WORKING", activity: "searching")
            model.applyPulse(
                state: "SUCCESS",
                ttlMs: 500,
                nowMs: 0,
                resumeState: "WAITING",
                resumeActivity: nil
            )
            for tick in 0..<10 {
                model.advance(elapsedMs: 100, nowMs: tick * 100)
            }
            model.applyState("THINKING")
            model.clearOverlay()
            return (model.activeClipName, model.baseState)
        }
        // Same input sequence must always produce the same end state.
        let first = run()
        let second = run()
        let third = run()
        XCTAssertEqual(first.clip, second.clip)
        XCTAssertEqual(second.clip, third.clip)
        XCTAssertEqual(first.base, second.base)
        XCTAssertEqual(first.clip, "thinking")
        XCTAssertEqual(first.base, "THINKING")
    }
}
