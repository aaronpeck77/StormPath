import Foundation
import UIKit
import Capacitor
import Combine
import CoreLocation
import AVFoundation
import MapboxDirections
import MapboxNavigationCore

/**
 * Mapbox Navigation Core bridge — no NavigationViewController.
 * Progress / route geometry stream to JS so StormPath Dr/Mp/Rt stay on one map.
 *
 * MapboxNavigation APIs are @MainActor (SDK 3.x); all session work hops there.
 */
@objc(StormpathMapboxNavigationPlugin)
public class StormpathMapboxNavigationPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "StormpathMapboxNavigationPlugin"
    public let jsName = "StormpathMapboxNavigation"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startActiveGuidance", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setVoiceGuidance", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setDrivePuckVisible", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setNativeMapVisible", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
    ]

    private var navigationProvider: MapboxNavigationProvider?
    private var cancellables = Set<AnyCancellable>()
    private var sessionActive = false
    private var didEmitArrival = false
    /// Retain voice controller so spoken instructions keep working without UIKit nav UI.
    private var voiceController: RouteVoiceController?
    private var voiceEnabled = false
    /// Last-good puck — reject Core leaps before JS / DriveMap see them.
    private var poseHold = DrivePoseHold()
    private var followCam = DriveFollowCam()
    private var puckOverlay: DrivePuckOverlay?
    private var nativeMap = DriveNativeMap()
    private var lastNavRoutes: NavigationRoutes?

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": true])
    }

    @objc func startActiveGuidance(_ call: CAPPluginCall) {
        guard let accessToken = call.getString("accessToken"), !accessToken.isEmpty else {
            call.reject("accessToken required")
            return
        }
        guard let rawCoords = call.getArray("coordinates", JSObject.self), rawCoords.count >= 2 else {
            call.reject("coordinates must include at least origin and destination")
            return
        }

        var coordinates: [CLLocationCoordinate2D] = []
        coordinates.reserveCapacity(rawCoords.count)
        for obj in rawCoords {
            let lngNum = obj["lng"] as? Double ?? (obj["lng"] as? NSNumber)?.doubleValue
            let latNum = obj["lat"] as? Double ?? (obj["lat"] as? NSNumber)?.doubleValue
            guard let lng = lngNum, let lat = latNum else {
                call.reject("coordinates entries need numeric lng/lat")
                return
            }
            coordinates.append(CLLocationCoordinate2D(latitude: lat, longitude: lng))
        }

        let simulate = call.getBool("simulate") ?? false
        let voice = call.getBool("voiceEnabled") ?? false
        let preferBackroads = call.getBool("preferBackroads") ?? false

        Task { @MainActor [weak self] in
            guard let self else { return }
            await self.startGuidanceOnMainActor(
                accessToken: accessToken,
                coordinates: coordinates,
                simulate: simulate,
                voiceEnabled: voice,
                preferBackroads: preferBackroads,
                call: call
            )
        }
    }

    @objc func setVoiceGuidance(_ call: CAPPluginCall) {
        let enabled = call.getBool("enabled") ?? false
        Task { @MainActor [weak self] in
            self?.applyVoiceEnabled(enabled)
            call.resolve(["ok": true, "enabled": enabled])
        }
    }

    @objc func setNativeMapVisible(_ call: CAPPluginCall) {
        let visible = call.getBool("visible") ?? false
        Task { @MainActor [weak self] in
            guard let self else { return }
            if visible, let provider = self.navigationProvider, let host = self.webView?.superview, let wv = self.webView {
                self.nativeMap.attach(
                    host: host,
                    webView: wv,
                    navigation: provider.mapboxNavigation,
                    predictiveCacheManager: provider.predictiveCacheManager,
                    routes: self.lastNavRoutes
                )
                self.applyDrivePuckVisible(false)
            } else if let wv = self.webView {
                self.nativeMap.setVisible(false, webView: wv)
            }
            call.resolve(["ok": true, "visible": visible])
        }
    }

    @objc func setDrivePuckVisible(_ call: CAPPluginCall) {
        let visible = call.getBool("visible") ?? false
        Task { @MainActor [weak self] in
            self?.applyDrivePuckVisible(visible)
            call.resolve(["ok": true, "visible": visible])
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        Task { @MainActor [weak self] in
            self?.tearDownSession(emitCancelled: true)
            call.resolve()
        }
    }

    @MainActor
    private func startGuidanceOnMainActor(
        accessToken: String,
        coordinates: [CLLocationCoordinate2D],
        simulate: Bool,
        voiceEnabled: Bool,
        preferBackroads: Bool,
        call: CAPPluginCall
    ) async {
        tearDownSession(emitCancelled: false)

        var coreConfig = CoreConfig(
            credentials: .init(accessToken: accessToken),
            locationSource: simulate ? .simulation(initialLocation: nil) : .live
        )
        // StormPath owns off-route recovery. Core "faster route" / auto-reroute
        // silently swapped a Go-locked B onto highway A and thrashed the puck.
        coreConfig.routingConfig.rerouteConfig.detectsReroute = false
        coreConfig.routingConfig.fasterRouteDetectionConfig = nil
        let provider = MapboxNavigationProvider(coreConfig: coreConfig)
        navigationProvider = provider
        didEmitArrival = false
        applyVoiceEnabled(voiceEnabled)

        let mapboxNavigation = provider.mapboxNavigation
        // Intermediate points shape the corridor without becoming stop legs — otherwise
        // Core only gets origin→dest and recalculates highway-fastest over a Go alternate.
        let waypoints: [Waypoint] = coordinates.enumerated().map { index, coordinate in
            var waypoint = Waypoint(coordinate: coordinate)
            if index > 0 && index < coordinates.count - 1 {
                waypoint.separatesLegs = false
                // Keep Core on the sampled B corridor instead of cutting to the highway.
                waypoint.coordinateAccuracy = 40
            }
            return waypoint
        }
        let options = NavigationRouteOptions(waypoints: waypoints)
        // Honor StormPath preferred / no-interstate Go locks — otherwise Core
        // recalculates bare origin→dest as highway-fastest and yanks the blue line.
        if preferBackroads {
            options.roadClassesToAvoid = .motorway
        }

        do {
            let navigationRoutes = try await mapboxNavigation
                .routingProvider()
                .calculateRoutes(options: options)
                .value

            bindObservers(mapboxNavigation: mapboxNavigation)
            mapboxNavigation.tripSession().startActiveGuidance(
                with: navigationRoutes,
                startLegIndex: 0
            )
            sessionActive = true
            lastNavRoutes = navigationRoutes
            emitRouteGeometry(from: navigationRoutes)
            call.resolve(["ok": true])
        } catch {
            tearDownSession(emitCancelled: false)
            call.reject("Route request failed: \(error.localizedDescription)")
        }
    }

    @MainActor
    private func applyVoiceEnabled(_ enabled: Bool) {
        voiceEnabled = enabled
        guard let provider = navigationProvider else {
            voiceController = nil
            return
        }
        if enabled {
            activateSpeechAudioSession()
            // Accessing routeVoiceController starts Mapbox spoken instructions.
            let vc = provider.routeVoiceController
            vc.speechSynthesizer.muted = false
            voiceController = vc
        } else {
            if let synth = voiceController?.speechSynthesizer {
                synth.muted = true
                synth.stopSpeaking()
            }
            voiceController = nil
        }
    }

    private func activateSpeechAudioSession() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(
                .playback,
                mode: .voicePrompt,
                options: [.duckOthers]
            )
            try session.setActive(true, options: [])
        } catch {
            // Fall back — prompts may still play at system volume.
            try? session.setCategory(.playback, options: [.duckOthers])
            try? session.setActive(true)
        }
    }

    @MainActor
    private func bindObservers(mapboxNavigation: MapboxNavigation) {
        cancellables.removeAll()

        mapboxNavigation.navigation().routeProgress
            .receive(on: DispatchQueue.main)
            .sink { [weak self] state in
                Task { @MainActor in
                    self?.emitProgress(state: state)
                }
            }
            .store(in: &cancellables)

        mapboxNavigation.tripSession().navigationRoutes
            .receive(on: DispatchQueue.main)
            .compactMap { $0 }
            .sink { [weak self] routes in
                Task { @MainActor in
                    self?.emitRouteGeometry(from: routes)
                }
            }
            .store(in: &cancellables)

        mapboxNavigation.navigation().rerouting
            .receive(on: DispatchQueue.main)
            .sink { [weak self] status in
                // When reroute finishes, geometry also arrives via navigationRoutes publisher.
                let desc = String(describing: status).lowercased()
                if desc.contains("fail") || desc.contains("error") {
                    self?.notifyListeners("error", data: [
                        "reason": "error",
                        "message": "Reroute failed",
                    ])
                }
            }
            .store(in: &cancellables)

        mapboxNavigation.navigation().errors
            .receive(on: DispatchQueue.main)
            .sink { [weak self] error in
                self?.notifyListeners("error", data: [
                    "reason": "error",
                    "message": String(describing: error),
                ])
            }
            .store(in: &cancellables)
    }

    @MainActor
    private func emitProgress(state: RouteProgressState?) {
        guard sessionActive, let state else { return }
        let progress = state.routeProgress
        guard let matching = navigationProvider?.mapboxNavigation.navigation().currentLocationMatching else {
            // No matched fix yet — skip puck update but keep session alive.
            return
        }
        let loc = matching.enhancedLocation
        let coord = loc.coordinate
        let headingDeg: Double? = loc.course >= 0 ? loc.course : nil
        let speedMps: Double? = loc.speed >= 0 ? loc.speed : nil
        let accepted = poseHold.accept(DrivePoseSample(
            coordinate: coord,
            alongM: progress.distanceTraveled,
            headingDeg: headingDeg,
            speedMps: speedMps
        ))
        let pose = accepted.sample
        let alongM = pose.alongM
        let remainingM = progress.distanceRemaining
        let legProgress = progress.currentLegProgress
        let stepIndex = globalStepIndex(progress: progress)
        let stepRemainingM = legProgress.currentStepProgress.distanceRemaining
        // Prefer visual primary text when present — matches the upcoming maneuver banner.
        var instruction = legProgress.currentStep.instructions
        if let primary = legProgress.currentStepProgress.currentVisualInstruction?.primaryInstruction.text,
           !primary.isEmpty {
            instruction = primary
        }

        let currentStep = legProgress.currentStep
        let roadName = currentStep.names?.joined(separator: " / ") ?? ""
        let roadRef = currentStep.codes?.joined(separator: " / ") ?? ""

        var payload: [String: Any] = [
            "alongM": alongM,
            "remainingM": remainingM,
            "onRoute": true,
            "stepIndex": stepIndex,
            "stepRemainingM": stepRemainingM,
            "instruction": instruction,
            "currentRoadName": roadName,
            "currentRoadRef": roadRef,
            "lng": pose.coordinate.longitude,
            "lat": pose.coordinate.latitude,
            "poseHeld": accepted.held,
        ]
        if let heading = pose.headingDeg {
            payload["headingDeg"] = heading
        }
        if let speed = pose.speedMps {
            payload["speedMps"] = speed
        }
        let cam = followCam.next(
            lng: pose.coordinate.longitude,
            lat: pose.coordinate.latitude,
            headingDeg: pose.headingDeg,
            speedMps: pose.speedMps
        )
        payload["camLng"] = cam.lng
        payload["camLat"] = cam.lat
        payload["camBearing"] = cam.bearing
        payload["camPitch"] = cam.pitch
        payload["camZoom"] = cam.zoom
        notifyListeners("progress", data: payload)

        if !didEmitArrival, remainingM >= 0, remainingM < 30, alongM > 50 {
            didEmitArrival = true
            notifyListeners("arrived", data: ["reason": "arrived"])
            tearDownSession(emitCancelled: false)
        }
    }

    /// Flatten leg steps into one list so JS stepIndex matches banner indices.
    @MainActor
    private func globalStepIndex(progress: RouteProgress) -> Int {
        var idx = 0
        let legIndex = progress.legIndex
        let legs = progress.route.legs
        for i in 0..<legIndex {
            guard i < legs.count else { break }
            idx += legs[i].steps.count
        }
        idx += progress.currentLegProgress.stepIndex
        return idx
    }

    @MainActor
    private func turnStepsPayload(from routes: NavigationRoutes) -> [[String: Any]] {
        var out: [[String: Any]] = []
        for leg in routes.mainRoute.route.legs {
            for step in leg.steps {
                var item: [String: Any] = [
                    "instruction": step.instructions,
                    "distanceM": step.distance,
                    "maneuverType": step.maneuverType.rawValue,
                ]
                if let dir = step.maneuverDirection {
                    item["maneuverModifier"] = dir.rawValue
                }
                if let code = step.exitCodes?.first, !code.isEmpty {
                    item["exitNumber"] = code
                }
                if let names = step.names, !names.isEmpty {
                    item["roadName"] = names.joined(separator: " / ")
                }
                if let codes = step.codes, !codes.isEmpty {
                    item["roadRef"] = codes.joined(separator: " / ")
                }
                out.append(item)
            }
        }
        return out
    }

    @MainActor
    private func emitRouteGeometry(from routes: NavigationRoutes) {
        // NavigationRoute wraps Directions.Route; shape holds the polyline.
        let coords = routes.mainRoute.route.shape?.coordinates ?? []
        guard !coords.isEmpty else { return }
        let geometry: [[String: Double]] = coords.map { c in
            ["lng": c.longitude, "lat": c.latitude]
        }
        lastNavRoutes = routes
        nativeMap.show(routes: routes)
        notifyListeners("routeChanged", data: [
            "geometry": geometry,
            "turnSteps": turnStepsPayload(from: routes),
        ])
    }

    @MainActor
    private func tearDownSession(emitCancelled: Bool) {
        cancellables.removeAll()
        if let synth = voiceController?.speechSynthesizer {
            synth.muted = true
            synth.stopSpeaking()
        }
        if sessionActive {
            navigationProvider?.mapboxNavigation.tripSession().setToIdle()
            if emitCancelled {
                notifyListeners("cancelled", data: ["reason": "cancelled"])
            }
        }
        sessionActive = false
        voiceEnabled = false
        voiceController = nil
        navigationProvider = nil
        poseHold.reset()
        followCam.reset()
        lastNavRoutes = nil
        nativeMap.detach(webView: webView)
        applyDrivePuckVisible(false)
    }

    @MainActor
    private func applyDrivePuckVisible(_ visible: Bool) {
        if visible {
            guard puckOverlay == nil else { return }
            guard let host = webView?.superview ?? bridge?.viewController?.view else { return }
            let overlay = DrivePuckOverlay(frame: host.bounds)
            overlay.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            overlay.tag = 0x53504452 // "SPDR"
            host.addSubview(overlay)
            overlay.applyLayout()
            puckOverlay = overlay
        } else {
            puckOverlay?.removeFromSuperview()
            puckOverlay = nil
        }
    }
}
