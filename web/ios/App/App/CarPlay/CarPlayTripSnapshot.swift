import Foundation

/// Keys written by `@stormpath/car-session` for the CarPlay stub UI.
enum CarPlayTripSnapshot {
    private static let prefix = "stormpath.car."
    private static var defaults: UserDefaults { .standard }

    static var isNavigating: Bool {
        defaults.bool(forKey: prefix + "navigating")
    }

    static var destinationLabel: String {
        let s = defaults.string(forKey: prefix + "destination") ?? ""
        return s.isEmpty ? "StormPath" : s
    }

    static var advisoryLine: String {
        let s = defaults.string(forKey: prefix + "advisory") ?? ""
        return s.isEmpty ? "No advisory" : s
    }

    static var maneuverLine: String {
        let s = defaults.string(forKey: prefix + "maneuver") ?? ""
        return s.isEmpty ? "Open StormPath on iPhone for turns" : s
    }
}
