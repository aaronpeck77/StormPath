// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "StormpathCarSession",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "StormpathCarSession",
            targets: ["StormpathCarSessionPlugin"]
        )
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.3.4"),
    ],
    targets: [
        .target(
            name: "StormpathCarSessionPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
            ],
            path: "ios/Sources/StormpathCarSessionPlugin"
        )
    ]
)
