import Foundation

/// Native Drive follow-cam — keep rules in sync with `web/src/nav/nativeDriveFollowCam.ts`.
struct DriveFollowCameraSample {
    var lng: Double
    var lat: Double
    var bearing: Double
    var pitch: Double
    var zoom: Double
}

struct DriveFollowCam {
    private var lastBearing: Double?

    /**
     * Framing Bill drives with. These win over the web constants because the web
     * camera applies this sample — change both or nothing changes on the phone.
     * ROLLBACK (Sep 15): pitch 64, defaultZoom 16.35, highwayZoom 15.1.
     */
    private let pitch = 68.0
    private let defaultZoom = 16.6
    private let minZoom = 12.5
    private let maxZoom = 18.5
    private let highwayZoom = 15.35
    private let speedZoomStart = 11.0
    private let speedZoomEnd = 28.0
    private let travelMinSpeed = 1.8
    private let bearingAlpha = 0.35
    private let maxBearingStep = 9.0
    /** Near a maneuver, track heading changes a little faster so the cam swings early. */
    private let nearTurnBearingAlpha = 0.48
    private let nearTurnMaxBearingStep = 12.0

    mutating func reset() {
        lastBearing = nil
    }

    mutating func next(
        lng: Double,
        lat: Double,
        headingDeg: Double?,
        speedMps: Double?,
        stepRemainingM: Double? = nil
    ) -> DriveFollowCameraSample {
        let heading: Double? = {
            guard let h = headingDeg, h >= 0 else { return nil }
            return h
        }()
        let speed = speedMps ?? 0
        let moving = speedMps == nil || speedMps! >= travelMinSpeed
        let raw: Double
        if let heading, moving || lastBearing == nil {
            raw = heading
        } else if let lastBearing {
            raw = lastBearing
        } else {
            raw = heading ?? 0
        }
        let nearTurn =
            stepRemainingM != nil
            && stepRemainingM! >= 0
            && stepRemainingM! <= max(60.0, max(0, speed) * 3.0)
        let alpha = nearTurn ? nearTurnBearingAlpha : bearingAlpha
        let maxStep = nearTurn ? nearTurnMaxBearingStep : maxBearingStep
        let bearing = smoothBearing(from: lastBearing, to: raw, alpha: alpha, maxStep: maxStep)
        lastBearing = bearing
        return DriveFollowCameraSample(
            lng: lng,
            lat: lat,
            bearing: bearing,
            pitch: pitch,
            zoom: zoomForSpeed(speedMps)
        )
    }

    private func zoomForSpeed(_ speedMps: Double?) -> Double {
        let s = max(0, speedMps ?? 0)
        let raw: Double
        if s <= speedZoomStart {
            raw = defaultZoom
        } else if s >= speedZoomEnd {
            raw = highwayZoom
        } else {
            let t = (s - speedZoomStart) / (speedZoomEnd - speedZoomStart)
            raw = defaultZoom + (highwayZoom - defaultZoom) * t
        }
        return clampZoom(raw)
    }

    private func clampZoom(_ zoom: Double) -> Double {
        if !zoom.isFinite || zoom < minZoom { return defaultZoom }
        return min(maxZoom, zoom)
    }

    private func smoothBearing(from prev: Double?, to raw: Double, alpha: Double, maxStep: Double) -> Double {
        guard let prev else { return normalize(raw) }
        var d = raw - prev
        while d > 180 { d -= 360 }
        while d < -180 { d += 360 }
        d = min(179, max(-179, d))
        var step = d * alpha
        step = min(maxStep, max(-maxStep, step))
        return normalize(prev + step)
    }

    private func normalize(_ deg: Double) -> Double {
        var x = deg.truncatingRemainder(dividingBy: 360)
        if x < 0 { x += 360 }
        return x
    }
}
