import Foundation

/// Serialized stdout writer for the newline-delimited JSON protocol.
final class ProtocolIO {
    static let shared = ProtocolIO()
    private let lock = NSLock()

    func write(_ object: [String: Any]) {
        lock.lock()
        defer { lock.unlock() }
        guard let data = try? JSONSerialization.data(withJSONObject: object) else { return }
        try? FileHandle.standardOutput.write(contentsOf: data)
        try? FileHandle.standardOutput.write(contentsOf: Data("\n".utf8))
        try? FileHandle.standardOutput.synchronize()
    }
}
