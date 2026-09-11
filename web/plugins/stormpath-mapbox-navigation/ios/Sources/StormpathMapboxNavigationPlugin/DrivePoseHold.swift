import CoreLocation
import Foundation

/// Last-good Drive pose — keep rules in sync with `web/src/nav/nativeDrivePoseHold.ts`.
/// Rejects puck leaps when Core jumps a long way in a short time (tile flap, radio blip).
struct DrivePoseSample {
    var coordinate: CLLocationCoordinate2D
    var alongM: Double
    var headingDeg: Double?
    var speedMps: Double?
}

struct DrivePoseHold {
    private var last: DrivePoseSample?
    private var lastAt: Date?

    private let maxLeapMeters: CLLocationDistance = 85
    private let maxLeapWindow: TimeInterval = 0.8

    mutating func reset() {
        last = nil
        lastAt = nil
    }

    mutating func accept(_ next: DrivePoseSample, now: Date = Date()) -> (sample: DrivePoseSample, held: Bool) {
        guard CLLocationCoordinate2DIsValid(next.coordinate) else {
            if let last { return (last, true) }
            return (next, false)
        }
        guard let last, let lastAt else {
            self.last = next
            self.lastAt = now
            return (next, false)
        }
        let dt = now.timeIntervalSince(lastAt)
        let from = CLLocation(latitude: last.coordinate.latitude, longitude: last.coordinate.longitude)
        let to = CLLocation(latitude: next.coordinate.latitude, longitude: next.coordinate.longitude)
        let jump = from.distance(from: to)
        if dt >= 0, dt < maxLeapWindow, jump > maxLeapMeters {
            return (last, true)
        }
        self.last = next
        self.lastAt = now
        return (next, false)
    }
}
