import AppKit

/// Content view: draws the pet + status card and handles mouse interactions.
/// Uses a flipped coordinate system (top-left origin) to match the original
/// Qt helper's drawing math.
final class PetView: NSView {
    weak var controller: PetController?

    /// Mouse-to-window grab offset, captured at mouseDown, used for 1:1 drag.
    private var grabOffset: NSPoint?
    private var windowOrigin: NSPoint?
    /// Whether `mouseDown` landed on the animal. A press that missed it starts neither a
    /// drag nor a click reaction.
    private var grabbed = false

    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { true }

    private var trackingArea: NSTrackingArea?

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let trackingArea { removeTrackingArea(trackingArea) }
        let area = NSTrackingArea(rect: bounds,
                                  options: [.mouseMoved, .mouseEnteredAndExited, .activeAlways, .inVisibleRect],
                                  owner: self, userInfo: nil)
        addTrackingArea(area)
        trackingArea = area
    }

    override func mouseEntered(with event: NSEvent) {
        hover(at: event)
    }

    override func mouseMoved(with event: NSEvent) {
        hover(at: event)
    }

    /// Only the animal and its card answer to the pointer. The window is wider and taller
    /// than the sprite and carries the bubble above it, so click and drag ignore a point
    /// outside the body; the card takes the pointer instead, to open a folded list.
    private func hover(at event: NSEvent) {
        guard let controller else { return }
        let point = convert(event.locationInWindow, from: nil)
        if controller.hitBubble(point) {
            controller.handleCardHover()
            return
        }
        controller.handleCardHoverExit()
        guard controller.hitBody(point) else { return }
        controller.handleHover(at: point)
    }

    override func mouseExited(with event: NSEvent) {
        controller?.handleCardHoverExit()
        controller?.handleHoverExit()
    }

    override func mouseDown(with event: NSEvent) {
        guard let window = window, let controller else { return }
        let point = convert(event.locationInWindow, from: nil)
        guard controller.hitBody(point) else { return }
        grabbed = true
        windowOrigin = window.frame.origin
        let mouse = NSEvent.mouseLocation
        grabOffset = NSPoint(x: mouse.x - window.frame.origin.x,
                             y: mouse.y - window.frame.origin.y)
    }

    override func mouseDragged(with event: NSEvent) {
        guard let grabOffset = grabOffset,
              let windowOrigin = windowOrigin,
              let window = window else { return }
        // Use absolute screen coordinates so the drag tracks the cursor 1:1.
        // View-relative deltas would fight the moving window and feel laggy.
        let mouse = NSEvent.mouseLocation
        let newOrigin = NSPoint(x: mouse.x - grabOffset.x,
                                y: mouse.y - grabOffset.y)
        if !(controller?.dragging ?? false) {
            let manhattan = abs(newOrigin.x - windowOrigin.x)
                + abs(newOrigin.y - windowOrigin.y)
            if manhattan <= 5 { return }
            controller?.beginDrag()
        }
        window.setFrameOrigin(newOrigin)
        controller?.updateDrag()
    }

    override func mouseUp(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        let wasDragging = controller?.dragging ?? false
        let wasGrab = grabbed
        grabOffset = nil
        windowOrigin = nil
        grabbed = false
        if wasDragging {
            controller?.endDrag()
        } else if wasGrab {
            controller?.handleClick(at: point, clickCount: event.clickCount)
        }
    }

    override func rightMouseDown(with event: NSEvent) {
        controller?.showMenu(with: event)
    }

    override func draw(_ dirtyRect: NSRect) {
        guard let controller = controller else { return }
        controller.drawPet(in: self)
        controller.drawCard(in: self)
    }
}
