import XCTest

@testable import BigFishCore

/// Mirrors the Qt helper's `parse_hotkey_shortcut` expectations so a shortcut
/// recorded in the settings page reads identically on both platforms.
final class HotkeyParserTests: XCTestCase {
    func testParsesCanonicalCombos() {
        XCTAssertEqual(HotkeyParser.parse("Ctrl+Alt+D"), HotkeyCombo(modifiers: ["ctrl", "alt"], key: "D"))
        XCTAssertEqual(HotkeyParser.parse("cmd+shift+3"), HotkeyCombo(modifiers: ["super", "shift"], key: "3"))
        XCTAssertEqual(HotkeyParser.parse("Alt+F4"), HotkeyCombo(modifiers: ["alt"], key: "F4"))
        XCTAssertEqual(HotkeyParser.parse("option+5"), HotkeyCombo(modifiers: ["alt"], key: "5"))
        XCTAssertEqual(HotkeyParser.parse("Ctrl+Ctrl+D"), HotkeyCombo(modifiers: ["ctrl"], key: "D"))
    }

    func testRejectsUnusableShortcuts() {
        XCTAssertNil(HotkeyParser.parse(nil))
        XCTAssertNil(HotkeyParser.parse(""))
        XCTAssertNil(HotkeyParser.parse("D")) // bare key: would fire while typing
        XCTAssertNil(HotkeyParser.parse("Shift+D")) // shift alone is not enough
        XCTAssertNil(HotkeyParser.parse("Ctrl+A+B")) // two keys
        XCTAssertNil(HotkeyParser.parse("Ctrl+@")) // not a letter or digit
        XCTAssertNil(HotkeyParser.parse("Ctrl+F25")) // beyond F24
    }

    func testDisplayTextUsesCmdForSuper() {
        XCTAssertEqual(HotkeyParser.parse("super+alt+d")?.displayText, "Alt+Cmd+D")
        XCTAssertEqual(HotkeyParser.parse("Ctrl+Alt+D")?.displayText, "Ctrl+Alt+D")
    }

    func testVirtualKeyCodes() {
        XCTAssertEqual(HotkeyParser.virtualKeyCode("D"), UInt32(kVK_ANSI_D))
        XCTAssertEqual(HotkeyParser.virtualKeyCode("5"), UInt32(kVK_ANSI_5))
        XCTAssertEqual(HotkeyParser.virtualKeyCode("F1"), UInt32(kVK_F1))
        XCTAssertEqual(HotkeyParser.virtualKeyCode("Z"), UInt32(kVK_ANSI_Z))
        XCTAssertNil(HotkeyParser.virtualKeyCode("@"))
        XCTAssertNil(HotkeyParser.virtualKeyCode("F25"))
    }
}
