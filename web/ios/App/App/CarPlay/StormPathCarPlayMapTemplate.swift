import CarPlay

/**
 * Minimal CarPlay map template — destination + advisory from UserDefaults.
 * Requires `com.apple.developer.carplay-maps` (see docs/CARPLAY.md).
 * Add this file to the App target after entitlement approval; it is not wired into
 * Info.plist scenes until then so day-to-day phone builds keep signing clean.
 */
final class StormPathCarPlayMapTemplate {
    func makeTemplate() -> CPMapTemplate {
        let map = CPMapTemplate()
        let ok = CPAlertAction(title: "OK", style: .default) { _ in }
        let alert = CPNavigationAlert(
            titleVariants: [CarPlayTripSnapshot.destinationLabel],
            subtitleVariants: [
                CarPlayTripSnapshot.maneuverLine,
                CarPlayTripSnapshot.advisoryLine,
            ],
            image: nil,
            primaryAction: ok,
            secondaryAction: nil,
            duration: 10
        )
        map.present(navigationAlert: alert, animated: false)
        return map
    }
}
