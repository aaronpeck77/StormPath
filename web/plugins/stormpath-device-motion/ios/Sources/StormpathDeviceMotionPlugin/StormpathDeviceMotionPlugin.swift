import Foundation
import Capacitor
import CoreMotion

/**
 * Thin CMMotionActivity bridge for frequent-route trip learning.
 * StormPath keeps clustering in JS; this only answers "are we driving?".
 */
@objc(StormpathDeviceMotionPlugin)
public class StormpathDeviceMotionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "StormpathDeviceMotionPlugin"
    public let jsName = "StormpathDeviceMotion"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getCurrent", returnType: CAPPluginReturnPromise),
    ]

    private let manager = CMMotionActivityManager()
    private var lastActivity = "unknown"
    private var lastConfidence: NSNumber?
    private var running = false

    @objc func start(_ call: CAPPluginCall) {
        guard CMMotionActivityManager.isActivityAvailable() else {
            call.resolve(["ok": false])
            return
        }
        if running {
            call.resolve(["ok": true])
            return
        }
        running = true
        manager.startActivityUpdates(to: .main) { [weak self] activity in
            guard let self, let activity else { return }
            self.lastActivity = Self.mapActivity(activity)
            self.lastConfidence = NSNumber(value: Self.mapConfidence(activity.confidence))
        }
        call.resolve(["ok": true])
    }

    @objc func stop(_ call: CAPPluginCall) {
        if running {
            manager.stopActivityUpdates()
            running = false
        }
        call.resolve()
    }

    @objc func getCurrent(_ call: CAPPluginCall) {
        var payload: [String: Any] = [
            "activity": lastActivity,
            "confidence": lastConfidence as Any,
        ]
        if lastConfidence == nil {
            payload["confidence"] = NSNull()
        }
        call.resolve(payload)
    }

    private static func mapActivity(_ a: CMMotionActivity) -> String {
        if a.automotive { return "automotive" }
        if a.cycling { return "cycling" }
        if a.walking || a.running { return "on_foot" }
        if a.stationary { return "still" }
        return "unknown"
    }

    private static func mapConfidence(_ c: CMMotionActivityConfidence) -> Double {
        switch c {
        case .low: return 0.33
        case .medium: return 0.66
        case .high: return 1.0
        @unknown default: return 0.5
        }
    }
}
