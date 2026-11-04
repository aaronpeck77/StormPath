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
    private var overview = false
    private var snapshotSubscription: AnyCancellable?
    private var snapshotTimer: Timer?
    private var conditionsTemplate: CPListTemplate?
    private var radarButton: CPBarButton?
    private var lastHazardAlertKey = ""
    private var followingStepIndex: Int?
    private var followingLegIndex: Int?

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
        map.waypointColor = .systemRed
        map.puckBearing = .course
        let controller = CarMapViewController(navigationMapView: map)
        map.delegate = controller
        controller.applyPuck()
        controller.onStyleChange = { [weak self] in self?.loadStyle() }
        controller.radar.onStatus = { [weak self] status in self?.radarButton?.title = status }
        mapController = controller
        window.rootViewController = controller

        let template = CPMapTemplate()
        template.mapDelegate = templateForwarder
        template.guidanceBackgroundColor = .black
        template.automaticallyHidesNavigationBar = true
        template.hidesButtonsWithNavigationBar = true
        defaultMapButtons = makeMapButtons(for: template)
        template.mapButtons = defaultMapButtons
        mapTemplate = template
        configureNavigationBar()
        interfaceController.setRootTemplate(template, animated: false, completion: nil)
        snapshotSubscription = NotificationCenter.default.publisher(for: Notification.Name("stormpath.car.updated"))
            .sink { [weak self] _ in
                Task { @MainActor in self?.snapshotUpdated() }
            }
        snapshotTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.snapshotUpdated() }
        }

        loadStyle()
        if guiding {
            showRoutes()
            startTripIfNeeded()
        } else {
            idleLocation.startUpdatingLocation()
        }
        map.navigationCamera.update(cameraState: overview && guiding ? .overview : .following)
        controller.radar.setEnabled(overview && guiding)
    }

    func disconnect() {
        snapshotSubscription = nil
        snapshotTimer?.invalidate()
        snapshotTimer = nil
        conditionsTemplate = nil
        radarButton = nil
        mapController?.radar.setEnabled(false)
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
        mapController?.navigationMapView.navigationCamera.update(cameraState: overview ? .overview : .following)
        mapController?.radar.setEnabled(overview)
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
        overview = false
        lastHazardAlertKey = ""
        mapController?.radar.setEnabled(false)
        configureNavigationBar()
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
        mapController?.navigationMapView.navigationCamera.update(cameraState: overview && guiding ? .overview : .following)
    }

    // MARK: Private

    private func configureNavigationBar() {
        guard let mapTemplate else { return }
        mapTemplate.leadingNavigationBarButtons = [
            CPBarButton(title: overview ? "Drive" : "RT") { [weak self] _ in
                guard let self else { return }
                overview.toggle()
                mapController?.navigationMapView.navigationCamera.update(cameraState: overview && guiding ? .overview : .following)
                mapController?.radar.setEnabled(overview && guiding)
                configureNavigationBar()
            },
            CPBarButton(title: "Conditions") { [weak self] _ in self?.showConditions() },
        ]
        // Radar belongs to the route (RT) view only — in Drive it is noise.
        guard overview else {
            radarButton = nil
            mapTemplate.trailingNavigationBarButtons = []
            return
        }
        let button = CPBarButton(title: mapController?.radar.status ?? "Radar off") { [weak self] _ in
            guard let self, let radar = mapController?.radar else { return }
            radar.setEnabled(!radar.enabled)
        }
        radarButton = button
        mapTemplate.trailingNavigationBarButtons = [button]
    }

    private func snapshotUpdated() {
        mapController?.applyPuck()
        mapController?.setSpeedLimit(UserDefaults.standard.integer(forKey: "stormpath.car.speedLimitMph"))
        maybeShowHazardAlert()
        if let conditionsTemplate {
            conditionsTemplate.updateSections(conditionMenuSections())
        }
    }

    /// CarPlay can't draw the phone's hazard strip — surface it as a pop-up that
    /// points the driver at the phone. Fires once per distinct hazard set.
    private func maybeShowHazardAlert() {
        guard guiding, navigationSession != nil, let mapTemplate else { return }
        guard let hazards = CarConditionSection.read().first(where: { $0.title == "Route hazards" }) else { return }
        let now = Date().timeIntervalSince1970
        let items = hazards.items.filter {
            ($0.expiresAt ?? .greatestFiniteMagnitude) > now && !$0.title.hasPrefix("No hazards")
        }
        guard !items.isEmpty else { return }
        let key = items.prefix(3).map(\.title).joined(separator: "|")
        guard key != lastHazardAlertKey else { return }
        lastHazardAlertKey = key
        let alert = CPNavigationAlert(
            titleVariants: ["Hazards on your route"],
            subtitleVariants: ["\(items.count) flagged ahead — check your phone for details"],
            image: Self.symbol("exclamationmark.triangle.fill"),
            primaryAction: CPAlertAction(title: "OK", style: .default, handler: { _ in }),
            secondaryAction: nil,
            duration: 8
        )
        mapTemplate.present(navigationAlert: alert, animated: true)
    }

    private func showConditionDetail(title: String, detail: String) {
        let parts = detail.components(separatedBy: " · ")
        let grouped = Array(parts.prefix(4)) + (parts.count > 4 ? [parts.dropFirst(4).joined(separator: " · ")] : [])
        let details = grouped.enumerated().map {
            CPInformationItem(title: $0.offset == 0 ? "Details" : "", detail: $0.element)
        }
        let template = CPInformationTemplate(title: title, layout: .leading, items: details, actions: [])
        interfaceController?.pushTemplate(template, animated: true, completion: nil)
    }

    private func conditionMenuSections() -> [CPListSection] {
        let defaults = UserDefaults.standard
        let updated = defaults.double(forKey: "stormpath.car.updatedAt")
        let age = Date().timeIntervalSince1970 - updated
        let stamp = updated > 0 ? Date(timeIntervalSince1970: updated).formatted(date: .omitted, time: .shortened) : "unavailable"
        let state = age > 300 ? "Phone snapshot \(stamp) — may be stale. Not a clear-road indication." : "Phone snapshot \(stamp) — radar is current-map weather, forecast is arrival-time weather."
        let status = CPListItem(text: "StormPath conditions", detailText: state)
        status.isEnabled = false
        let rows = CarConditionSection.read().enumerated().map { index, section in
            let row = CPListItem(text: section.title, detailText: "\(section.items.count) items · tap for details")
            row.handler = { [weak self] _, completion in
                self?.showConditionSection(index: index, page: 0, replace: false)
                completion()
            }
            return row
        }
        let advisoryText = defaults.string(forKey: "stormpath.car.advisory") ?? ""
        let advisory = CPListItem(text: "Route advisory", detailText: advisoryText.isEmpty ? "No advisory in the phone snapshot." : advisoryText)
        advisory.handler = { [weak self] _, completion in
            self?.showConditionDetail(title: "Route advisory", detail: "\(state) · \(advisoryText.isEmpty ? "No advisory available" : advisoryText)")
            completion()
        }
        return [CPListSection(items: [status, advisory] + rows)]
    }

    private func showConditions() {
        guard let interfaceController else { return }
        let template = CPListTemplate(title: "Weather & road alerts", sections: conditionMenuSections())
        conditionsTemplate = template
        interfaceController.pushTemplate(template, animated: true, completion: nil)
    }

    private func showConditionSection(index: Int, page: Int, replace: Bool) {
        guard let interfaceController else { return }
        let sections = CarConditionSection.read()
        guard sections.indices.contains(index) else { return }
        let section = sections[index]
        let now = Date().timeIntervalSince1970
        let available = section.items.filter { ($0.expiresAt ?? .greatestFiniteMagnitude) > now }
        let size = max(1, min(10, CPListTemplate.maximumItemCount - 1))
        let start = min(page * size, available.count)
        var rows = available.dropFirst(start).prefix(size).map { item in
            let row = CPListItem(text: item.title, detailText: item.detail)
            row.handler = { [weak self] _, completion in
                self?.showConditionDetail(title: item.title, detail: item.detail)
                completion()
            }
            return row
        }
        if rows.isEmpty {
            let row = CPListItem(text: "No current items in snapshot", detailText: "Data may be missing or expired. Not proof of clear conditions.")
            row.isEnabled = false
            rows.append(row)
        }
        if start + size < available.count {
            let more = CPListItem(text: "More", detailText: "\(available.count - start - size) remaining")
            more.handler = { [weak self] _, completion in
                self?.showConditionSection(index: index, page: page + 1, replace: true)
                completion()
            }
            rows.append(more)
        }
        let updated = UserDefaults.standard.double(forKey: "stormpath.car.updatedAt")
        let stamp = updated > 0 ? Date(timeIntervalSince1970: updated).formatted(date: .omitted, time: .shortened) : "unavailable"
        let stale = Date().timeIntervalSince1970 - updated > 300 ? " · stale" : ""
        let template = CPListTemplate(title: "\(section.title) · \(stamp)\(stale)", sections: [CPListSection(items: rows)])
        if replace {
            interfaceController.popTemplate(animated: false) { [weak self] _, error in
                guard error == nil else { return }
                self?.interfaceController?.pushTemplate(template, animated: true, completion: nil)
            }
        } else {
            interfaceController.pushTemplate(template, animated: true, completion: nil)
        }
    }

    private func makeMapButtons(for template: CPMapTemplate) -> [CPMapButton] {
        let recenter = CPMapButton { [weak self] _ in
            guard let self else { return }
            overview = false
            mapController?.navigationMapView.navigationCamera.update(cameraState: .following)
            configureNavigationBar()
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
                guard let self else { return }
                controller.positionRouteBelowLabels()
                self.showRoutes()
                controller.radar.styleLoaded()
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
        if let banner = stepProgress.currentVisualInstruction,
           banner != currentBanner || followingStepIndex != progress.currentLegProgress.stepIndex || followingLegIndex != progress.legIndex {
            currentBanner = banner
            followingStepIndex = progress.currentLegProgress.stepIndex
            followingLegIndex = progress.legIndex
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
            var maneuvers = [maneuver]
            if let nextStep = progress.currentLegProgress.upcomingStep,
               let following = nextStep.instructionsDisplayedAlongStep?.last {
                let next = CPManeuver()
                next.instructionVariants = [following.primaryInstruction.text ?? nextStep.instructions]
                next.symbolSet = following.primaryInstruction.maneuverImageSet(
                    side: following.drivingSide,
                    visualInstruction: following.primaryInstruction
                )
                next.initialTravelEstimates = CPTravelEstimates(
                    distanceRemaining: Self.carDistance(nextStep.distance),
                    timeRemaining: nextStep.expectedTravelTime
                )
                maneuvers.append(next)
            }
            navigationSession.upcomingManeuvers = maneuvers
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

final class CarMapViewController: UIViewController, NavigationMapViewDelegate {
    let navigationMapView: NavigationMapView
    var onStyleChange: (() -> Void)?
    lazy var radar = CarRadarOverlay(map: navigationMapView)
    private var puckColor = ""
    private let speedLimitSign = SpeedLimitSignView()

    /// Sourced posted limit only — the phone sends 0 when Mapbox has none, and
    /// the road-class estimate is never published. No estimate ever reaches the sign.
    func setSpeedLimit(_ mph: Int) {
        speedLimitSign.mph = mph > 0 ? mph : nil
    }

    func positionRouteBelowLabels() {
        guard let map = navigationMapView.mapView.mapboxMap else { return }
        if map.layerExists(withId: "road-label") {
            navigationMapView.customRouteLineLayerPosition = .below("road-label")
        }
    }

    func navigationMapView(_ navigationMapView: NavigationMapView, routeLineLayerWithIdentifier identifier: String, sourceIdentifier: String) -> LineLayer? {
        routeLayer(identifier: identifier, source: sourceIdentifier, casing: false)
    }

    func navigationMapView(_ navigationMapView: NavigationMapView, routeCasingLineLayerWithIdentifier identifier: String, sourceIdentifier: String) -> LineLayer? {
        routeLayer(identifier: identifier, source: sourceIdentifier, casing: true)
    }

    private func routeLayer(identifier: String, source: String, casing: Bool) -> LineLayer {
        var layer = LineLayer(id: identifier, source: source)
        layer.lineColor = .constant(StyleColor(casing ? navigationMapView.routeCasingColor : navigationMapView.routeColor))
        layer.lineCap = .constant(.round)
        layer.lineJoin = .constant(.round)
        layer.lineWidth = .expression(Exp(.interpolate) {
            Exp(.linear)
            Exp(.zoom)
            4.0; casing ? 4.0 : 2.0
            10.0; casing ? 6.0 : 4.0
            16.0; casing ? 8.0 : 6.0
            20.0; casing ? 12.0 : 10.0
        })
        return layer
    }

    func applyPuck() {
        let choice = UserDefaults.standard.string(forKey: "stormpath.car.puckColor") ?? "blue"
        guard puckColor != choice else { return }
        puckColor = choice
        let color: UIColor
        switch choice {
        case "orange": color = UIColor(red: 0.98, green: 0.45, blue: 0.09, alpha: 1)
        case "gold": color = UIColor(red: 0.92, green: 0.70, blue: 0.03, alpha: 1)
        case "white": color = UIColor(white: 0.9, alpha: 1)
        default: color = UIColor(red: 0.10, green: 0.45, blue: 0.91, alpha: 1)
        }
        // Stock-size puck, still 3D: phone-color dome with a small top-left sheen.
        // The sheen stays tight — last time it covered half the dome and read as
        // a white/flat disc, hiding the chosen color.
        let dome = UIGraphicsImageRenderer(size: CGSize(width: 22, height: 22)).image { context in
            let ctx = context.cgContext
            ctx.setShadow(offset: CGSize(width: 0, height: 1), blur: 2, color: UIColor.black.withAlphaComponent(0.5).cgColor)
            ctx.setFillColor(UIColor.white.cgColor)
            ctx.fillEllipse(in: CGRect(x: 1, y: 1, width: 20, height: 20))
            ctx.setShadow(offset: .zero, blur: 0, color: nil)
            ctx.saveGState()
            ctx.addEllipse(in: CGRect(x: 3.5, y: 3.5, width: 15, height: 15))
            ctx.clip()
            let highlight = UIColor.white.withAlphaComponent(0.85)
            if let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: [highlight.cgColor, color.cgColor, color.withAlphaComponent(0.85).cgColor] as CFArray, locations: [0, 0.3, 1]) {
                ctx.drawRadialGradient(gradient, startCenter: CGPoint(x: 8, y: 7), startRadius: 0, endCenter: CGPoint(x: 11, y: 11), endRadius: 13, options: [.drawsAfterEndLocation])
            }
            ctx.restoreGState()
        }
        let nose = UIGraphicsImageRenderer(size: CGSize(width: 20, height: 32)).image { context in
            let path = UIBezierPath()
            path.move(to: CGPoint(x: 10, y: 1))
            path.addLine(to: CGPoint(x: 18, y: 18))
            path.addLine(to: CGPoint(x: 2, y: 18))
            path.close()
            color.setFill()
            path.fill()
            UIColor.white.setStroke()
            path.lineWidth = 1.5
            path.stroke()
        }
        var config = Puck2DConfiguration(topImage: dome, bearingImage: nose, scale: .constant(1.0))
        config.pulsing = .none
        navigationMapView.puckType = .puck2D(config)
        navigationMapView.mapView.location.options.puckBearingEnabled = true
    }

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
        speedLimitSign.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(speedLimitSign)
        NSLayoutConstraint.activate([
            speedLimitSign.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 12),
            speedLimitSign.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -12),
        ])
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

/// US-style speed limit placard. Hidden until the phone publishes a sourced
/// (non-estimated) limit — a blank sign beats a wrong one.
final class SpeedLimitSignView: UIView {
    private let titleLabel = UILabel()
    private let numberLabel = UILabel()

    var mph: Int? {
        didSet {
            numberLabel.text = mph.map(String.init)
            isHidden = mph == nil
        }
    }

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .white
        layer.cornerRadius = 6
        layer.borderWidth = 2
        layer.borderColor = UIColor.black.cgColor
        layer.masksToBounds = false
        layer.shadowColor = UIColor.black.cgColor
        layer.shadowOpacity = 0.35
        layer.shadowOffset = CGSize(width: 0, height: 1)
        layer.shadowRadius = 2

        titleLabel.text = "SPEED\nLIMIT"
        titleLabel.numberOfLines = 2
        titleLabel.textAlignment = .center
        titleLabel.textColor = .black
        titleLabel.font = .systemFont(ofSize: 6.5, weight: .bold)
        numberLabel.textAlignment = .center
        numberLabel.textColor = .black
        numberLabel.font = .systemFont(ofSize: 20, weight: .bold)

        let stack = UIStackView(arrangedSubviews: [titleLabel, numberLabel])
        stack.axis = .vertical
        stack.spacing = 0
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: topAnchor, constant: 3),
            stack.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -3),
            stack.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 4),
            stack.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -4),
            widthAnchor.constraint(equalToConstant: 46),
        ])
        isHidden = true
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not used")
    }
}

private struct CarConditionSection: Decodable {
    struct Item: Decodable {
        let title: String
        let detail: String
        let expiresAt: Double?
    }
    let title: String
    let items: [Item]

    static func read() -> [CarConditionSection] {
        guard let raw = UserDefaults.standard.string(forKey: "stormpath.car.conditionsJson"),
              let data = raw.data(using: .utf8), data.count <= 512_000,
              let sections = try? JSONDecoder().decode([CarConditionSection].self, from: data) else { return [] }
        return sections
    }
}

@MainActor
final class CarRadarOverlay {
    private struct Manifest: Decodable {
        struct Radar: Decodable {
            let past: [Frame]?
        }
        let radar: Radar?
    }
    private struct Frame: Decodable, Equatable {
        let time: Double
        let path: String
    }
    private weak var map: NavigationMapView?
    private var frames: [Frame] = []
    private var installed: [String] = []
    private var frameIndex = 0
    private var timer: Timer?
    private var request: Task<Void, Never>?
    private var requestGeneration = 0
    private var errorSubscription: AnyCancelable?
    private var loadSubscription: AnyCancelable?
    private var loadedSources: Set<String> = []
    private var lastFetch: TimeInterval = 0
    private var tileBase = ""
    private(set) var enabled = false
    private(set) var status = "Radar off"
    var onStatus: ((String) -> Void)?

    init(map: NavigationMapView) {
        self.map = map
        errorSubscription = map.mapView.mapboxMap.onMapLoadingError.observe { [weak self] event in
            guard let source = event.sourceId, source.hasPrefix("stormpath-car-radar-") else { return }
            Task { @MainActor in
                guard let self, self.enabled, self.installed.contains(source) else { return }
                // Don't latch "unavailable" — drop the frames and let the next
                // refresh (≤5 min) reinstall instead of staying dead until retoggled.
                self.removeLayers()
                self.setStatus("Radar unavailable")
            }
        }
        loadSubscription = map.mapView.mapboxMap.onSourceDataLoaded.observe { [weak self] event in
            guard event.sourceId.hasPrefix("stormpath-car-radar-"), let loaded = event.loaded else { return }
            let source = event.sourceId
            Task { @MainActor in
                guard let self, self.enabled, self.installed.contains(source) else { return }
                if loaded { self.loadedSources.insert(source) } else { self.loadedSources.remove(source) }
                self.displayFrame()
            }
        }
    }

    func setEnabled(_ value: Bool) {
        guard enabled != value else { return }
        enabled = value
        requestGeneration += 1
        timer?.invalidate()
        timer = nil
        if value {
            setStatus("Radar loading")
            refresh()
            timer = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: true) { [weak self] _ in
                Task { @MainActor in self?.tick() }
            }
        } else {
            request?.cancel()
            request = nil
            removeLayers()
            setStatus("Radar off")
        }
    }

    func styleLoaded() {
        installed = []
        loadedSources = []
        if enabled { installFrames() }
    }

    private func setStatus(_ value: String) {
        guard status != value else { return }
        status = value
        onStatus?(value)
    }

    private func tick() {
        guard enabled else { return }
        if Date().timeIntervalSince1970 - lastFetch >= 300 { refresh() }
        guard !installed.isEmpty else { return }
        if let newest = frames.last, Date().timeIntervalSince1970 - newest.time > 1800 {
            removeLayers()
            setStatus("Radar stale")
            return
        }
        frameIndex = (frameIndex + 1) % installed.count
        displayFrame()
    }

    private func refresh() {
        guard request == nil, enabled else { return }
        guard let base = UserDefaults.standard.string(forKey: "stormpath.car.radarTileBase"),
              !base.isEmpty,
              let url = URL(string: base), url.scheme == "https", url.host != nil,
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil else {
            // Nothing published by the phone yet — recover on the next tick.
            setStatus("Radar needs phone")
            return
        }
        tileBase = base.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        lastFetch = Date().timeIntervalSince1970
        let generation = requestGeneration
        request = Task { [weak self] in
            guard let self else { return }
            defer { if requestGeneration == generation { request = nil } }
            do {
                var manifestRequest = URLRequest(url: URL(string: "https://api.rainviewer.com/public/weather-maps.json")!)
                manifestRequest.timeoutInterval = 12
                let (data, response) = try await URLSession.shared.data(for: manifestRequest)
                guard !Task.isCancelled, enabled, requestGeneration == generation else { return }
                guard (response as? HTTPURLResponse)?.statusCode == 200, data.count <= 256_000 else {
                    setStatus("Radar unavailable")
                    return
                }
                let manifest = try JSONDecoder().decode(Manifest.self, from: data)
                let now = Date().timeIntervalSince1970
                let recent = (manifest.radar?.past ?? []).filter {
                    $0.time <= now + 60 && $0.time >= now - 1800 &&
                    $0.path.range(of: "^/v2/radar/[0-9]+$", options: .regularExpression) != nil
                }.sorted { $0.time < $1.time }
                let selected = Array(recent.suffix(4))
                guard !selected.isEmpty else {
                    removeLayers()
                    frames = []
                    setStatus("Radar unavailable")
                    return
                }
                if frames != selected || installed.isEmpty {
                    removeLayers()
                    frames = selected
                    installFrames()
                }
            } catch {
                guard !Task.isCancelled, requestGeneration == generation else { return }
                // Keep the last good frames animating through a transient failure.
                if frames.isEmpty { setStatus("Radar unavailable") }
            }
        }
    }

    private func installFrames() {
        guard enabled, let style = map?.mapView.mapboxMap, style.isStyleLoaded else { return }
        removeLayers()
        do {
            let anchor = style.allLayerIdentifiers.first { $0.type == .line && $0.id.localizedCaseInsensitiveContains("route") }?.id
                ?? style.allLayerIdentifiers.first { $0.type == .symbol }?.id
            for (index, frame) in frames.enumerated() {
                let id = "stormpath-car-radar-\(index)-\(Int(frame.time))"
                var source = RasterSource(id: id)
                source.tiles = ["\(tileBase)\(frame.path)/256/{z}/{x}/{y}/4/0_1.png"]
                source.tileSize = 256
                source.minzoom = 0
                source.maxzoom = 7
                source.attribution = "Radar © RainViewer"
                try style.addSource(source)
                installed.append(id)
                var layer = RasterLayer(id: id, source: id)
                layer.rasterOpacity = .constant(0.001)
                layer.rasterFadeDuration = .constant(0)
                try style.addLayer(layer, layerPosition: anchor.map { .below($0) })
            }
            frameIndex = max(0, installed.count - 1)
            displayFrame()
        } catch {
            removeLayers()
            setStatus("Radar unavailable")
        }
    }

    private func displayFrame() {
        guard let style = map?.mapView.mapboxMap, frames.indices.contains(frameIndex), installed.indices.contains(frameIndex) else { return }
        guard loadedSources.contains(installed[frameIndex]) else { setStatus("Radar loading"); return }
        do {
            for (index, id) in installed.enumerated() {
                try style.setLayerProperty(for: id, property: "raster-opacity", value: index == frameIndex ? 0.65 : 0.001)
            }
            let time = Date(timeIntervalSince1970: frames[frameIndex].time).formatted(date: .omitted, time: .shortened)
            setStatus("Radar \(time)")
        } catch {
            setStatus("Radar unavailable")
        }
    }

    private func removeLayers() {
        loadedSources = []
        guard let style = map?.mapView.mapboxMap else { installed = []; return }
        for id in installed.reversed() {
            if style.layerExists(withId: id) { try? style.removeLayer(withId: id) }
            if style.sourceExists(withId: id) { try? style.removeSource(withId: id) }
        }
        installed = []
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
