import Foundation
import Capacitor

/**
 * Mirrors the active trip into UserDefaults for a future CarPlay map template.
 * Keys are shared with `web/ios/App/App/CarPlay/CarPlayTripSnapshot.swift`.
 */
@objc(StormpathCarSessionPlugin)
public class StormpathCarSessionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "StormpathCarSessionPlugin"
    public let jsName = "StormpathCarSession"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "publish", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise),
    ]

    private static let defaults = UserDefaults.standard
    private static let prefix = "stormpath.car."

    @objc func publish(_ call: CAPPluginCall) {
        let navigating = call.getBool("navigating") ?? false
        let destination = call.getString("destinationLabel") ?? ""
        let advisory = call.getString("advisoryLine") ?? ""
        let maneuver = call.getString("maneuverLine") ?? ""
        Self.defaults.set(navigating, forKey: Self.prefix + "navigating")
        Self.defaults.set(destination, forKey: Self.prefix + "destination")
        Self.defaults.set(advisory, forKey: Self.prefix + "advisory")
        Self.defaults.set(maneuver, forKey: Self.prefix + "maneuver")
        Self.defaults.set(Date().timeIntervalSince1970, forKey: Self.prefix + "updatedAt")
        call.resolve(["ok": true])
    }

    @objc func clear(_ call: CAPPluginCall) {
        for key in ["navigating", "destination", "advisory", "maneuver", "updatedAt"] {
            Self.defaults.removeObject(forKey: Self.prefix + key)
        }
        call.resolve()
    }
}
