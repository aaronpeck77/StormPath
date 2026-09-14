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
        CAPPluginMethod(name: "prepareActiveGuidance", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startActiveGuidance", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setVoiceGuidance", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setDrivePuckVisible", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setNativeMapVisible", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
    ]

    private var navigationProvider: MapboxNavigationProvider?
    private var cancellables = Set<AnyCancellable>()
    private var sessionActive = false
    /// Prevents overlapping prepare / Go / Stop tears (two providers = hard crash).
    private var tearDownInFlight = false
    /// Serialize prepare / start / stop so a route fetch cannot overlap a new provider.
    private var coreMutexBusy = false
    private var didEmitArrival = false
    /// Retain voice controller so spoken instructions keep working without UIKit nav UI.
    private var voiceController: RouteVoiceController?
    private var voiceEnabled = false
    /// Last-good puck — reject Core leaps before JS / DriveMap see them.
    private var poseHold = DrivePoseHold()
    private var followCam = DriveFollowCam()
    private var puckOverlay: DrivePuckOverlay?
    /// Nil at init — create on the main actor. Do not `= DriveNativeMap()` here.
    private var nativeMap: DriveNativeMap?
    private var pendingNativeMapVisible = false
    private var lastNavRoutes: NavigationRoutes?
    /// Fingerprint of the last prepared / started corridor so Go can skip a second plan.
    private var preparedRouteKey = ""
    /// Bumped on every tearDown so an in-flight prepare cannot install a stale provider after Go.
    private var coreEpoch = 0

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

        let simulate = call.getBool("simulate") ?? false
        let voice = call.getBool("voiceEnabled") ?? false
        let preferBackroads = call.getBool("preferBackroads") ?? false

        Task { @MainActor [weak self] in
            guard let self else { return }
            await self.startGuidanceOnMainActor(
                accessToken: accessToken,
                waypoints: self.parseWaypoints(from: rawCoords),
                simulate: simulate,
                voiceEnabled: voice,
                preferBackroads: preferBackroads,
                call: call
            )
        }
    }

    @objc func prepareActiveGuidance(_ call: CAPPluginCall) {
        guard let accessToken = call.getString("accessToken"), !accessToken.isEmpty else {
            call.reject("accessToken required")
            return
        }
        guard let rawCoords = call.getArray("coordinates", JSObject.self), rawCoords.count >= 2 else {
            call.reject("coordinates must include at least origin and destination")
            return
        }
        let preferBackroads = call.getBool("preferBackroads") ?? false
        Task { @MainActor [weak self] in
            guard let self else { return }
            await self.prepareGuidanceOnMainActor(
                accessToken: accessToken,
                waypoints: self.parseWaypoints(from: rawCoords),
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
        let styleUrl = call.getString("styleUrl")
        Task { @MainActor [weak self] in
            guard let self else { return }
            let revealed = self.applyNativeMapVisible(visible, styleUrl: styleUrl)
            call.resolve(["ok": true, "visible": visible, "revealed": revealed])
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
            guard let self else {
                call.resolve()
                return
            }
            /* Soft-idle only — nilling the provider on Stop hard-crashed the IPA
             * even after a drain sleep. Mapbox examples keep the provider alive. */
            await self.withCoreMutex {
                await self.softStopGuidance()
            }
            call.resolve()
        }
    }

    /** One Core mutation at a time — overlapping prepare + Go left two providers alive. */
    @MainActor
    private func withCoreMutex(_ body: () async -> Void) async {
        while coreMutexBusy {
            try? await Task.sleep(nanoseconds: 25_000_000)
        }
        coreMutexBusy = true
        defer { coreMutexBusy = false }
        await body()
    }

    private struct IncomingWaypoint {
        var coordinate: CLLocationCoordinate2D
        var separatesLegs: Bool
        var headingDeg: Double?
    }

    private func parseWaypoints(from rawCoords: [JSObject]) -> [IncomingWaypoint] {
        var out: [IncomingWaypoint] = []
        out.reserveCapacity(rawCoords.count)
        for (index, obj) in rawCoords.enumerated() {
            let lngNum = obj["lng"] as? Double ?? (obj["lng"] as? NSNumber)?.doubleValue
            let latNum = obj["lat"] as? Double ?? (obj["lat"] as? NSNumber)?.doubleValue
            guard let lng = lngNum, let lat = latNum else { continue }
            let separates: Bool
            if let flag = obj["separatesLegs"] as? Bool {
                separates = flag
            } else if let flag = (obj["separatesLegs"] as? NSNumber)?.boolValue {
                separates = flag
            } else {
                separates = index > 0 && index < rawCoords.count - 1 ? false : true
            }
            let heading = obj["headingDeg"] as? Double ?? (obj["headingDeg"] as? NSNumber)?.doubleValue
            out.append(IncomingWaypoint(
                coordinate: CLLocationCoordinate2D(latitude: lat, longitude: lng),
                separatesLegs: separates,
                headingDeg: heading
            ))
        }
        return out
    }

    private func makeWaypoints(_ incoming: [IncomingWaypoint]) -> [Waypoint] {
        incoming.enumerated().map { index, item in
            var waypoint = Waypoint(coordinate: item.coordinate)
            if index > 0 && index < incoming.count - 1 {
                waypoint.separatesLegs = item.separatesLegs
                waypoint.coordinateAccuracy = item.separatesLegs ? 25 : 80
            }
            if index == 0, let heading = item.headingDeg, heading >= 0 {
                waypoint.heading = heading
                waypoint.headingAccuracy = 90
            }
            return waypoint
        }
    }

    private func routeKey(waypoints: [IncomingWaypoint], preferBackroads: Bool) -> String {
        guard let first = waypoints.first, let last = waypoints.last else { return "" }
        return "\(first.coordinate.latitude),\(first.coordinate.longitude)|\(last.coordinate.latitude),\(last.coordinate.longitude)|\(waypoints.count)|\(preferBackroads)"
    }

    @MainActor
    private func makeCoreConfig(accessToken: String, simulate: Bool) -> CoreConfig {
        var coreConfig = CoreConfig(
            credentials: .init(accessToken: accessToken),
            locationSource: simulate ? .simulation(initialLocation: nil) : .live
        )
        // Tiles + routing graph along the trip so tunnels / dead zones keep following.
        coreConfig.predictiveCacheConfig = PredictiveCacheConfig()
        // Off-route recovery is Core's job. Do not auto-swap a locked B for a faster highway.
        coreConfig.routingConfig.rerouteConfig.detectsReroute = true
        coreConfig.routingConfig.fasterRouteDetectionConfig = nil
        return coreConfig
    }

    @MainActor
    private func prepareGuidanceOnMainActor(
        accessToken: String,
        waypoints incoming: [IncomingWaypoint],
        preferBackroads: Bool,
        call: CAPPluginCall
    ) async {
        guard incoming.count >= 2 else {
            call.reject("coordinates must include at least origin and destination")
            return
        }
        await withCoreMutex {
            if sessionActive {
                call.resolve(["ok": true, "prepared": true, "skipped": true])
                return
            }
            let key = routeKey(waypoints: incoming, preferBackroads: preferBackroads)
            if lastNavRoutes != nil, navigationProvider != nil, preparedRouteKey == key {
                call.resolve(["ok": true, "prepared": true, "cached": true])
                return
            }

            await tearDownSession(emitCancelled: false)
            let epoch = coreEpoch
            let provider = MapboxNavigationProvider(coreConfig: makeCoreConfig(accessToken: accessToken, simulate: false))
            navigationProvider = provider
            let options = NavigationRouteOptions(waypoints: makeWaypoints(incoming))
            if preferBackroads {
                options.roadClassesToAvoid = .motorway
            }
            do {
                let navigationRoutes = try await provider.mapboxNavigation
                    .routingProvider()
                    .calculateRoutes(options: options)
                    .value
                guard epoch == coreEpoch, navigationProvider === provider else {
                    call.resolve(["ok": true, "prepared": false, "superseded": true])
                    return
                }
                lastNavRoutes = navigationRoutes
                preparedRouteKey = key
                call.resolve(["ok": true, "prepared": true])
            } catch {
                guard epoch == coreEpoch else {
                    call.resolve(["ok": true, "prepared": false, "superseded": true])
                    return
                }
                await tearDownSession(emitCancelled: false)
                call.reject("Route request failed: \(error.localizedDescription)")
            }
        }
    }

    @MainActor
    private func startGuidanceOnMainActor(
        accessToken: String,
        waypoints incoming: [IncomingWaypoint],
        simulate: Bool,
        voiceEnabled: Bool,
        preferBackroads: Bool,
        call: CAPPluginCall
    ) async {
        guard incoming.count >= 2 else {
            call.reject("coordinates must include at least origin and destination")
            return
        }
        await withCoreMutex {
            let key = routeKey(waypoints: incoming, preferBackroads: preferBackroads)
            let canReusePrepared = !sessionActive
                && lastNavRoutes != nil
                && navigationProvider != nil
                && preparedRouteKey == key
                && !simulate

            if !canReusePrepared {
                await tearDownSession(emitCancelled: false)
                navigationProvider = MapboxNavigationProvider(
                    coreConfig: makeCoreConfig(accessToken: accessToken, simulate: simulate)
                )
            }

            guard let provider = navigationProvider else {
                call.reject("Navigation provider missing")
                return
            }
            didEmitArrival = false
            applyVoiceEnabled(voiceEnabled)

            let mapboxNavigation = provider.mapboxNavigation
            do {
                let navigationRoutes: NavigationRoutes
                if canReusePrepared, let prepared = lastNavRoutes {
                    navigationRoutes = prepared
                } else {
                    let options = NavigationRouteOptions(waypoints: makeWaypoints(incoming))
                    if preferBackroads {
                        options.roadClassesToAvoid = .motorway
                    }
                    navigationRoutes = try await mapboxNavigation
                        .routingProvider()
                        .calculateRoutes(options: options)
                        .value
                }

                guard navigationProvider === provider else {
                    call.reject("Navigation session was replaced")
                    return
                }

                bindObservers(mapboxNavigation: mapboxNavigation)
                mapboxNavigation.tripSession().startActiveGuidance(
                    with: navigationRoutes,
                    startLegIndex: 0
                )
                sessionActive = true
                lastNavRoutes = navigationRoutes
                preparedRouteKey = key
                emitRouteGeometry(from: navigationRoutes)
                if pendingNativeMapVisible {
                    applyNativeMapVisible(true)
                }
                call.resolve(["ok": true, "reused": canReusePrepared])
            } catch {
                await tearDownSession(emitCancelled: false)
                call.reject("Route request failed: \(error.localizedDescription)")
            }
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
        if pendingNativeMapVisible || nativeMap != nil {
            nativeMap?.applyFollowCamera(cam)
        }
        if let showing = nativeMap?.isShowing {
            payload["nativeMapShowing"] = showing
        }
        notifyListeners("progress", data: payload)

        if !didEmitArrival, remainingM >= 0, remainingM < 30, alongM > 50 {
            didEmitArrival = true
            notifyListeners("arrived", data: ["reason": "arrived"])
            Task { @MainActor [weak self] in
                guard let self else { return }
                await self.withCoreMutex {
                    await self.softStopGuidance()
                }
            }
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
        guard sessionActive else { return }
        // NavigationRoute wraps Directions.Route; shape holds the polyline.
        let coords = routes.mainRoute.route.shape?.coordinates ?? []
        guard !coords.isEmpty else { return }
        let geometry: [[String: Double]] = coords.map { c in
            ["lng": c.longitude, "lat": c.latitude]
        }
        lastNavRoutes = routes
        nativeMap?.show(routes: routes)
        notifyListeners("routeChanged", data: [
            "geometry": geometry,
            "turnSteps": turnStepsPayload(from: routes),
        ])
    }

    /**
     * User Stop / arrival: idle Core, drop observers, **keep** `MapboxNavigationProvider`.
     * Releasing the provider on Stop (even after a drain) hard-crashed the IPA.
     * Next prepare / Go calls `tearDownSession` under the mutex and replaces it.
     * Callers must hold `withCoreMutex`.
     */
    @MainActor
    private func softStopGuidance() async {
        while tearDownInFlight {
            try? await Task.sleep(nanoseconds: 20_000_000)
        }
        if navigationProvider == nil && !sessionActive {
            poseHold.reset()
            followCam.reset()
            lastNavRoutes = nil
            preparedRouteKey = ""
            pendingNativeMapVisible = false
            return
        }

        tearDownInFlight = true
        defer { tearDownInFlight = false }

        let wasActive = sessionActive
        sessionActive = false
        coreEpoch += 1
        cancellables.removeAll()
        if let synth = voiceController?.speechSynthesizer {
            synth.muted = true
            /* Skip stopSpeaking — it raced Core's own speech teardown on Stop. */
        }
        voiceController = nil
        voiceEnabled = false

        nativeMap?.detach(webView: webView)
        nativeMap = nil
        applyDrivePuckVisible(false)

        /* Do not call setToIdle on Stop — that path still hard-crashed the IPA.
         * Provider stays alive (muted, no observers). Next prepare/Go tearDown idles + releases. */
        _ = wasActive

        poseHold.reset()
        followCam.reset()
        lastNavRoutes = nil
        preparedRouteKey = ""
        pendingNativeMapVisible = false
        /* Keep navigationProvider until prepare / Go tearDown replaces it. */
    }

    /**
     * Full Core release before installing a replacement provider (prepare / Go).
     * Callers must hold `withCoreMutex`. Never overlap two providers.
     */
    @MainActor
    private func tearDownSession(emitCancelled: Bool) async {
        while tearDownInFlight {
            try? await Task.sleep(nanoseconds: 20_000_000)
        }
        if navigationProvider == nil && !sessionActive {
            poseHold.reset()
            followCam.reset()
            lastNavRoutes = nil
            preparedRouteKey = ""
            pendingNativeMapVisible = false
            return
        }

        tearDownInFlight = true
        defer { tearDownInFlight = false }

        let wasActive = sessionActive
        sessionActive = false
        coreEpoch += 1
        cancellables.removeAll()
        if let synth = voiceController?.speechSynthesizer {
            synth.muted = true
        }
        voiceController = nil
        voiceEnabled = false

        nativeMap?.detach(webView: webView)
        nativeMap = nil
        applyDrivePuckVisible(false)

        let provider = navigationProvider
        /* Always idle before release — soft-stop may have left guidance running. */
        if provider != nil {
            provider?.mapboxNavigation.tripSession().setToIdle()
            try? await Task.sleep(nanoseconds: 400_000_000)
            if emitCancelled && wasActive {
                notifyListeners("cancelled", data: ["reason": "cancelled"])
            }
        }
        navigationProvider = nil

        poseHold.reset()
        followCam.reset()
        lastNavRoutes = nil
        preparedRouteKey = ""
        pendingNativeMapVisible = false
    }

    @MainActor
    private func applyNativeMapVisible(_ visible: Bool, styleUrl: String? = nil) -> Bool {
        pendingNativeMapVisible = visible
        guard visible else {
            nativeMap?.setVisible(false, webView: webView)
            return false
        }
        guard let provider = navigationProvider, let host = webView?.superview, let wv = webView else {
            return false
        }
        let map = nativeMap ?? DriveNativeMap()
        nativeMap = map
        map.attach(
            host: host,
            webView: wv,
            navigation: provider.mapboxNavigation,
            predictiveCacheManager: provider.predictiveCacheManager,
            routes: lastNavRoutes,
            styleUrl: styleUrl
        )
        return map.setVisible(true, webView: wv)
    }

    @MainActor
    private func applyDrivePuckVisible(_ visible: Bool) {
        // Native chevron sits on the UIKit host above the WebView, so it covers
        // About / weather / Route info. Parked — Drive uses the web puck.
        _ = visible
        puckOverlay?.removeFromSuperview()
        puckOverlay = nil
    }
}
