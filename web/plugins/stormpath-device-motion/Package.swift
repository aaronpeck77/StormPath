// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "StormpathDeviceMotion",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "StormpathDeviceMotion",
            targets: ["StormpathDeviceMotionPlugin"]
        )
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.3.4"),
    ],
    targets: [
        .target(
            name: "StormpathDeviceMotionPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
            ],
            path: "ios/Sources/StormpathDeviceMotionPlugin"
        )
    ]
)
