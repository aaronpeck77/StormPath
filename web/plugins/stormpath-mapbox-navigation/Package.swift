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
        // Pin. `from: 3.26.0` floated CI to 3.30.x and the archive died.
        .package(url: "https://github.com/mapbox/mapbox-navigation-ios.git", exact: "3.26.0"),
        .package(url: "https://github.com/mapbox/mapbox-maps-ios.git", exact: "11.26.0"),
    ],
    targets: [
        .target(
            name: "StormpathMapboxNavigationPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "MapboxNavigationCore", package: "mapbox-navigation-ios"),
                .product(name: "MapboxNavigationUIKit", package: "mapbox-navigation-ios"),
                .product(name: "MapboxDirections", package: "mapbox-navigation-ios"),
                .product(name: "MapboxMaps", package: "mapbox-maps-ios"),
            ],
            path: "ios/Sources/StormpathMapboxNavigationPlugin"
        )
    ]
)
