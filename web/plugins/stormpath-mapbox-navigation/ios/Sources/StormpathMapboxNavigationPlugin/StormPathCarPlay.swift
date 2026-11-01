import CarPlay
import Combine
import CoreLocation
import MapKit
import MapboxDirections
import MapboxMaps
import MapboxNavigationCore
import MapboxNavigationUIKit
import UIKit

/// Car screen. The phone's Core session drives it; the car never starts its own route.
/// Map in the base view, next turn with distance and street, pan, zoom, recenter.
@MainActor
public final class StormPathCarPlay {
    public static let shared = StormPathCarPlay()

    public private(set) var isConnected = false
    /// The car's own navigation took over. The plugin stops the phone trip.
    var onCarCancelledNavigation: (() -> Void)?

    private var interfaceController: CPInterfaceController?
    private var window: CPWindow?
    private var mapTemplate: CPMapTemplate?
    private var mapController: CarMapViewController?
    private var navigationSession: CPNavigationSession?
    private var trip: CPTrip?
    private var currentManeuver: CPManeuver?
    private var currentBanner: VisualInstructionBanner?
    private var routes: NavigationRoutes?
    private var guiding = false
    private var defaultMapButtons: [CPMapButton] = []

    private let locationSubject = CurrentValueSubject<CLLocation?, Never>(nil)
    private let progressSubject = CurrentValueSubject<RouteProgress?, Never>(nil)
    private let idleLocation = CLLocationManager()
    private let locationForwarder = CarLocationForwarder()
    private let templateForwarder = CarMapTemplateForwarder()

    private init() {
        idleLocation.delegate = locationForwarder
        idleLocation.desiredAccuracy = kCLLocationAccuracyBestForNavigation
    }

    // MARK: Scene

    func connect(interfaceController: CPInterfaceController, window: CPWindow) {
        self.interfaceController = interfaceController
        self.window = window
        isConnected = true

        let map = NavigationMapView(
            location: locationSubject.compactMap { $0 }.eraseToAnyPublisher(),
            routeProgress: progressSubject.eraseToAnyPublisher(),
            navigationCameraType: .carPlay
        )
        map.showsAlternatives = false
        map.routeColor = UIColor(red: 0.22, green: 0.74, blue: 0.97, alpha: 1)
        map.routeCasingColor = UIColor(white: 0.05, alpha: 0.85)
        map.puckType = .puck2D(.makeDefault(showBearing: true))
        map.puckBearing = .course
        let controller = CarMapViewController(navigationMapView: map)
        controller.onStyleChange = { [weak self] in self?.loadStyle() }
        mapController = controller
        window.rootViewController = controller

        let template = CPMapTemplate()
        template.mapDelegate = templateForwarder
        defaultMapButtons = makeMapButtons(for: template)
        template.mapButtons = defaultMapButtons
        mapTemplate = template
        interfaceController.setRootTemplate(template, animated: false, completion: nil)

        loadStyle()
        if guiding {
            showRoutes()
            startTripIfNeeded()
        } else {
            idleLocation.startUpdatingLocation()
        }
        map.navigationCamera.update(cameraState: .following)
    }

    func disconnect() {
        idleLocation.stopUpdatingLocation()
        navigationSession = nil
        trip = nil
        currentManeuver = nil
        currentBanner = nil
        window?.rootViewController = nil
        mapController = nil
        mapTemplate = nil
        interfaceController = nil
        window = nil
        isConnected = false
    }

    // MARK: Phone guidance

    func guidanceStarted(routes: NavigationRoutes) {
        guiding = true
        self.routes = routes
        idleLocation.stopUpdatingLocation()
        showRoutes()
        startTripIfNeeded()
        mapController?.navigationMapView.navigationCamera.update(cameraState: .following)
    }

    func routesChanged(_ routes: NavigationRoutes) {
        guard guiding else { return }
        self.routes = routes
        currentBanner = nil
        showRoutes()
        startTripIfNeeded()
    }

    func progressChanged(_ progress: RouteProgress, location: CLLocation) {
        guard guiding else { return }
        locationSubject.send(location)
        progressSubject.send(progress)
        updateManeuver(progress)
    }

    func guidanceEnded(arrived: Bool) {
        guard guiding else { return }
        guiding = false
        routes = nil
        progressSubject.send(nil)
        if let navigationSession {
            if arrived {
                navigationSession.finishTrip()
            } else {
                navigationSession.cancelTrip()
            }
        }
        navigationSession = nil
        trip = nil
        currentManeuver = nil
        currentBanner = nil
        mapController?.navigationMapView.removeRoutes()
        if isConnected {
            idleLocation.startUpdatingLocation()
        }
    }

    // MARK: Template callbacks

    func carCancelledNavigation() {
        navigationSession = nil
        trip = nil
        currentManeuver = nil
        currentBanner = nil
        onCarCancelledNavigation?()
    }

    func idleLocationUpdated(_ location: CLLocation) {
        guard !guiding else { return }
        locationSubject.send(location)
    }

    func pan(_ direction: CPMapTemplate.PanDirection) {
        guard let map = mapController?.navigationMapView else { return }
        map.navigationCamera.stop()
        let mapView = map.mapView
        let bounds = mapView.bounds
        let step = min(bounds.width, bounds.height) / 3
        var point = CGPoint(x: bounds.midX, y: bounds.midY)
        if direction.contains(.up) { point.y -= step }
        if direction.contains(.down) { point.y += step }
        if direction.contains(.left) { point.x -= step }
        if direction.contains(.right) { point.x += step }
        var camera = CameraOptions()
        camera.center = mapView.mapboxMap.coordinate(for: point)
        mapView.mapboxMap.setCamera(to: camera)
    }

    func panningShown() {
        guard let mapTemplate else { return }
        let done = CPMapButton { [weak self] _ in
            self?.mapTemplate?.dismissPanningInterface(animated: true)
        }
        done.image = Self.symbol("xmark")
        mapTemplate.mapButtons = [done]
    }

    func panningDismissed() {
        mapTemplate?.mapButtons = defaultMapButtons
        mapController?.navigationMapView.navigationCamera.update(cameraState: .following)
    }

    // MARK: Private

    private func makeMapButtons(for template: CPMapTemplate) -> [CPMapButton] {
        let recenter = CPMapButton { [weak self] _ in
            self?.mapController?.navigationMapView.navigationCamera.update(cameraState: .following)
        }
        recenter.image = Self.symbol("location.fill")

        let pan = CPMapButton { [weak template] _ in
            guard let template, !template.isPanningInterfaceVisible else { return }
            template.showPanningInterface(animated: true)
        }
        pan.image = Self.symbol("arrow.up.and.down.and.arrow.left.and.right")

        let zoomIn = CPMapButton { [weak self] _ in self?.zoom(by: 1) }
        zoomIn.image = Self.symbol("plus")
        let zoomOut = CPMapButton { [weak self] _ in self?.zoom(by: -1) }
        zoomOut.image = Self.symbol("minus")
        return [recenter, pan, zoomIn, zoomOut]
    }

    private func zoom(by delta: CGFloat) {
        guard let map = mapController?.navigationMapView else { return }
        map.navigationCamera.stop()
        var camera = CameraOptions()
        camera.zoom = map.mapView.mapboxMap.cameraState.zoom + delta
        map.mapView.mapboxMap.setCamera(to: camera)
    }

    private static func symbol(_ name: String) -> UIImage? {
        UIImage(systemName: name, withConfiguration: UIImage.SymbolConfiguration(pointSize: 18, weight: .semibold))
    }

    private func loadStyle() {
        guard let controller = mapController else { return }
        let dark = (window?.traitCollection.userInterfaceStyle ?? controller.traitCollection.userInterfaceStyle) == .dark
        let raw = dark ? "mapbox://styles/mapbox/dark-v11" : "mapbox://styles/mapbox/streets-v12"
        let map = controller.navigationMapView
        if map.mapView.mapboxMap.styleURI?.rawValue == raw { return }
        let uri = StyleURI(rawValue: raw) ?? .streets
        map.mapView.mapboxMap.loadStyle(uri) { [weak self] _ in
            Task { @MainActor in
                self?.showRoutes()
            }
        }
    }

    private func showRoutes() {
        guard let routes, let map = mapController?.navigationMapView else { return }
        map.show(routes, routeAnnotationKinds: [])
    }

    private var destinationLabel: String {
        let saved = UserDefaults.standard.string(forKey: "stormpath.car.destination") ?? ""
        return saved.isEmpty ? "Destination" : saved
    }

    private func startTripIfNeeded() {
        guard guiding, navigationSession == nil, let mapTemplate, let routes else { return }
        let coords = routes.mainRoute.route.shape?.coordinates ?? []
        guard let first = coords.first, let last = coords.last else { return }
        let origin = MKMapItem(placemark: MKPlacemark(coordinate: first))
        let destination = MKMapItem(placemark: MKPlacemark(coordinate: last))
        destination.name = destinationLabel
        let choice = CPRouteChoice(
            summaryVariants: [destinationLabel],
            additionalInformationVariants: [],
            selectionSummaryVariants: []
        )
        let trip = CPTrip(origin: origin, destination: destination, routeChoices: [choice])
        self.trip = trip
        currentManeuver = nil
        currentBanner = nil
        navigationSession = mapTemplate.startNavigationSession(for: trip)
    }

    private func updateManeuver(_ progress: RouteProgress) {
        guard let navigationSession else { return }
        let stepProgress = progress.currentLegProgress.currentStepProgress
        if let banner = stepProgress.currentVisualInstruction, banner != currentBanner {
            currentBanner = banner
            let maneuver = CPManeuver()
            maneuver.initialTravelEstimates = CPTravelEstimates(
                distanceRemaining: Self.carDistance(stepProgress.distanceRemaining),
                timeRemaining: stepProgress.durationRemaining
            )
            var text = banner.primaryInstruction.text ?? progress.currentLegProgress.currentStep.instructions
            if let secondary = banner.secondaryInstruction?.text, !secondary.isEmpty {
                text += "\n\(secondary)"
            }
            maneuver.instructionVariants = [text]
            maneuver.symbolSet = banner.primaryInstruction.maneuverImageSet(
                side: banner.drivingSide,
                visualInstruction: banner.primaryInstruction
            )
            navigationSession.upcomingManeuvers = [maneuver]
            currentManeuver = maneuver
        }
        if let currentManeuver {
            navigationSession.updateEstimates(
                CPTravelEstimates(
                    distanceRemaining: Self.carDistance(stepProgress.distanceRemaining),
                    timeRemaining: stepProgress.durationRemaining
                ),
                for: currentManeuver
            )
        }
        if let trip, let mapTemplate {
            let remaining = progress.durationRemaining
            mapTemplate.update(
                CPTravelEstimates(
                    distanceRemaining: Self.carDistance(progress.distanceRemaining),
                    timeRemaining: remaining > 0 ? max(remaining, 60) : remaining
                ),
                for: trip,
                with: .default
            )
        }
    }

    /// Miles and feet in the US, kilometers and meters elsewhere.
    static func carDistance(_ meters: CLLocationDistance) -> Measurement<UnitLength> {
        let m = max(0, meters)
        if Locale.current.usesMetricSystem {
            if m >= 1000 {
                return Measurement(value: (m / 100).rounded() / 10, unit: .kilometers)
            }
            return Measurement(value: (m / 10).rounded() * 10, unit: .meters)
        }
        let miles = m / 1609.344
        if miles >= 0.1 {
            return Measurement(value: (miles * 10).rounded() / 10, unit: .miles)
        }
        return Measurement(value: (m * 3.28084 / 50).rounded() * 50, unit: .feet)
    }
}

final class CarMapViewController: UIViewController {
    let navigationMapView: NavigationMapView
    var onStyleChange: (() -> Void)?

    init(navigationMapView: NavigationMapView) {
        self.navigationMapView = navigationMapView
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not used")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        navigationMapView.frame = view.bounds
        navigationMapView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(navigationMapView)
    }

    override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()
        navigationMapView.viewportPadding = view.safeAreaInsets
    }

    override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
        super.traitCollectionDidChange(previousTraitCollection)
        if traitCollection.userInterfaceStyle != previousTraitCollection?.userInterfaceStyle {
            onStyleChange?()
        }
    }
}

/// Info.plist names this class for the CarPlay scene role.
@objc(StormPathCarPlaySceneDelegate)
public final class StormPathCarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {
    public func templateApplicationScene(
        _ templateApplicationScene: CPTemplateApplicationScene,
        didConnect interfaceController: CPInterfaceController,
        to window: CPWindow
    ) {
        MainActor.assumeIsolated {
            StormPathCarPlay.shared.connect(interfaceController: interfaceController, window: window)
        }
    }

    public func templateApplicationScene(
        _ templateApplicationScene: CPTemplateApplicationScene,
        didDisconnect interfaceController: CPInterfaceController,
        from window: CPWindow
    ) {
        MainActor.assumeIsolated {
            StormPathCarPlay.shared.disconnect()
        }
    }
}

final class CarMapTemplateForwarder: NSObject, CPMapTemplateDelegate {
    func mapTemplate(_ mapTemplate: CPMapTemplate, panWith direction: CPMapTemplate.PanDirection) {
        MainActor.assumeIsolated { StormPathCarPlay.shared.pan(direction) }
    }

    func mapTemplateDidShowPanningInterface(_ mapTemplate: CPMapTemplate) {
        MainActor.assumeIsolated { StormPathCarPlay.shared.panningShown() }
    }

    func mapTemplateDidDismissPanningInterface(_ mapTemplate: CPMapTemplate) {
        MainActor.assumeIsolated { StormPathCarPlay.shared.panningDismissed() }
    }

    func mapTemplateDidCancelNavigation(_ mapTemplate: CPMapTemplate) {
        MainActor.assumeIsolated { StormPathCarPlay.shared.carCancelledNavigation() }
    }
}

final class CarLocationForwarder: NSObject, CLLocationManagerDelegate {
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let last = locations.last else { return }
        DispatchQueue.main.async {
            MainActor.assumeIsolated { StormPathCarPlay.shared.idleLocationUpdated(last) }
        }
    }
}
