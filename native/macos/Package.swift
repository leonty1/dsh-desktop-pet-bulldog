// swift-tools-version: 5.9
// The helper's test manifest. `swift test` runs the two suites against the real
// `assets/pet-manifest.json`; the app itself is built by `build.sh`, which compiles every
// file in `Sources/` into one universal binary and so needs no package here. `main.swift` is
// excluded because a package target cannot hold top-level executable code alongside a
// library, and because the tests cover the model and the layout store rather than the window.
import PackageDescription

let package = Package(
    name: "BigFishCore",
    platforms: [.macOS(.v12)],
    products: [.library(name: "BigFishCore", targets: ["BigFishCore"])],
    targets: [
        .target(name: "BigFishCore", path: "Sources", exclude: ["main.swift"]),
        .testTarget(name: "BigFishCoreTests", dependencies: ["BigFishCore"], path: "Tests"),
    ]
)
