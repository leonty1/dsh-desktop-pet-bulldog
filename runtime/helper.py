"""Phase 0 native BigFish helper.

The DSH plugin owns this process and sends newline-delimited JSON over stdin.
Closing stdin is a lifecycle signal: the helper exits instead of becoming an
independent desktop application.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import threading
import time
from collections import OrderedDict
from pathlib import Path
from typing import Any, TextIO

try:
    from .animation_model import AnimationModel, crossfade_duration
    from .layout_store import default_layout_path, load_layout, save_layout
    from .asset_paths import bundle_root
except ImportError:
    from animation_model import AnimationModel, crossfade_duration
    from layout_store import default_layout_path, load_layout, save_layout
    from asset_paths import bundle_root


PROTOCOL_VERSION = 1
STATES = {"IDLE", "THINKING", "WORKING", "WAITING", "SUCCESS", "ERROR", "DISCONNECTED"}
# The drag-release reaction, in order. Each stage holds for its own animation's length
# (`clip_length_ms`), so a stage always ends where it was drawn to end: the chain used to
# carry fixed holds from when these were single-frame poses, and they cut the 24- and
# 64-frame animations at a third of the way through, on the frame furthest from rest.
DRAG_RELEASE_CLIPS = ("dragging_release", "dragging_dizzy", "dragging_protest")
# The two rungs of the drowsiness ladder, and the only overlays an incoming message
# or interaction ends; other overlays are user-started reactions. Lying down borrows
# the waiting clip — the same lying body, drawn awake.
LIE_CLIP = "waiting"
SLEEP_CLIP = "sleep"
NAP_CLIPS = (LIE_CLIP, SLEEP_CLIP)
# How long the multi-task card stays open after the list changes, and how long it stays
# open after the pointer leaves it. The first is long enough to read three lines; the second
# only has to outlast a pointer crossing the bubble.
CARD_OPEN_MS = 6000
CARD_FOLD_AFTER_HOVER_MS = 2000
# A decoded 412x344 ARGB32 frame costs ~0.55 MB, so keeping every frame of a
# 24 fps set resident would need well over a gigabyte. Frames are read from disk
# once as compressed bytes and decoded through a bounded cache instead.
DECODED_FRAME_CACHE = 24


def quiet_minutes(env_name: str, layout: dict[str, Any], key: str) -> float:
    """Minutes of quiet before one rung of the drowsiness ladder.

    The environment carries the setting while DSH runs the helper; the saved layout is the
    fallback for a helper started on its own. Both are clamped to the range the settings
    slider offers, and 0 means the rung is never reached.
    """
    configured = os.environ.get(env_name)
    try:
        value = float(configured) if configured else layout[key]
    except (KeyError, TypeError, ValueError):
        value = layout.get(key, 0.0)
    return min(180.0, max(0.0, float(value)))


def clamped_minutes(value: Any, current: float) -> float:
    """The quiet-minute setting a CONFIG message carries, or the one already in force."""
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return min(180.0, max(0.0, float(value)))
    return current


def configure_qt_platform() -> None:
    """Prefer XWayland when available so desktop-window controls keep working."""
    if sys.platform != "linux" or os.environ.get("QT_QPA_PLATFORM"):
        return
    platforms: list[str] = []
    if os.environ.get("DISPLAY"):
        platforms.append("xcb")
    if os.environ.get("WAYLAND_DISPLAY"):
        platforms.append("wayland")
    if platforms:
        os.environ["QT_QPA_PLATFORM"] = ";".join(platforms)


def configure_stdio() -> None:
    """Make the JSONL pipe UTF-8 regardless of the Windows console code page."""
    for stream, errors in ((sys.stdin, "strict"), (sys.stdout, "backslashreplace"), (sys.stderr, "backslashreplace")):
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            reconfigure(encoding="utf-8", errors=errors)


def parse_message(line: str) -> dict[str, Any]:
    message = json.loads(line)
    if not isinstance(message, dict):
        raise ValueError("message must be an object")
    if message.get("protocolVersion") != PROTOCOL_VERSION:
        raise ValueError("unsupported protocol version")
    kind = message.get("kind")
    if kind in {"state", "pulse"} and message.get("state") not in STATES:
        raise ValueError("unsupported companion state")
    return message


def emit_reply(kind: str, **payload: Any) -> None:
    print(
        json.dumps(
            {"protocolVersion": PROTOCOL_VERSION, "kind": kind, "timestamp": int(time.time() * 1000), **payload},
            ensure_ascii=False,
        ),
        flush=True,
    )


# ---- Glove cursor (native Win32 .cur) ----
def _cursor_api() -> tuple[Any, Any, Any]:
    """Return configured (LoadCursorFromFileW, SetCursor, LoadCursorW) callables.

    Function signatures are declared explicitly so HCURSOR values are handled
    as pointer-sized handles: without argtypes/restype, ctypes treats the
    return value as a C int and truncates 64-bit HCURSORs. wintypes has no
    HCURSOR type, so ``wintypes.HANDLE`` (pointer-sized) is used.
    """
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.windll.user32

    load_from_file = user32.LoadCursorFromFileW
    load_from_file.argtypes = [wintypes.LPCWSTR]
    load_from_file.restype = wintypes.HANDLE

    set_cursor = user32.SetCursor
    set_cursor.argtypes = [wintypes.HANDLE]
    set_cursor.restype = wintypes.HANDLE

    load_cursor = user32.LoadCursorW
    load_cursor.argtypes = [wintypes.HANDLE, wintypes.LPCWSTR]
    load_cursor.restype = wintypes.HANDLE

    return load_from_file, set_cursor, load_cursor


def load_native_cursor(path: Path) -> Any:
    """Load a .cur cursor with LoadCursorFromFileW (pointer-sized handles).

    Returns None outside Windows or on failure; callers then fall back to the
    Qt default cursor. The resource is loaded at its natural size: per the MSDN
    remarks, LoadCursorFromFileW does not participate in DPI virtualization, so
    the 32x32 .cur is NOT scaled up automatically; the OS renders the cursor
    bitmap on the same pipeline as system cursors.
    """
    if sys.platform != "win32":
        return None
    try:
        handle = _cursor_api()[0](str(path))
        return handle or None
    except Exception:
        return None


def set_native_cursor(handle: Any) -> None:
    """Set the current cursor immediately (bypasses Qt's cursor pipeline)."""
    try:
        _cursor_api()[1](handle)
    except Exception:
        pass


def reset_native_cursor() -> None:
    """Restore the default arrow cursor (IDC_ARROW)."""
    try:
        import ctypes

        # MAKEINTRESOURCE(32512): the identifier is passed as a pointer value.
        arrow = ctypes.cast(ctypes.c_void_p(32512), ctypes.c_wchar_p)
        _cursor_api()[2](None, arrow)
    except Exception:
        pass


class GloveCursorController:
    """Pure state machine for the glove cursor; no Qt or Win32 dependencies.

    ``open_h`` / ``closed_h`` may be None (non-Windows, or the .cur assets are
    missing): every query then returns None, so callers simply fall back to the
    default cursor. This keeps all cursor-state decisions testable.
    """

    WM_LBUTTONDOWN = 0x0201

    def __init__(self, open_h: Any, closed_h: Any) -> None:
        self.open_h = open_h
        self.closed_h = closed_h
        self.pressed = False

    def handle_for(self, closed: bool) -> Any:
        return self.closed_h if closed else self.open_h

    def on_enter(self) -> Any:
        """Pointer entered the pet window: show the open hand."""
        return self.open_h

    def on_leave(self) -> None:
        """Pointer left the pet window: clear the pressed flag, reset to arrow."""
        self.pressed = False
        return None

    def on_press(self) -> Any:
        """Left button pressed: show the closed fist."""
        self.pressed = True
        return self.closed_h

    def on_release(self, inside: bool) -> Any:
        """Left button released: open hand when still inside, otherwise None."""
        self.pressed = False
        return self.open_h if inside else None

    def on_wm_setcursor(self, mouse_msg: int) -> Any:
        """WM_SETCURSOR decision: closed on WM_LBUTTONDOWN (or while pressed)."""
        return self.handle_for(mouse_msg == self.WM_LBUTTONDOWN or self.pressed)


class EventRecorder:
    def __init__(self, path: Path | None) -> None:
        self.path = path
        self._stream: TextIO | None = None
        if path is not None:
            path.parent.mkdir(parents=True, exist_ok=True)
            self._stream = path.open("a", encoding="utf-8")

    def record(self, message: dict[str, Any]) -> None:
        if self._stream is None:
            return
        self._stream.write(json.dumps(message, ensure_ascii=False) + "\n")
        self._stream.flush()

    def close(self) -> None:
        if self._stream is not None:
            self._stream.close()


def run_headless(recorder: EventRecorder) -> int:
    try:
        emit_reply("ready")
        for line in sys.stdin:
            if not line.strip():
                continue
            try:
                message = parse_message(line)
            except (ValueError, json.JSONDecodeError) as error:
                print(json.dumps({"kind": "error", "message": str(error)}), flush=True)
                continue
            recorder.record(message)
            if message.get("kind") == "ping":
                emit_reply("pong")
                continue
            if message.get("kind") == "shutdown":
                break
    finally:
        recorder.close()
    return 0


def run_visual(recorder: EventRecorder, snapshot_path: Path | None = None) -> int:
    configure_qt_platform()
    try:
        from PySide6.QtCore import (
            QAbstractNativeEventFilter,
            QObject,
            QPointF,
            QPoint,
            QRectF,
            Qt,
            QTimer,
            QUrl,
            Signal,
        )
        from PySide6.QtGui import QColor, QDesktopServices, QFont, QFontMetrics, QMouseEvent, QPainter, QPen, QPixmap
        from PySide6.QtWidgets import QApplication, QMenu, QWidget
    except ImportError:
        print(
            "PySide6 is required for visual mode. Run with --headless for protocol tests.",
            file=sys.stderr,
        )
        recorder.close()
        return 2

    class Inbox(QObject):
        message = Signal(dict)
        closed = Signal()

    manifest_path = bundle_root() / "assets" / "pet-manifest.json"
    asset_root = manifest_path.parent / "pet"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        print(f"Unable to load BigFish asset manifest: {error}", file=sys.stderr)
        recorder.close()
        return 2

    class GloveCursorFilter(QAbstractNativeEventFilter):
        """Owns WM_SETCURSOR while the pointer is over the pet window.

        The pet shows a glove hand cursor: an open hand on hover and a closed
        fist while the left button is held. Native .cur cursors are loaded with
        LoadCursorFromFileW and handed to the OS cursor pipeline directly (the
        same rendering path as system cursors; note the API loads the resource
        at its natural 32x32 size and does not participate in DPI
        virtualization). The message is consumed immediately instead of going
        through Qt's QCursor bitmaps, which are re-scaled by Qt and only take
        effect on the next cursor update cycle.
        """

        def __init__(self, widget: Any, open_h: Any, closed_h: Any) -> None:
            super().__init__()
            self.widget = widget
            self.open_h = open_h
            self.closed_h = closed_h

        def nativeEventFilter(self, event_type: bytes, message: Any):
            try:
                if event_type != b"windows_generic_MSG":
                    return False, 0
                import ctypes
                from ctypes import wintypes

                msg = wintypes.MSG.from_address(int(message))
                if msg.message != 0x0020:  # WM_SETCURSOR
                    return False, 0
                hwnd = int(msg.hWnd) if msg.hWnd else 0
                if hwnd and hwnd != int(self.widget.winId()):
                    # Leave popups (context menu, …) to Qt's default cursor.
                    return False, 0
                hit_test = msg.lParam & 0xFFFF
                if hit_test != 1:  # HTCLIENT
                    return False, 0
                mouse_msg = (msg.lParam >> 16) & 0xFFFF
                handle = self.widget.glove.on_wm_setcursor(mouse_msg)
                if handle:
                    set_native_cursor(handle)
                    return True, 0
            except Exception:
                pass
            return False, 0

    class CompanionWindow(QWidget):
        LABELS = {
            "IDLE": "休息中",
            "THINKING": "思考中",
            "WORKING": "干活中",
            "WAITING": "等你呢",
            "SUCCESS": "完成啦",
            "ERROR": "出问题了",
            "DISCONNECTED": "已断开",
        }

        def __init__(self) -> None:
            super().__init__()
            self.layout_path = default_layout_path()
            self.layout = load_layout(self.layout_path)
            configured_scale = os.environ.get("DSH_FRENCHIE_SCALE")
            try:
                self.scale = min(1.4, max(0.55, float(configured_scale))) if configured_scale else self.layout["scale"]
            except ValueError:
                self.scale = self.layout["scale"]
            configured_bubble_scale = os.environ.get("DSH_FRENCHIE_BUBBLE_SCALE")
            try:
                self.bubble_scale = (
                    min(1.2, max(0.8, float(configured_bubble_scale)))
                    if configured_bubble_scale
                    else self.layout["bubbleScale"]
                )
            except ValueError:
                self.bubble_scale = self.layout["bubbleScale"]
            configured_reduced_motion = os.environ.get("DSH_FRENCHIE_REDUCED_MOTION")
            self.reduced_motion = (
                configured_reduced_motion == "1"
                if configured_reduced_motion is not None
                else self.layout["reducedMotion"]
            )
            self.lie_after_minutes = quiet_minutes("DSH_FRENCHIE_LIE_AFTER_MINUTES", self.layout, "lieAfterMinutes")
            self.sleep_after_minutes = quiet_minutes("DSH_FRENCHIE_SLEEP_AFTER_MINUTES", self.layout, "sleepAfterMinutes")
            configured_sound_enabled = os.environ.get("DSH_FRENCHIE_SOUND_ENABLED")
            self.sound_enabled = configured_sound_enabled != "0"
            self.activity_level = os.environ.get("DSH_FRENCHIE_ACTIVITY_LEVEL", "normal")
            configured_bubble_mode = os.environ.get("DSH_FRENCHIE_BUBBLE_MODE")
            self.bubble_mode = (
                configured_bubble_mode
                if configured_bubble_mode in {"always", "hidden", "custom"}
                else self.layout.get("bubbleMode", "always")
            )
            configured_bubble_states = os.environ.get("DSH_FRENCHIE_BUBBLE_STATES")
            if configured_bubble_states is not None:
                self.bubble_states = [part.strip() for part in configured_bubble_states.split(",") if part.strip()]
            else:
                self.bubble_states = list(self.layout.get("bubbleStates", ["SUCCESS", "ERROR", "WAITING"]))
            self.model = AnimationModel(manifest)
            self.frame_sources: dict[str, bytes] = {}
            for clip in self.model.clips.values():
                for frame in clip.frames:
                    if frame in self.frame_sources:
                        continue
                    try:
                        self.frame_sources[frame] = (asset_root / frame).read_bytes()
                    except OSError as error:
                        raise RuntimeError(f"Unable to load BigFish frame: {frame}") from error
            self.decoded_frames: OrderedDict[str, QPixmap] = OrderedDict()
            # Fail here, not on the first paint, when the assets are unreadable or
            # the bundled Qt has no WebP image plugin.
            for clip in self.model.clips.values():
                if clip.frames:
                    self._pixmap(clip.frames[0])
            self.decoded_frames.clear()

            self.display_state = "IDLE"
            self.status_state = "IDLE"
            self.status_message = "我在这儿等新任务哦"
            self.status_detail = "DSH · 等待下一次任务"
            self.status_deadline_ms: int | None = self._now_ms() + 4200
            # Glove cursor: native .cur handles (loaded at natural size).
            self.glove_open_h = load_native_cursor(asset_root.parent / "cursor_grab.cur")
            self.glove_closed_h = load_native_cursor(asset_root.parent / "cursor_grabbing.cur")
            self.glove = GloveCursorController(self.glove_open_h, self.glove_closed_h)
            self.overlay_state: str | None = None
            self.overlay_message = ""
            self.overlay_detail = ""
            self.overlay_deadline_ms: int | None = None
            self.task = ""
            self.tasks: list[dict[str, Any]] = []
            # Whether the multi-task card is folded to one line. Only a list of two or more
            # folds; a single status line is one line already.
            self.card_folded = False
            # When the card folds, or None while it is open on its own or held by the pointer.
            self.fold_deadline_ms: int | None = None
            # Whether the pointer is resting on the card, so moving within it does not re-fold.
            self.card_hovered = False
            # The session ids the last list carried. A new task beginning or finishing
            # changes it; a task reporting progress does not.
            self.tasks_membership = ""
            self.webui_url = os.environ.get("DSH_FRENCHIE_WEBUI_URL", "http://127.0.0.1:3080/")
            self.shake_timer: QTimer | None = None
            self.shake_origin: QPoint | None = None
            self.shake_count = 0
            self.drag_origin: QPoint | None = None
            self.pet_origin: QPoint | None = None
            self.pet_x = 0
            self.pet_y = 0
            self.dragging = False
            # Whether the current press landed on the animal. A press that missed
            # it starts neither a drag nor a click reaction.
            self.grabbed = False
            self.drag_chain_id = 0
            self.last_tick_ms = self._now_ms()
            self.fade_from_pixmap: QPixmap | None = None
            self.fade_started = 0.0
            self.fade_duration = 0.15
            self.animation_timer = QTimer(self)
            self.animation_timer.setTimerType(Qt.TimerType.PreciseTimer)
            self.animation_timer.timeout.connect(self._tick)
            self.animation_timer.start(self._animation_interval_ms())
            self.micro_timer = QTimer(self)
            self.micro_timer.setSingleShot(True)
            self.micro_timer.timeout.connect(self._play_idle_micro)
            if not self.reduced_motion:
                self._schedule_micro()
            self.lie_timer = QTimer(self)
            self.lie_timer.setSingleShot(True)
            self.lie_timer.timeout.connect(self._lie_down)
            self.sleep_timer = QTimer(self)
            self.sleep_timer.setSingleShot(True)
            self.sleep_timer.timeout.connect(self._fall_asleep)
            self._note_activity()
            self.snapshot_saved = False
            self.setWindowTitle("DSH 法斗")
            self.setWindowFlags(
                Qt.WindowType.FramelessWindowHint
                | Qt.WindowType.WindowStaysOnTopHint
                | Qt.WindowType.Tool
            )
            self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
            # The bubble opens on hover, so moves without a button down must reach the widget.
            self.setMouseTracking(True)
            self._apply_window_size()
            QTimer.singleShot(0, self._restore_visible_position)

        def apply_message(self, message: dict[str, Any]) -> None:
            recorder.record(message)
            kind = message.get("kind")
            if kind == "shutdown":
                QApplication.quit()
                return
            previous_frame = self.model.frame
            previous_clip = self.model.active_clip_name
            if kind in {"state", "pulse", "task", "tasks"}:
                self._wake()
            if kind == "task":
                self.task = str(message.get("task", ""))
                self._show_status(
                    str(message.get("message", self.task)),
                    str(message.get("detail", "")),
                    self.model.base_state,
                    None if self.model.base_state in {"THINKING", "WORKING", "WAITING", "ERROR"} else 6000,
                )
            elif kind == "tasks":
                raw_tasks = message.get("tasks")
                self.tasks = raw_tasks if isinstance(raw_tasks, list) else []
                # The card reopens for a list that gained or lost a task. An active list
                # rewrites its lines every few seconds, and a fold timer restarted by each
                # of those would never come due.
                membership = "|".join(sorted(str(task.get("sessionId", "")) for task in self.tasks if isinstance(task, dict)))
                if membership != self.tasks_membership:
                    self.tasks_membership = membership
                    self._open_card()
                self._sync_bubble_size()
            elif kind == "config":
                self._apply_config(message)
            elif kind in {"state", "pulse"}:
                state = str(message.get("state", "IDLE"))
                self.display_state = state
                if kind == "pulse":
                    ttl_ms = max(250, int(message.get("ttlMs", 1800)))
                    resume_state = str(message.get("resumeState", self.model.base_state))
                    self.model.apply_pulse(
                        state,
                        ttl_ms,
                        self._now_ms(),
                        resume_state,
                        message.get("resumeActivity"),
                    )
                    self._show_status(
                        str(message.get("resumeMessage", self.LABELS.get(resume_state, resume_state))),
                        str(message.get("resumeDetail", "")),
                        resume_state,
                        None if resume_state in {"THINKING", "WORKING", "WAITING", "ERROR"} else ttl_ms + 2200,
                    )
                    self._show_overlay(
                        str(message.get("message", self.LABELS.get(state, state))),
                        str(message.get("detail", "")),
                        state,
                        ttl_ms,
                    )
                    if state in {"SUCCESS", "ERROR"}:
                        self._notify_alert(state)
                else:
                    activity = None if self.reduced_motion else message.get("activity")
                    self.model.apply_state(state, activity)
                    self._clear_overlay()
                    persistent = state in {"THINKING", "WORKING", "WAITING", "ERROR"}
                    self._show_status(
                        str(message.get("message", self.LABELS.get(state, state))),
                        str(message.get("detail", "")),
                        state,
                        None if persistent else 4200,
                    )
            self._sync_frame_transition(previous_frame, previous_clip)
            self._sync_bubble_size()
            self.update()
            if snapshot_path is not None and not self.snapshot_saved:
                QTimer.singleShot(180, self._save_snapshot)

        def _set_reduced_motion(self, enabled: bool) -> None:
            self.reduced_motion = enabled
            self.animation_timer.setInterval(self._animation_interval_ms())
            if enabled:
                self.micro_timer.stop()
                self._cancel_drag_release_chain()
            else:
                self._schedule_micro()

        def _apply_config(self, message: dict[str, Any]) -> None:
            """Apply a live CONFIG message without restarting the window."""
            scale = message.get("scale")
            if isinstance(scale, (int, float)) and not isinstance(scale, bool):
                self.scale = min(1.4, max(0.55, float(scale)))
            bubble_scale = message.get("bubbleScale")
            if isinstance(bubble_scale, (int, float)) and not isinstance(bubble_scale, bool):
                self.bubble_scale = min(1.2, max(0.8, float(bubble_scale)))
            lie_after = clamped_minutes(message.get("lieAfterMinutes"), self.lie_after_minutes)
            sleep_after = clamped_minutes(message.get("sleepAfterMinutes"), self.sleep_after_minutes)
            if lie_after != self.lie_after_minutes or sleep_after != self.sleep_after_minutes:
                self.lie_after_minutes = lie_after
                self.sleep_after_minutes = sleep_after
                self._note_activity()
            reduced_motion = message.get("reducedMotion")
            if isinstance(reduced_motion, bool) and reduced_motion != self.reduced_motion:
                self._set_reduced_motion(reduced_motion)
            sound_enabled = message.get("soundEnabled")
            if isinstance(sound_enabled, bool):
                self.sound_enabled = sound_enabled
            activity_level = message.get("activityLevel")
            if activity_level in {"quiet", "normal", "lively"}:
                self.activity_level = activity_level
                if not self.reduced_motion:
                    self._schedule_micro()
            bubble_mode = message.get("bubbleMode")
            if bubble_mode in {"always", "hidden", "custom"}:
                self.bubble_mode = bubble_mode
            bubble_states = message.get("bubbleStates")
            if isinstance(bubble_states, list):
                self.bubble_states = [str(state) for state in bubble_states if isinstance(state, str)]
            self._sync_bubble_size()
            self._save_layout()

        def _apply_glove(self, closed: bool) -> None:
            """Closed fist while the button is held, open hand otherwise.

            Sets the cursor directly so feedback is immediate instead of
            waiting for the next WM_SETCURSOR pass.
            """
            self.glove.pressed = closed
            handle = self.glove.handle_for(closed)
            if handle:
                set_native_cursor(handle)

        def _track_pointer(self, x: float, y: float) -> None:
            """Route a hover to the card first, then to the animal. The window is wider
            and taller than the sprite and carries the bubble above it, so a point that
            lands on the card is not a point on the pet."""
            if self._hit_bubble(x, y):
                self._handle_card_hover()
                return
            self._handle_card_hover_exit()
            if self._hit_body(x, y):
                self._wake()
                self._apply_glove(False)

        def enterEvent(self, event: Any) -> None:
            self._track_pointer(event.position().x(), event.position().y())
            super().enterEvent(event)

        def leaveEvent(self, event: Any) -> None:
            self._handle_card_hover_exit()
            self.glove.pressed = False
            reset_native_cursor()
            super().leaveEvent(event)

        def _animation_interval_ms(self) -> int:
            if self.reduced_motion:
                return 40
            # Sub-frame poll: a once-per-frame timer turns one early delivery into a whole-frame hitch.
            return max(8, min(20, round(self.model.active_clip.frame_ms / 3)))

        def _rearm_animation_interval(self) -> None:
            wanted = self._animation_interval_ms()
            if self.animation_timer.interval() != wanted:
                self.animation_timer.setInterval(wanted)

        def _pixmap(self, frame: str) -> QPixmap:
            cached = self.decoded_frames.get(frame)
            if cached is not None:
                self.decoded_frames.move_to_end(frame)
                return cached
            pixmap = QPixmap()
            if not pixmap.loadFromData(self.frame_sources[frame], "WEBP"):
                raise RuntimeError(f"Unable to load BigFish frame: {frame}")
            self.decoded_frames[frame] = pixmap
            while len(self.decoded_frames) > DECODED_FRAME_CACHE:
                self.decoded_frames.popitem(last=False)
            return pixmap

        def _tick(self) -> None:
            now_ms = self._now_ms()
            elapsed_ms = max(0, now_ms - self.last_tick_ms)
            self.last_tick_ms = now_ms
            had_pulse = self.model.pulse_state is not None
            previous_frame = self.model.frame
            previous_clip = self.model.active_clip_name
            model_elapsed = 0 if self.reduced_motion and self.model.active_clip.loop else elapsed_ms
            self.model.advance(model_elapsed, now_ms)
            self._sync_frame_transition(previous_frame, previous_clip)
            if had_pulse and self.model.pulse_state is None:
                self.display_state = self.model.base_state
            if self.overlay_deadline_ms is not None and now_ms >= self.overlay_deadline_ms:
                self._clear_overlay()
            if self.fold_deadline_ms is not None and now_ms >= self.fold_deadline_ms:
                self.fold_deadline_ms = None
                self.card_folded = True
                self._apply_window_size()
            self._rearm_animation_interval()
            self.update()

        def _play_idle_micro(self) -> None:
            if self.reduced_motion:
                return
            previous_frame = self.model.frame
            previous_clip = self.model.active_clip_name
            self.model.play_idle_micro(random.randrange(max(1, len(self.model.idle_micro_clips))))
            self._sync_frame_transition(previous_frame, previous_clip)
            self.update()
            self._schedule_micro()

        def _sync_frame_transition(
            self,
            previous_frame: str,
            previous_clip: str,
            *,
            allow_fade: bool = True,
        ) -> None:
            current_frame = self.model.frame
            if current_frame == previous_frame:
                return
            duration = crossfade_duration(previous_clip, self.model.active_clip_name) if allow_fade else None
            if duration is None:
                self.fade_from_pixmap = None
                return
            self.fade_from_pixmap = (
                self._pixmap(previous_frame) if previous_frame in self.frame_sources else None
            )
            self.fade_started = time.monotonic()
            self.fade_duration = duration

        def _play_model_overlay(
            self,
            clip_name: str,
            *,
            allow_fade: bool = True,
            repaint: bool = True,
        ) -> bool:
            previous_frame = self.model.frame
            previous_clip = self.model.active_clip_name
            if not self.model.play_overlay(clip_name):
                return False
            self._sync_frame_transition(previous_frame, previous_clip, allow_fade=allow_fade)
            if repaint:
                self.update()
            return True

        def _begin_drag(self) -> None:
            if self.dragging:
                return
            self._wake()
            self.dragging = True
            self.drag_chain_id += 1
            self.animation_timer.stop()
            self.micro_timer.stop()
            self._play_model_overlay("dragging", allow_fade=False, repaint=False)

        def _finish_drag(self) -> None:
            if not self.dragging:
                return
            now_ms = self._now_ms()
            previous_frame = self.model.frame
            previous_clip = self.model.active_clip_name
            # Expire an underlying pulse before revealing it after a long drag.
            self.model.advance(0, now_ms)
            self.model.clear_overlay()
            self._sync_frame_transition(previous_frame, previous_clip, allow_fade=False)
            self.dragging = False
            self.last_tick_ms = now_ms
            self.animation_timer.start(self._animation_interval_ms())
            if not self.reduced_motion:
                self._schedule_micro()
                self._run_drag_release_chain()

        def _run_drag_release_chain(self) -> None:
            """Play release -> dizzy -> protest, then hand back to the base state.

            Each stage runs its own clip to the end, so the chain is driven by the
            frames the skin declares; any new grab (or a manifest without the stage
            clips) aborts quietly.
            """
            self.drag_chain_id += 1
            token = self.drag_chain_id

            def play(index: int) -> None:
                if token != self.drag_chain_id or self.dragging:
                    return
                if self.reduced_motion or index >= len(DRAG_RELEASE_CLIPS):
                    self._clear_drag_overlay()
                    return
                clip_name = DRAG_RELEASE_CLIPS[index]
                hold_ms = self.model.clip_length_ms(clip_name)
                if hold_ms is None:
                    self._clear_drag_overlay()
                    return
                if not self._play_model_overlay(clip_name, allow_fade=False):
                    self._clear_drag_overlay()
                    return
                QTimer.singleShot(hold_ms, lambda: play(index + 1))

            QTimer.singleShot(0, lambda: play(0))

        def _clear_drag_overlay(self) -> None:
            if self.dragging:
                return
            previous_frame = self.model.frame
            previous_clip = self.model.active_clip_name
            self.model.clear_overlay()
            self._sync_frame_transition(previous_frame, previous_clip)
            self.update()

        def _cancel_drag_release_chain(self) -> None:
            self.drag_chain_id += 1
            if not self.dragging and self.model.active_clip_name in set(DRAG_RELEASE_CLIPS):
                self._clear_drag_overlay()

        def _schedule_micro(self) -> None:
            if self.reduced_motion:
                self.micro_timer.stop()
                return
            intervals = {
                "quiet": (12000, 24000),
                "normal": (6500, 12500),
                "lively": (3500, 8000),
            }
            lower, upper = intervals.get(self.activity_level, intervals["normal"])
            self.micro_timer.start(random.randint(lower, upper))

        def _note_activity(self) -> None:
            """Re-arm the countdown to each rung of the ladder; a message or an interaction
            is a sign of life, so the pet only settles while nothing is happening."""
            self.lie_timer.stop()
            self.sleep_timer.stop()
            # Lying down only comes over the pet when there is still time before the nap.
            if self.lie_after_minutes > 0 and (
                self.sleep_after_minutes <= 0 or self.lie_after_minutes < self.sleep_after_minutes
            ):
                self.lie_timer.start(round(self.lie_after_minutes * 60_000))
            if self.sleep_after_minutes > 0:
                self.sleep_timer.start(round(self.sleep_after_minutes * 60_000))

        def _lie_down(self) -> None:
            # Settle onto the lying body with the eyes still open. The model plays the walk
            # over on its own: lying and sitting are separate drawings, and a change of
            # drawing is a bridge clip.
            if self.dragging or self.model.base_state != "IDLE" or self.model.overlay_clip_name is not None:
                return
            self._play_model_overlay(LIE_CLIP)

        def _fall_asleep(self) -> None:
            # The nap then holds until `_wake` drops it. Coming from sitting, the model lies
            # the pet down first; coming from the lying rung the two differ only by the lids
            # and the bubbles, so the switch is a plain crossfade.
            if self.dragging or self.model.base_state != "IDLE":
                return
            if self.model.overlay_clip_name not in (None, LIE_CLIP):
                return
            self._play_model_overlay(SLEEP_CLIP)

        def _wake(self) -> None:
            # Only the ladder's own rungs end on activity; a click reaction the user started
            # must not be cut off by a DSH message. Dropping the overlay is the whole of
            # getting up — the model answers it with the rise, which lands on whatever state
            # is underneath.
            if self.model.overlay_clip_name in NAP_CLIPS:
                previous_frame = self.model.frame
                previous_clip = self.model.active_clip_name
                self.model.clear_overlay()
                self._sync_frame_transition(previous_frame, previous_clip)
                self.update()
            self._note_activity()

        def _bubble_visible(self) -> bool:
            if self.bubble_mode == "hidden":
                return False
            if self.bubble_mode == "always":
                return True
            if len(self.tasks) >= 2:
                return any(task.get("state") in self.bubble_states for task in self.tasks)
            state = self.overlay_state or self.status_state or self.model.base_state or "IDLE"
            return state in self.bubble_states

        def _sync_bubble_size(self) -> None:
            old_size = (self.width(), self.height())
            self._apply_window_size()
            if (self.width(), self.height()) != old_size:
                self._move_to_pet(self.pet_x, self.pet_y)

        def _apply_window_size(self) -> None:
            pet_width = round(int(manifest["maxFrameWidth"]) * self.scale)
            pet_height = round(int(manifest["maxFrameHeight"]) * self.scale)
            if self._bubble_visible():
                bubble_width = self._card_width()
                bubble_height = self._card_height()
                self.setFixedSize(max(pet_width + 50, bubble_width + 28), pet_height + bubble_height + 34)
            else:
                self.setFixedSize(pet_width + 50, pet_height + 26)

        def _screen_geometry_at(self, x: int, y: int):
            screen = QApplication.screenAt(QPoint(x, y)) or QApplication.primaryScreen()
            if screen is None:
                return None
            return screen.availableGeometry()

        def _pet_size(self) -> tuple[int, int]:
            return (
                round(int(manifest["maxFrameWidth"]) * self.scale),
                round(int(manifest["maxFrameHeight"]) * self.scale),
            )

        def _move_to_pet(self, pet_x: int, pet_y: int) -> None:
            """Move the window so the pet stands at (pet_x, pet_y).

            The pet position is the source of truth; the window is just the
            container that keeps the status bubble on screen.  While the window
            fits on screen the pet stays centered under it.  When the window
            would have to leave the screen, it is clamped and the pet shifts
            inside the window instead, so the pet can stand at any screen
            position while the bubble stays fully visible.
            """
            pet_width, pet_height = self._pet_size()
            geometry = self._screen_geometry_at(pet_x, pet_y)
            if geometry is None:
                self.pet_x = pet_x
                self.pet_y = pet_y
                self.move(
                    pet_x - (self.width() - pet_width) // 2,
                    pet_y - (self.height() - pet_height - 8),
                )
                self.update()
                return

            min_x = geometry.left()
            max_x = max(min_x, geometry.right() - self.width() + 1)
            min_y = geometry.top()
            max_y = max(min_y, geometry.bottom() - self.height() + 1)

            center_offset_x = (self.width() - pet_width) // 2
            window_x = min(max(pet_x - center_offset_x, min_x), max_x)
            offset_x = min(max(pet_x - window_x, 0), self.width() - pet_width)
            self.pet_x = window_x + offset_x

            top_offset_y = self.height() - pet_height - 8
            window_y = min(max(pet_y - top_offset_y, min_y), max_y)
            self.pet_y = window_y + top_offset_y

            self.move(window_x, window_y)
            self.update()

        def _pet_offset_x(self, pet_width: int) -> int:
            return min(max(self.pet_x - self.x(), 0), self.width() - pet_width)

        def _pet_rect(self) -> tuple[int, int, int, int]:
            pet_width, pet_height = self._pet_size()
            return self._pet_offset_x(pet_width), self.height() - pet_height - 8, pet_width, pet_height

        def _body_rect(self) -> tuple[float, float, float, float]:
            """The part of the window the animal itself covers. Dragging, clicking and
            hover all use it, so the empty margin around the sprite and the bubble above
            it are not treated as the pet.
            """
            pet_x, pet_y, pet_width, pet_height = self._pet_rect()
            box = self.model.active_clip.body_box
            max_frame_width = int(manifest["maxFrameWidth"])
            if len(box) != 4 or max_frame_width <= 0:
                return pet_x, pet_y, pet_width, pet_height
            k = pet_width / max_frame_width
            return pet_x + box[0] * k, pet_y + box[1] * k, box[2] * k, box[3] * k

        def _hit_body(self, x: float, y: float) -> bool:
            body_x, body_y, body_width, body_height = self._body_rect()
            return body_x <= x < body_x + body_width and body_y <= y < body_y + body_height

        def _hit_bubble(self, x: float, y: float) -> bool:
            # The card is a hover target in its own right: resting the pointer on it is how
            # a folded list opens again. It is only a target while it is drawn, and four
            # points of slack make the folded chip as easy to catch as the open list.
            if not self._bubble_visible():
                return False
            card_x, card_y, card_width, card_height = self._bubble_rect()
            return card_x - 4 <= x < card_x + card_width + 4 and card_y - 4 <= y < card_y + card_height + 4

        def _bubble_rect(self) -> tuple[int, int, int, int]:
            card_width = self._card_width()
            card_height = self._card_height()
            pet_width, _ = self._pet_size()
            pet_center_x = self._pet_offset_x(pet_width) + pet_width // 2
            margin = 14
            card_x = pet_center_x - card_width // 2
            min_x = margin
            max_x = self.width() - card_width - margin
            if max_x < min_x:
                max_x = min_x
            card_x = min(max(card_x, min_x), max_x)
            return card_x, 7, card_width, card_height

        def _restore_visible_position(self) -> None:
            pet_width, pet_height = self._pet_size()
            top_offset = self.height() - pet_height - 8
            center_offset = (self.width() - pet_width) // 2
            saved_pet_x = self.layout.get("petX")
            saved_pet_y = self.layout.get("petY")
            if isinstance(saved_pet_x, int) and isinstance(saved_pet_y, int):
                pet_x, pet_y = saved_pet_x, saved_pet_y
            else:
                saved_x = self.layout.get("x")
                saved_y = self.layout.get("y")
                if isinstance(saved_x, int) and isinstance(saved_y, int):
                    # Legacy layouts stored the window position.  Recreate the
                    # pet position that the old centered layout would have had.
                    pet_x = saved_x + center_offset
                    pet_y = saved_y + top_offset
                else:
                    geometry = self._screen_geometry_at(self.x() + self.width() // 2, self.y() + self.height() // 2)
                    if geometry is None:
                        return
                    pet_x = geometry.right() - pet_width - 24
                    pet_y = geometry.bottom() - pet_height - 24
            self._move_to_pet(pet_x, pet_y)

        def _save_layout(self) -> None:
            self.layout = {
                "version": 1,
                "x": self.x(),
                "y": self.y(),
                "petX": self.pet_x,
                "petY": self.pet_y,
                "scale": self.scale,
                "bubbleScale": self.bubble_scale,
                "reducedMotion": self.reduced_motion,
                "lieAfterMinutes": self.lie_after_minutes,
                "sleepAfterMinutes": self.sleep_after_minutes,
                "bubbleMode": self.bubble_mode,
                "bubbleStates": self.bubble_states,
            }
            try:
                save_layout(self.layout_path, self.layout)
            except OSError as error:
                print(f"Unable to save BigFish layout: {error}", file=sys.stderr)

        def _save_snapshot(self) -> None:
            if snapshot_path is None or self.snapshot_saved:
                return
            snapshot_path.parent.mkdir(parents=True, exist_ok=True)
            self.snapshot_saved = self.grab().save(str(snapshot_path), "PNG")

        def _show_status(self, message: str, detail: str, state: str, ttl_ms: int | None) -> None:
            self.status_message = message
            self.status_detail = detail
            self.status_state = state
            self.status_deadline_ms = None if ttl_ms is None else self._now_ms() + ttl_ms

        def _show_overlay(self, message: str, detail: str, state: str, ttl_ms: int) -> None:
            self.overlay_message = message
            self.overlay_detail = detail or self.status_detail
            self.overlay_state = state
            self.overlay_deadline_ms = self._now_ms() + ttl_ms

        def _clear_overlay(self) -> None:
            self.overlay_message = ""
            self.overlay_detail = ""
            self.overlay_state = None
            self.overlay_deadline_ms = None

        @staticmethod
        def _now_ms() -> int:
            return int(time.monotonic() * 1000)

        def _current_card(self) -> tuple[str, str, str] | None:
            now_ms = self._now_ms()
            if self.overlay_message and (
                self.overlay_deadline_ms is None or now_ms < self.overlay_deadline_ms
            ):
                return self.overlay_message, self.overlay_detail, self.overlay_state or self.status_state
            if self.status_message and (
                self.status_deadline_ms is None or now_ms < self.status_deadline_ms
            ):
                return self.status_message, self.status_detail, self.status_state
            return None

        @staticmethod
        def _status_colors(state: str) -> tuple[QColor, QColor]:
            return {
                "SUCCESS": (QColor("#D9F7E4"), QColor("#12B85A")),
                "ERROR": (QColor("#FDE3E3"), QColor("#E5484D")),
                "WAITING": (QColor("#FFF0CE"), QColor("#D88A00")),
                "THINKING": (QColor("#E2ECFF"), QColor("#4C78E8")),
                "WORKING": (QColor("#DDEBFF"), QColor("#3478F6")),
                "DISCONNECTED": (QColor("#ECEEF1"), QColor("#7B818A")),
            }.get(state, (QColor("#ECEEF1"), QColor("#747A84")))

        def _draw_status_icon(
            self,
            painter: QPainter,
            state: str,
            center_x: float,
            center_y: float,
            s: float,
        ) -> None:
            background, foreground = self._status_colors(state)
            radius = 15 * s
            # The state glyph. Its marks are placed as fractions of the disc so the
            # icon keeps the same look at any bubble scale.
            u = radius / 15
            painter.setPen(Qt.PenStyle.NoPen)
            painter.setBrush(background)
            painter.drawEllipse(QRectF(center_x - radius, center_y - radius, radius * 2, radius * 2))
            if state in {"SUCCESS", "ERROR", "WAITING"}:
                pen = QPen(foreground, 2.4 * u)
                pen.setCapStyle(Qt.PenCapStyle.RoundCap)
                pen.setJoinStyle(Qt.PenJoinStyle.RoundJoin)
                painter.setPen(pen)
                painter.setBrush(Qt.BrushStyle.NoBrush)
            if state == "SUCCESS":
                painter.drawLine(
                    QPointF(center_x - 7 * u, center_y),
                    QPointF(center_x - 2 * u, center_y + 5.5 * u),
                )
                painter.drawLine(
                    QPointF(center_x - 2 * u, center_y + 5.5 * u),
                    QPointF(center_x + 8 * u, center_y - 7 * u),
                )
            elif state == "ERROR":
                painter.drawLine(
                    QPointF(center_x - 6 * u, center_y - 6 * u),
                    QPointF(center_x + 6 * u, center_y + 6 * u),
                )
                painter.drawLine(
                    QPointF(center_x + 6 * u, center_y - 6 * u),
                    QPointF(center_x - 6 * u, center_y + 6 * u),
                )
            elif state == "WAITING":
                painter.drawLine(
                    QPointF(center_x, center_y - 7 * u),
                    QPointF(center_x, center_y + 2 * u),
                )
                painter.setPen(Qt.PenStyle.NoPen)
                painter.setBrush(foreground)
                painter.drawEllipse(QRectF(center_x - 1.5 * u, center_y + 5.5 * u, 3 * u, 3 * u))
            elif state in {"THINKING", "WORKING"}:
                painter.setPen(Qt.PenStyle.NoPen)
                painter.setBrush(foreground)
                for offset in (-6.0, 0.0, 6.0):
                    painter.drawEllipse(
                        QRectF(center_x + offset * u - 2 * u, center_y - 2 * u, 4 * u, 4 * u)
                    )
            else:
                painter.setPen(Qt.PenStyle.NoPen)
                painter.setBrush(foreground)
                painter.drawEllipse(QRectF(center_x - 3.5 * u, center_y - 3.5 * u, 7 * u, 7 * u))

        def _card_height(self) -> int:
            # The bubble is a two-line caption, not a panel: it carries the state title
            # and the live work line, and stops there so it never crowds the animal or
            # the desktop. A list of tasks is the same object, folded to one line once it
            # has been read.
            if len(self.tasks) >= 2:
                if self.card_folded:
                    return round(34 * self.bubble_scale)
                # The title, up to three rows, and a row naming whatever did not fit.
                # Leaving the last one out made a fourth task print its line on the
                # desktop below the card, which was never tall enough to hold it.
                lines = min(len(self.tasks), 3) + (1 if len(self.tasks) > 3 else 0)
                return round((27 + lines * 17) * self.bubble_scale)
            return round(62 * self.bubble_scale)

        def _card_width(self) -> int:
            """The open card is a fixed column; a folded one takes the width its single
            line needs, so it reads as a chip over the pet rather than an empty bar the
            length of the list it hid."""
            full = round(300 * self.bubble_scale)
            if not (len(self.tasks) >= 2 and self.card_folded):
                return full
            font = QFont("Microsoft YaHei UI")
            font.setPointSizeF(max(7.0, 8.5 * self.bubble_scale))
            # 24 to the text past the dot, 12 before the count, 16 for the count, 13 padding.
            text = self._task_line(self._first_started())
            return min(full, max(round(110 * self.bubble_scale), round(QFontMetrics(font).horizontalAdvance(text) + 65 * self.bubble_scale)))

        def _first_started(self) -> dict[str, Any] | None:
            """The task a folded card names: the one that began first, so the work that
            has been going longest is what stays on screen. A task with no start yet
            sorts last."""
            if not self.tasks:
                return None
            return min(self.tasks, key=lambda task: task.get("startedAt") if isinstance(task.get("startedAt"), int) else (1 << 62))

        def _open_card(self) -> None:
            """Open the card after a change to the list and start the countdown that
            folds it again. The pointer holds it open, so a change under it does not arm
            the fold."""
            if len(self.tasks) < 2:
                self.card_folded = False
                self.fold_deadline_ms = None
                return
            self.fold_deadline_ms = None if self.card_hovered else self._now_ms() + CARD_OPEN_MS
            if self.card_folded:
                self.card_folded = False
                self._apply_window_size()
            self.update()

        def _handle_card_hover(self) -> None:
            """The pointer is on the card: open it and keep it open until the pointer leaves."""
            if len(self.tasks) < 2 or self.card_hovered:
                return
            self.card_hovered = True
            self.fold_deadline_ms = None
            if self.card_folded:
                self.card_folded = False
                self._apply_window_size()
            self.update()

        def _handle_card_hover_exit(self) -> None:
            """The pointer has left the card. It folds again shortly rather than at once,
            so a pointer crossing the bubble on its way somewhere else does not flash the
            list."""
            if len(self.tasks) < 2 or not self.card_hovered:
                return
            self.card_hovered = False
            self.fold_deadline_ms = self._now_ms() + CARD_FOLD_AFTER_HOVER_MS

        def _draw_card_background(
            self,
            painter: QPainter,
            card_x: int,
            card_y: int,
            card_width: int,
            card_height: int,
            corner_radius: int,
            s: float,
        ) -> None:
            painter.setPen(Qt.PenStyle.NoPen)
            painter.setBrush(QColor(17, 24, 39, 13))
            painter.drawRoundedRect(
                card_x + 1, card_y + round(13 * s), card_width - 2, card_height,
                corner_radius, corner_radius,
            )
            painter.setBrush(QColor(17, 24, 39, 18))
            painter.drawRoundedRect(
                card_x, card_y + round(7 * s), card_width, card_height,
                corner_radius, corner_radius,
            )
            painter.setPen(QPen(QColor(218, 221, 226, 205), 1))
            painter.setBrush(QColor(252, 252, 253, 248))
            painter.drawRoundedRect(
                card_x, card_y, card_width, card_height,
                corner_radius, corner_radius,
            )

        def _draw_multi_task_card(
            self,
            painter: QPainter,
            card_x: int,
            card_y: int,
            card_width: int,
            card_height: int,
            s: float,
        ) -> None:
            title_font = QFont("Microsoft YaHei UI")
            title_font.setPointSizeF(max(8.0, 10.5 * s))
            title_font.setWeight(QFont.Weight.DemiBold)
            detail_font = QFont("Microsoft YaHei UI")
            detail_font.setPointSizeF(max(7.0, 8.5 * s))
            text_x = card_x + round(13 * s)
            text_width = max(40, card_width - round(26 * s))

            if self.card_folded:
                # One line: the task that began first, and how many others are waiting
                # behind it. The count sits against the right edge so the two never
                # collide however long the project name is.
                self._draw_task_row(painter, detail_font, text_x, card_y + round(9 * s), text_width - round(34 * s), self._first_started(), s)
                painter.setPen(QColor("#9AA0A6"))
                painter.drawText(
                    card_x + card_width - round(44 * s), card_y + round(9 * s), round(31 * s), max(12, round(16 * s)),
                    Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter,
                    f"+{max(0, len(self.tasks) - 1)}",
                )
                return

            painter.setFont(title_font)
            painter.setPen(QColor("#25282D"))
            title = f"{len(self.tasks)} 个任务进行中"
            painter.drawText(
                text_x,
                card_y + round(8 * s),
                text_width,
                max(12, round(18 * s)),
                Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter,
                QFontMetrics(title_font).elidedText(title, Qt.TextElideMode.ElideRight, text_width),
            )
            painter.setFont(detail_font)
            for index, task in enumerate(self.tasks[:3]):
                self._draw_task_row(painter, detail_font, text_x, card_y + round((28 + index * 17) * s), text_width, task, s)
            if len(self.tasks) > 3:
                more = f"还有 {len(self.tasks) - 3} 个任务…"
                painter.setPen(QColor("#9AA0A6"))
                painter.drawText(
                    text_x + round(11 * s),
                    card_y + round((28 + 3 * 17) * s),
                    text_width,
                    max(12, round(16 * s)),
                    Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter,
                    more,
                )

        def _task_line(self, task: dict[str, Any] | None) -> str:
            """What one task reads as: its state and the project it belongs to, falling
            back to the task line and then to the message. The folded card measures this
            string to size itself, so the two cannot disagree about what the line says."""
            state = str((task or {}).get("state", "IDLE"))
            state_label = self.LABELS.get(state, state)
            label = (task or {}).get("project") or (task or {}).get("task") or (task or {}).get("message") or state_label
            return f"{state_label} · {label}"

        def _draw_task_row(
            self,
            painter: QPainter,
            font: QFont,
            x: int,
            y: int,
            width: int,
            task: dict[str, Any] | None,
            s: float,
        ) -> None:
            """One task: a dot in the color of its state, and its line beside it."""
            if task is None:
                return
            _, foreground = self._status_colors(str(task.get("state", "IDLE")))
            painter.setPen(Qt.PenStyle.NoPen)
            painter.setBrush(foreground)
            painter.drawEllipse(x, y + round(3 * s), round(6 * s), round(6 * s))
            text_width = max(20, width - round(11 * s))
            line = self._task_line(task)
            painter.setFont(font)
            painter.setPen(QColor("#747981"))
            painter.drawText(
                x + round(11 * s),
                y,
                text_width,
                max(12, round(16 * s)),
                Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter,
                QFontMetrics(font).elidedText(line, Qt.TextElideMode.ElideRight, text_width),
            )

        def _notify_alert(self, state: str) -> None:
            if self.sound_enabled:
                played = False
                if sys.platform == "win32":
                    try:
                        import winsound

                        sound_name = "success.wav" if state == "SUCCESS" else "error.wav"
                        sound_path = bundle_root() / "assets" / "sounds" / sound_name
                        winsound.PlaySound(
                            str(sound_path),
                            winsound.SND_FILENAME | winsound.SND_ASYNC | winsound.SND_NODEFAULT,
                        )
                        played = True
                    except (ImportError, OSError, RuntimeError):
                        pass
                if not played:
                    try:
                        QApplication.beep()
                    except Exception:
                        pass
            self._shake_window()

        def _shake_window(self) -> None:
            if self.shake_timer is None:
                self.shake_timer = QTimer(self)
                self.shake_timer.timeout.connect(self._shake_tick)
            self.shake_origin = self.pos()
            self.shake_count = 0
            self.shake_timer.start(30)

        def _shake_tick(self) -> None:
            offsets = [(6, 0), (-6, 0), (4, 0), (-4, 0), (2, 0), (-2, 0), (0, 0)]
            if self.shake_origin is None:
                self.shake_timer.stop()
                return
            if self.shake_count < len(offsets):
                dx, dy = offsets[self.shake_count]
                self.move(self.shake_origin.x() + dx, self.shake_origin.y() + dy)
                self.shake_count += 1
            else:
                self.shake_timer.stop()
                self.move(self.shake_origin)

        def paintEvent(self, _event: Any) -> None:
            painter = QPainter(self)
            painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)
            # 平滑缩放：放大/缩小时插值，避免锯齿和模糊
            painter.setRenderHint(QPainter.RenderHint.SmoothPixmapTransform, True)
            card = self._current_card() if self._bubble_visible() else None
            bubble_height = 12
            card_x, card_y, card_width, card_height = self._bubble_rect()
            s = self.bubble_scale
            corner_radius = round(13 * s)

            if len(self.tasks) >= 2 and self._bubble_visible():
                bubble_height = card_y + card_height + 19
                self._draw_card_background(painter, card_x, card_y, card_width, card_height, corner_radius, s)
                self._draw_multi_task_card(painter, card_x, card_y, card_width, card_height, s)
            elif card:
                title, detail, card_state = card
                bubble_height = card_y + card_height + 19
                self._draw_card_background(painter, card_x, card_y, card_width, card_height, corner_radius, s)
                icon_center_x = card_x + card_width - round(27 * s)
                icon_center_y = card_y + card_height // 2
                self._draw_status_icon(painter, card_state, icon_center_x, icon_center_y, s)

                text_x = card_x + round(13 * s)
                text_width = max(40, card_width - round(64 * s))
                title_font = QFont("Microsoft YaHei UI")
                title_font.setPointSizeF(max(8.0, 10.5 * s))
                title_font.setWeight(QFont.Weight.DemiBold)
                detail_font = QFont("Microsoft YaHei UI")
                detail_font.setPointSizeF(max(7.0, 8.5 * s))
                painter.setFont(title_font)
                painter.setPen(QColor("#25282D"))
                title_text = QFontMetrics(title_font).elidedText(
                    title,
                    Qt.TextElideMode.ElideRight,
                    text_width,
                )
                painter.drawText(
                    text_x,
                    card_y + round(10 * s),
                    text_width,
                    max(12, round(21 * s)),
                    Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter,
                    title_text,
                )
                painter.setFont(detail_font)
                painter.setPen(QColor("#747981"))
                detail_text = QFontMetrics(detail_font).elidedText(
                    detail,
                    Qt.TextElideMode.ElideRight,
                    text_width,
                )
                painter.drawText(
                    text_x,
                    card_y + round(32 * s),
                    text_width,
                    max(12, round(19 * s)),
                    Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter,
                    detail_text,
                )

            pixmap = self._pixmap(self.model.frame)

            fade_alpha = 1.0
            if self.fade_from_pixmap is not None and not self.fade_from_pixmap.isNull():
                fade_elapsed = time.monotonic() - self.fade_started
                if fade_elapsed < self.fade_duration:
                    fade_alpha = min(1.0, (fade_elapsed / self.fade_duration) ** 0.7)
                else:
                    self.fade_from_pixmap = None

            def draw_pet(pix: QPixmap, alpha: float) -> None:
                pw = pix.width() * self.scale
                ph = pix.height() * self.scale
                x = self._pet_offset_x(pw)
                y = self.height() - ph - 8
                if bubble_height > y:
                    y = bubble_height
                painter.save()
                painter.setOpacity(alpha)
                painter.drawPixmap(QRectF(x, y, pw, ph), pix, QRectF(0, 0, pix.width(), pix.height()))
                painter.restore()

            if fade_alpha < 1.0 and self.fade_from_pixmap is not None:
                # Keep the old frame opaque underneath so the pet never flashes transparent.
                draw_pet(self.fade_from_pixmap, 1.0)
            draw_pet(pixmap, fade_alpha)

        def mousePressEvent(self, event: QMouseEvent) -> None:
            if event.button() == Qt.MouseButton.LeftButton:
                # A press that misses the body arms neither a drag nor a click.
                self.grabbed = self._hit_body(event.position().x(), event.position().y())
                if not self.grabbed:
                    return
                self._apply_glove(True)
                self.drag_origin = event.globalPosition().toPoint()
                self.pet_origin = QPoint(self.pet_x, self.pet_y)
                self.dragging = False

        def mouseMoveEvent(self, event: QMouseEvent) -> None:
            if self.drag_origin is not None and self.pet_origin is not None:
                if not self.dragging and (event.globalPosition().toPoint() - self.drag_origin).manhattanLength() > 5:
                    self._begin_drag()
                delta = event.globalPosition().toPoint() - self.drag_origin
                self._move_to_pet(self.pet_origin.x() + delta.x(), self.pet_origin.y() + delta.y())
                return
            if event.buttons() == Qt.MouseButton.NoButton:
                self._track_pointer(event.position().x(), event.position().y())

        def mouseReleaseEvent(self, event: QMouseEvent) -> None:
            if event.button() == Qt.MouseButton.LeftButton:
                if self.dragging:
                    self._finish_drag()
                    self._move_to_pet(self.pet_x, self.pet_y)
                    self._save_layout()
                elif self.grabbed:
                    self._play_click_interaction(event.position().x(), event.position().y())
            self.drag_origin = None
            self.pet_origin = None
            self.dragging = False
            self.grabbed = False
            # The button state is authoritative: restore the open hand if the
            # pointer is still on the pet, or the default arrow otherwise.
            self.glove.pressed = False
            if self._hit_body(event.position().x(), event.position().y()):
                self._apply_glove(False)
            else:
                reset_native_cursor()

        def _play_click_interaction(self, x: float, y: float) -> None:
            self._wake()
            pet_x, pet_y, pet_width, pet_height = self._pet_rect()
            relative_x = max(0.0, x - pet_x)
            relative_y = max(0.0, y - pet_y)
            if relative_y < pet_height * 0.45:
                self._play_model_overlay("head_pat")
                self._show_overlay("摸摸也不能让我少干活哦~", self.status_detail, self.status_state, 1800)
            elif relative_x > pet_width * 0.72:
                self._play_model_overlay("tail")
                self._show_overlay("尾巴不是进度条啦！", self.status_detail, self.status_state, 1500)
            else:
                self._play_model_overlay("poke")
                self._show_overlay("戳我干嘛，任务还在跑呢", self.status_detail, self.status_state, 1500)

        def mouseDoubleClickEvent(self, event: QMouseEvent) -> None:
            # Qt delivers the second press as this event instead of a press event,
            # so it needs the same body gate as the press and the click reaction.
            if event.button() == Qt.MouseButton.LeftButton and self._hit_body(
                event.position().x(), event.position().y()
            ):
                self._wake()
                self._play_model_overlay("head_pat")
                self._show_overlay("好啦好啦，知道你喜欢我~", self.status_detail, self.status_state, 1800)

        def contextMenuEvent(self, event: Any) -> None:
            menu = QMenu(self)
            size_menu = menu.addMenu("大小")
            size_actions = {}
            for label, scale in (("迷你", 0.6), ("小", 0.8), ("标准", 1.0), ("大", 1.25)):
                action = size_menu.addAction(label)
                action.setCheckable(True)
                action.setChecked(abs(self.scale - scale) < 0.05)
                size_actions[action] = scale
            bubble_size_menu = menu.addMenu("气泡大小")
            bubble_size_actions = {}
            for label, bubble_scale in (("小", 0.8), ("标准", 1.0), ("大", 1.2)):
                action = bubble_size_menu.addAction(label)
                action.setCheckable(True)
                action.setChecked(abs(self.bubble_scale - bubble_scale) < 0.05)
                bubble_size_actions[action] = bubble_scale
            reduced_action = menu.addAction("减少动态")
            reduced_action.setCheckable(True)
            reduced_action.setChecked(self.reduced_motion)
            open_webui_action = menu.addAction("打开 WebUI")
            menu.addSeparator()
            hide_action = menu.addAction("本次隐藏")
            exit_action = menu.addAction("本次关闭")
            selected = menu.exec(event.globalPos())
            if selected in size_actions:
                self.scale = size_actions[selected]
                self._apply_window_size()
                self._move_to_pet(self.pet_x, self.pet_y)
                self._save_layout()
                emit_reply("settings", scale=self.scale)
            elif selected in bubble_size_actions:
                self.bubble_scale = bubble_size_actions[selected]
                self._apply_window_size()
                self._move_to_pet(self.pet_x, self.pet_y)
                self._save_layout()
                emit_reply("settings", bubbleScale=self.bubble_scale)
            elif selected == reduced_action:
                self._set_reduced_motion(reduced_action.isChecked())
                self._save_layout()
                emit_reply("settings", reducedMotion=self.reduced_motion)
                self.update()
            elif selected == open_webui_action:
                QDesktopServices.openUrl(QUrl(self.webui_url))
            elif selected == hide_action:
                self.hide()
            elif selected == exit_action:
                self._save_layout()
                emit_reply("closed", reason="user")
                QApplication.quit()

    application = QApplication(sys.argv[:1])
    application.setQuitOnLastWindowClosed(False)
    inbox = Inbox()
    window = CompanionWindow()
    glove_filter = GloveCursorFilter(window, window.glove_open_h, window.glove_closed_h)
    application.installNativeEventFilter(glove_filter)
    inbox.message.connect(window.apply_message)
    inbox.closed.connect(application.quit)

    def read_stdin() -> None:
        for line in sys.stdin:
            if not line.strip():
                continue
            try:
                message = parse_message(line)
                if message.get("kind") == "ping":
                    emit_reply("pong")
                inbox.message.emit(message)
            except (ValueError, json.JSONDecodeError) as error:
                print(json.dumps({"kind": "error", "message": str(error)}), flush=True)
        inbox.closed.emit()

    reader = threading.Thread(target=read_stdin, name="dsh-bigfish-stdin", daemon=True)
    reader.start()
    window.show()
    emit_reply("ready")
    code = application.exec()
    recorder.close()
    return code


def main() -> int:
    configure_stdio()
    parser = argparse.ArgumentParser(description="DSH BigFish native helper")
    parser.add_argument("--headless", action="store_true", help="validate the protocol without opening a window")
    parser.add_argument("--event-log", type=Path, help="append received protocol messages to a JSONL file")
    parser.add_argument("--snapshot", type=Path, help="save one diagnostic visual frame after the first message")
    args = parser.parse_args()
    recorder = EventRecorder(args.event_log)
    return run_headless(recorder) if args.headless else run_visual(recorder, args.snapshot)


if __name__ == "__main__":
    raise SystemExit(main())
