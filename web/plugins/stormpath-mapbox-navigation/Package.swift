// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "StormpathMapboxNavigation",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "StormpathMapboxNavigation",
            targets: ["StormpathMapboxNavigationPlugin"]
        )
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.3.4"),
        .package(url: "https://github.com/mapbox/mapbox-navigation-ios.git", from: "3.26.0"),
    ],
    targets: [
        .target(
            name: "StormpathMapboxNavigationPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "MapboxNavigationCore", package: "mapbox-navigation-ios"),
                .product(name: "MapboxDirections", package: "mapbox-navigation-ios"),
            ],
            path: "ios/Sources/StormpathMapboxNavigationPlugin"
        )
    ]
)
