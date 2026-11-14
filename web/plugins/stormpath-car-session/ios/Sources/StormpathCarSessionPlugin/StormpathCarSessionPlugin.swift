import Foundation
import Capacitor
import UIKit
import CarPlay

/**
 * Mirrors the active trip into UserDefaults.
 * CarPlay (`StormPathCarPlay.swift` in the nav plugin) reads `stormpath.car.destination` for the trip name.
 */
@objc(StormpathCarSessionPlugin)
public class StormpathCarSessionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "StormpathCarSessionPlugin"
    public let jsName = "StormpathCarSession"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "publish", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "carPlayConnected", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "carPlayHazardAlert", returnType: CAPPluginReturnPromise),
    ]

    private static let defaults = UserDefaults.standard
    private static let prefix = "stormpath.car."

    @objc func publish(_ call: CAPPluginCall) {
        let navigating = call.getBool("navigating") ?? false
        let destination = call.getString("destinationLabel") ?? ""
        let destinationAddress = call.getString("destinationAddress") ?? ""
        let advisory = call.getString("advisoryLine") ?? ""
        let maneuver = call.getString("maneuverLine") ?? ""
        Self.defaults.set(navigating, forKey: Self.prefix + "navigating")
        Self.defaults.set(destination, forKey: Self.prefix + "destination")
        Self.defaults.set(destinationAddress, forKey: Self.prefix + "destinationAddress")
        Self.defaults.set(advisory, forKey: Self.prefix + "advisory")
        Self.defaults.set(maneuver, forKey: Self.prefix + "maneuver")
        for key in ["conditionsJson", "hazardSpansJson", "radarTileBase", "puckColor"] {
            Self.defaults.set(call.getString(key) ?? "", forKey: Self.prefix + key)
        }
        Self.defaults.set(call.getInt("speedLimitMph") ?? 0, forKey: Self.prefix + "speedLimitMph")
        Self.defaults.set(Date().timeIntervalSince1970, forKey: Self.prefix + "updatedAt")
        NotificationCenter.default.post(name: Notification.Name("stormpath.car.updated"), object: nil)
        call.resolve(["ok": true])
    }

    @objc func carPlayConnected(_ call: CAPPluginCall) {
        /* A live CPTemplateApplicationScene means the car screen is attached —
         * the phone can then offer the companion view instead of a second map. */
        let connected = UIApplication.shared.connectedScenes.contains { $0 is CPTemplateApplicationScene }
        call.resolve(["connected": connected])
    }

    /* The CarPlay scene drops the hazard titles it just announced into
     * UserDefaults so the phone companion can highlight the same hazards.
     * Read-and-clear: each alert is delivered to the phone exactly once. */
    @objc func carPlayHazardAlert(_ call: CAPPluginCall) {
        guard let data = Self.defaults.data(forKey: Self.prefix + "pendingHazardAlert"),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let titles = obj["titles"] as? [String] else {
            call.resolve(["titles": [String](), "at": 0])
            return
        }
        Self.defaults.removeObject(forKey: Self.prefix + "pendingHazardAlert")
        /* A pending alert that survived an app kill is stale — hazards move. */
        let at = (obj["at"] as? Double) ?? 0
        let fresh = at > 0 && Date().timeIntervalSince1970 - at < 30 * 60
        call.resolve(["titles": fresh ? titles : [String](), "at": at])
    }

    @objc func clear(_ call: CAPPluginCall) {
        for key in ["navigating", "destination", "destinationAddress", "advisory", "maneuver", "updatedAt", "conditionsJson", "hazardSpansJson", "radarTileBase", "puckColor", "speedLimitMph", "pendingHazardAlert"] {
            Self.defaults.removeObject(forKey: Self.prefix + key)
        }
        call.resolve()
    }
}
