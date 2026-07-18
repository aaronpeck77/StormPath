import Foundation
import Capacitor
import Combine
import CoreLocation
import MapboxDirections
import MapboxNavigationCore

/**
 * Mapbox Navigation Core bridge — no NavigationViewController.
 * Progress / route geometry stream to JS so StormPath Dr/Mp/Rt stay on one map.
 */
@objc(StormpathMapboxNavigationPlugin)
public class StormpathMapboxNavigationPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "StormpathMapboxNavigationPlugin"
    public let jsName = "StormpathMapboxNavigation"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startActiveGuidance", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
    ]

    private var navigationProvider: MapboxNavigationProvider?
    private var cancellables = Set<AnyCancellable>()
    private var sessionActive = false
    private var didEmitArrival = false
    /// Retain voice controller so spoken instructions keep working without UIKit nav UI.
    private var voiceController: AnyObject?

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

        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.tearDownSession(emitCancelled: false)

            // Token must also be in Info.plist as MBXAccessToken (written by sync-ios-version.mjs).
            // Runtime copy helps when the plist was not synced yet.
            UserDefaults.standard.set(accessToken, forKey: "MBXAccessToken")

            let coreConfig = CoreConfig(
                locationSource: simulate ? .simulation() : .live
            )
            let provider = MapboxNavigationProvider(coreConfig: coreConfig)
            self.navigationProvider = provider
            self.voiceController = provider.routeVoiceController
            self.didEmitArrival = false

            let mapboxNavigation = provider.mapboxNavigation
            let options = NavigationRouteOptions(coordinates: coordinates)

            Task { @MainActor in
                let request = mapboxNavigation.routingProvider().calculateRoutes(options: options)
                switch await request.result {
                case .failure(let error):
                    self.tearDownSession(emitCancelled: false)
                    call.reject("Route request failed: \(error.localizedDescription)")
                case .success(let navigationRoutes):
                    self.bindObservers(mapboxNavigation: mapboxNavigation)
                    mapboxNavigation.tripSession().startActiveGuidance(
                        with: navigationRoutes,
                        startLegIndex: 0
                    )
                    self.sessionActive = true
                    self.emitRouteGeometry(from: navigationRoutes)
                    call.resolve(["ok": true])
                }
            }
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.tearDownSession(emitCancelled: true)
            call.resolve()
        }
    }

    private func bindObservers(mapboxNavigation: MapboxNavigation) {
        cancellables.removeAll()

        mapboxNavigation.navigation().routeProgress
            .receive(on: DispatchQueue.main)
            .sink { [weak self] state in
                self?.emitProgress(state: state, navigation: mapboxNavigation)
            }
            .store(in: &cancellables)

        mapboxNavigation.tripSession().navigationRoutes
            .receive(on: DispatchQueue.main)
            .compactMap { $0 }
            .sink { [weak self] routes in
                self?.emitRouteGeometry(from: routes)
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

    private func emitProgress(state: RouteProgressState?, navigation: MapboxNavigation) {
        guard sessionActive, let state else { return }
        let progress = state.routeProgress
        let matching = navigation.navigation().currentLocationMatching
        let coord = matching?.enhancedLocation.coordinate
        let alongM = progress.distanceTraveled
        let remainingM = progress.distanceRemaining
        let stepIndex = progress.currentLegProgress.stepIndex
        let instruction = progress.currentLegProgress.currentStep.instructions

        var payload: [String: Any] = [
            "alongM": alongM,
            "remainingM": remainingM,
            "onRoute": true,
            "stepIndex": stepIndex,
            "instruction": instruction,
        ]
        if let c = coord {
            payload["lng"] = c.longitude
            payload["lat"] = c.latitude
        } else {
            // No matched fix yet — skip puck update but keep session alive.
            return
        }

        notifyListeners("progress", data: payload)

        if !didEmitArrival, remainingM >= 0, remainingM < 30, alongM > 50 {
            didEmitArrival = true
            notifyListeners("arrived", data: ["reason": "arrived"])
            tearDownSession(emitCancelled: false)
        }
    }

    private func emitRouteGeometry(from routes: NavigationRoutes) {
        // NavigationRoute wraps Directions.Route; shape holds the polyline.
        let coords = routes.mainRoute.route.shape?.coordinates ?? []
        guard !coords.isEmpty else { return }
        let geometry: [[String: Double]] = coords.map { c in
            ["lng": c.longitude, "lat": c.latitude]
        }
        notifyListeners("routeChanged", data: [
            "geometry": geometry,
        ])
    }

    private func tearDownSession(emitCancelled: Bool) {
        cancellables.removeAll()
        if sessionActive {
            navigationProvider?.mapboxNavigation.tripSession().setToIdle()
            if emitCancelled {
                notifyListeners("cancelled", data: ["reason": "cancelled"])
            }
        }
        sessionActive = false
        voiceController = nil
        navigationProvider = nil
    }
}
