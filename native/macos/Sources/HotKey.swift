import Carbon.HIToolbox
import Foundation

/// One parsed global-hotkey definition, shared by the parser and the Carbon
/// registration. Modifiers are canonical: ctrl / alt / shift / super, where
/// `super` renders as Cmd in menu hints. The key is one ASCII letter or digit,
/// or F1..F24. A non-Shift modifier is required: a bare-letter hotkey would
/// fire while the user types into any application.
struct HotkeyCombo: Equatable {
    var modifiers: [String]
    var key: String

    /// Rendered in the platform's vocabulary, matching the Windows side
    /// (`Ctrl+Alt+D`), with `super` shown as Cmd.
    var displayText: String {
        let labels = ["ctrl": "Ctrl", "alt": "Alt", "shift": "Shift", "super": "Cmd"]
        let names = ["ctrl", "alt", "shift", "super"].compactMap { modifiers.contains($0) ? labels[$0] : nil }
        return (names + [key]).joined(separator: "+")
    }
}

enum HotkeyParser {
    /// Mirrors `parse_hotkey_shortcut` in runtime/helper.py so a shortcut the
    /// settings page records reads the same on both helpers. Returns nil for
    /// empty, unknown, or ambiguous text; callers treat nil as "unconfigured".
    static func parse(_ text: String?) -> HotkeyCombo? {
        let parts = (text ?? "")
            .split(separator: "+")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
        guard !parts.isEmpty else { return nil }
        var mods: [String] = []
        var key: String?
        for part in parts {
            let mod: String
            switch part.lowercased() {
            case "ctrl", "control": mod = "ctrl"
            case "alt", "option": mod = "alt"
            case "shift": mod = "shift"
            case "super", "cmd", "command", "win", "meta": mod = "super"
            default:
                guard key == nil, let parsed = parseKey(part) else { return nil }
                key = parsed
                continue
            }
            if !mods.contains(mod) { mods.append(mod) }
        }
        guard let key, mods.contains(where: { $0 != "shift" }) else { return nil }
        return HotkeyCombo(modifiers: mods, key: key)
    }

    /// One ASCII letter or digit, or F1..F24, uppercased.
    private static func parseKey(_ part: String) -> String? {
        let upper = part.uppercased()
        guard upper.count == 1, let scalar = upper.unicodeScalars.first, scalar.isASCII else {
            if upper.count >= 2, upper.first == "F",
               let number = Int(upper.dropFirst()), (1...24).contains(number) {
                return "F\(number)"
            }
            return nil
        }
        let isDigit = (0x30...0x39).contains(scalar.value)
        let isLetter = (0x41...0x5A).contains(scalar.value)
        guard isDigit || isLetter else { return nil }
        return upper
    }

    /// The Carbon virtual keycode for a parsed key, or nil for unsupported keys.
    static func virtualKeyCode(_ key: String) -> UInt32? {
        if key.count == 1, let scalar = key.unicodeScalars.first {
            if (0x30...0x39).contains(scalar.value) {
                let digitKeys: [UInt32] = [UInt32(kVK_ANSI_0), UInt32(kVK_ANSI_1), UInt32(kVK_ANSI_2), UInt32(kVK_ANSI_3),
                                           UInt32(kVK_ANSI_4), UInt32(kVK_ANSI_5), UInt32(kVK_ANSI_6), UInt32(kVK_ANSI_7),
                                           UInt32(kVK_ANSI_8), UInt32(kVK_ANSI_9)]
                return digitKeys[Int(scalar.value - 0x30)]
            }
            if let index = letters.firstIndex(of: Character(scalar)) {
                return letterKeyCodes[index]
            }
            return nil
        }
        let functionKeys: [String: UInt32] = [
            "F1": UInt32(kVK_F1), "F2": UInt32(kVK_F2), "F3": UInt32(kVK_F3), "F4": UInt32(kVK_F4),
            "F5": UInt32(kVK_F5), "F6": UInt32(kVK_F6), "F7": UInt32(kVK_F7), "F8": UInt32(kVK_F8),
            "F9": UInt32(kVK_F9), "F10": UInt32(kVK_F10), "F11": UInt32(kVK_F11),
            "F12": UInt32(kVK_F12), "F13": UInt32(kVK_F13), "F14": UInt32(kVK_F14),
            "F15": UInt32(kVK_F15), "F16": UInt32(kVK_F16), "F17": UInt32(kVK_F17),
            "F18": UInt32(kVK_F18), "F19": UInt32(kVK_F19), "F20": UInt32(kVK_F20),
        ]
        return functionKeys[key]
    }

    private static let letters = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
    /// kVK_ANSI_* values in `letters` (alphabetical) order.
    private static let letterKeyCodes: [UInt32] = [
        UInt32(kVK_ANSI_A), UInt32(kVK_ANSI_B), UInt32(kVK_ANSI_C), UInt32(kVK_ANSI_D),
        UInt32(kVK_ANSI_E), UInt32(kVK_ANSI_F), UInt32(kVK_ANSI_G), UInt32(kVK_ANSI_H),
        UInt32(kVK_ANSI_I), UInt32(kVK_ANSI_J), UInt32(kVK_ANSI_K), UInt32(kVK_ANSI_L),
        UInt32(kVK_ANSI_M), UInt32(kVK_ANSI_N), UInt32(kVK_ANSI_O), UInt32(kVK_ANSI_P),
        UInt32(kVK_ANSI_Q), UInt32(kVK_ANSI_R), UInt32(kVK_ANSI_S), UInt32(kVK_ANSI_T),
        UInt32(kVK_ANSI_U), UInt32(kVK_ANSI_V), UInt32(kVK_ANSI_W), UInt32(kVK_ANSI_X),
        UInt32(kVK_ANSI_Y), UInt32(kVK_ANSI_Z),
    ]
}

/// One registered system-wide hotkey that toggles the pet's visibility.
///
/// Uses Carbon `RegisterEventHotKey`, which needs no Accessibility permission
/// and survives focus changes and a hidden (ordered-out) window — unlike a
/// local key-equivalent, which stops working the moment the panel is hidden.
/// A failed registration (the combination is taken, or the string is
/// unparseable) leaves the pet running without the hotkey and says so on
/// stderr; it must never disable the whole companion.
final class HotKeyController {
    var onToggle: (() -> Void)?

    private(set) var enabled = false
    private(set) var shortcutText = ""
    private(set) var registered = false

    private var hotKeyRef: EventHotKeyRef?
    private var handlerRef: EventHandlerRef?

    func configure(enabled: Bool, shortcutText: String) {
        unregister()
        self.enabled = enabled
        self.shortcutText = shortcutText
        if enabled { register() }
    }

    private func register() {
        guard let combo = HotkeyParser.parse(shortcutText),
              let keyCode = HotkeyParser.virtualKeyCode(combo.key) else { return }
        var flags: UInt32 = 0
        if combo.modifiers.contains("ctrl") { flags |= UInt32(controlKey) }
        if combo.modifiers.contains("alt") { flags |= UInt32(optionKey) }
        if combo.modifiers.contains("shift") { flags |= UInt32(shiftKey) }
        if combo.modifiers.contains("super") { flags |= UInt32(cmdKey) }

        var eventType = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        let callback: EventHandlerUPP = { _, _, userData in
            guard let userData else { return noErr }
            Unmanaged<HotKeyController>.fromOpaque(userData).takeUnretainedValue().fire()
            return noErr
        }
        let selfRef = Unmanaged.passUnretained(self).toOpaque()
        guard InstallEventHandler(GetApplicationEventTarget(), callback, 1, &eventType, selfRef, &handlerRef) == noErr else {
            FileHandle.standardError.write(Data("dsh-frenchie: global hotkey handler installation failed\n".utf8))
            return
        }
        let hotKeyID = EventHotKeyID(signature: OSType(0x46524E43) /* 'FRNC' */, id: 1)
        guard RegisterEventHotKey(keyCode, flags, hotKeyID, GetApplicationEventTarget(), 0, &hotKeyRef) == noErr else {
            FileHandle.standardError.write(Data(
                "dsh-frenchie: global hotkey \(combo.displayText) could not be registered (in use by another application?)\n".utf8
            ))
            RemoveEventHandler(handlerRef)
            handlerRef = nil
            return
        }
        registered = true
    }

    private func unregister() {
        if let hotKeyRef {
            UnregisterEventHotKey(hotKeyRef)
            self.hotKeyRef = nil
        }
        if let handlerRef {
            RemoveEventHandler(handlerRef)
            self.handlerRef = nil
        }
        registered = false
    }

    private func fire() {
        guard registered else { return }
        DispatchQueue.main.async { [weak self] in
            guard let self, self.registered else { return }
            self.onToggle?()
        }
    }

    /// The context-menu hint, or "" while no hotkey is live.
    var menuHint: String {
        guard registered, let combo = HotkeyParser.parse(shortcutText) else { return "" }
        return "（\(combo.displayText) 唤回）"
    }
}
