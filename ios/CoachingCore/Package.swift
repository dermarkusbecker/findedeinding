// swift-tools-version: 5.8
import PackageDescription
let package = Package(name: "CoachingCore", platforms: [.iOS(.v16), .macOS(.v12)], products: [.library(name: "CoachingCore", targets: ["CoachingCore"])], targets: [.target(name: "CoachingCore"), .testTarget(name: "CoachingCoreTests", dependencies: ["CoachingCore"])])
