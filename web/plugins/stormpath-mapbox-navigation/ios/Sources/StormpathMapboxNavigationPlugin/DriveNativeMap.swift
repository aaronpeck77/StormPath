import Combine
import CoreLocation
import MapboxMaps
import MapboxNavigationCore
import UIKit
import WebKit

/// A controlled intersection on the driven corridor (Mapbox Directions intersection flags).
struct DriveRoadControl {
    enum Kind: String, CaseIterable {
        case trafficSignal = "traffic_signal"
        case stopSign = "stop_sign"
        case yieldSign = "yield_sign"
        case railwayCrossing = "railway_crossing"

        var imageId: String { "sp-control-\(rawValue)" }
    }

    let lng: Double
    let lat: Double
    let kind: Kind
}

/// Native NavigationMapView under the Capacitor WebView — tiles / route / puck / follow-cam.
/// Not @MainActor: CAPPlugin property init is nonisolated (Xcode 26 isolation error).
/// Create the instance from a MainActor Task; touch UIKit only from @MainActor methods.
final class DriveNativeMap {
    private var mapView: NavigationMapView?
    private var lastRoutes: NavigationRoutes?
    private weak var hostedWebView: UIView?
    private var webViewWasOpaque = true
    private var webViewBackground: UIColor?
    private var scrollBackground: UIColor?
    private var revealedThroughWebView = false
    private var styleReady = false
    private var lastFollowSample: DriveFollowCameraSample?
    private var roadControls: [DriveRoadControl] = []
    private static let roadControlSourceId = "stormpath-road-controls"
    private static let roadControlLayerId = "stormpath-road-controls-icons"
    /** Matches the web basemap (day streets / night dark or navigation-night). */
    private var styleUrl = "mapbox://styles/mapbox/streets-v12"

    @MainActor
    func attach(
        host: UIView,
        webView: UIView,
        navigation: MapboxNavigation,
        predictiveCacheManager: PredictiveCacheManager?,
        routes: NavigationRoutes?,
        styleUrl: String?
    ) {
        lastRoutes = routes ?? lastRoutes
        hostedWebView = webView
        if let styleUrl, !styleUrl.isEmpty {
            self.styleUrl = styleUrl
        }
        if mapView == nil {
            let nav = navigation.navigation()
            let map = NavigationMapView(
                location: nav.locationMatching.map(\.enhancedLocation).eraseToAnyPublisher(),
                routeProgress: nav.routeProgress.map(\.?.routeProgress).eraseToAnyPublisher(),
                predictiveCacheManager: predictiveCacheManager
            )
            map.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            map.frame = host.bounds
            applyStormPathRouteStyle(on: map)
            applyStormPathPuck(on: map)
            map.showsAlternatives = false
            map.showsRelativeDurationsOnAlternativeManuever = false
            map.navigationCamera.stop()
            map.isHidden = true
            host.insertSubview(map, belowSubview: webView)
            mapView = map
            applyStormPathStyle(on: map)
        } else if let map = mapView {
            /* Style may change (day→night) between trips — reload only when URL differs. */
            applyStormPathStyleIfNeeded(on: map)
        }
        /* Keep the WebView opaque until follow-cam has framed street level.
         * Clearing it here flashes Mapbox's default globe / triangle puck. */
        makeWebViewClear(webView, clear: false)
        if let lastRoutes {
            mapView?.show(lastRoutes, routeAnnotationKinds: [])
        }
        mapView?.navigationCamera.stop()
    }

    @MainActor
    func show(routes: NavigationRoutes) {
        lastRoutes = routes
        if let mapView {
            applyStormPathRouteStyle(on: mapView)
        }
        mapView?.show(routes, routeAnnotationKinds: [])
    }

    @MainActor
    func applyFollowCamera(_ sample: DriveFollowCameraSample) {
        lastFollowSample = sample
        guard styleReady else { return }
        if let mapView {
            applyStormPathPuck(on: mapView)
        }
        writeFollowCamera(sample)
        revealIfFramed()
    }

    @MainActor
    func setVisible(_ visible: Bool, webView: UIView?) -> Bool {
        if !visible {
            revealedThroughWebView = false
            mapView?.isHidden = true
            if let webView {
                makeWebViewClear(webView, clear: false)
            }
            return false
        }
        hostedWebView = webView ?? hostedWebView
        /* Re-entering Dr after Mp/Rt: reuse last follow sample so the hole is never blank. */
        if styleReady, let sample = lastFollowSample {
            writeFollowCamera(sample)
            revealedThroughWebView = false
            revealIfFramed()
            return revealedThroughWebView
        }
        /* First Go — wait for progress to frame, then reveal. Keep WebView opaque until then. */
        mapView?.isHidden = true
        if let hostedWebView {
            makeWebViewClear(hostedWebView, clear: false)
        }
        return false
    }

    @MainActor
    func detach(webView: UIView?) {
        if let webView {
            makeWebViewClear(webView, clear: false)
        }
        mapView?.removeFromSuperview()
        mapView = nil
        lastRoutes = nil
        hostedWebView = nil
        revealedThroughWebView = false
        styleReady = false
        lastFollowSample = nil
    }

    @MainActor
    var isShowing: Bool {
        guard let mapView else { return false }
        return !mapView.isHidden
    }

    @MainActor
    private func writeFollowCamera(_ sample: DriveFollowCameraSample) {
        guard let mapView else { return }
        mapView.navigationCamera.stop()
        let height = mapView.bounds.height
        let width = mapView.bounds.width
        /* 30-yard line: puck ~70% down the screen, road ahead above. */
        let topPad = height > 1 ? height * 0.58 : 320
        let bottomPad = height > 1 ? height * 0.18 : 120
        let sidePad = width > 1 ? max(16, width * 0.04) : 20
        let options = CameraOptions(
            center: CLLocationCoordinate2D(latitude: sample.lat, longitude: sample.lng),
            padding: UIEdgeInsets(top: topPad, left: sidePad, bottom: bottomPad, right: sidePad),
            zoom: sample.zoom,
            bearing: sample.bearing,
            pitch: max(sample.pitch, 64)
        )
        mapView.mapView.mapboxMap.setCamera(to: options)
    }

    @MainActor
    private func revealIfFramed() {
        guard styleReady, lastFollowSample != nil, !revealedThroughWebView else { return }
        revealedThroughWebView = true
        mapView?.isHidden = false
        if let hostedWebView {
            makeWebViewClear(hostedWebView, clear: true)
        }
    }

    @MainActor
    private func applyStormPathStyleIfNeeded(on map: NavigationMapView) {
        let current = map.mapView.mapboxMap.styleURI?.rawValue
        if current == styleUrl, styleReady {
            applyStormPathPuck(on: map)
            return
        }
        applyStormPathStyle(on: map)
    }

    @MainActor
    private func applyStormPathStyle(on map: NavigationMapView) {
        styleReady = false
        revealedThroughWebView = false
        let uri = StyleURI(rawValue: styleUrl) ?? StyleURI(rawValue: "mapbox://styles/mapbox/streets-v12") ?? .streets
        map.mapView.mapboxMap.loadStyle(uri) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                self.styleReady = true
                self.applyStormPathRouteStyle(on: map)
                self.applyStormPathPuck(on: map)
                if let routes = self.lastRoutes {
                    self.mapView?.show(routes, routeAnnotationKinds: [])
                }
                /* Prefer last follow sample so first paint is the puck, not Mapbox default. */
                if let sample = self.lastFollowSample {
                    self.writeFollowCamera(sample)
                    self.revealIfFramed()
                } else {
                    var boot = CameraOptions()
                    boot.pitch = 64
                    map.mapView.mapboxMap.setCamera(to: boot)
                }
                self.addStormPathBuildings()
                self.applyRoadControls(on: map)
            }
        }
    }

    @MainActor
    private func applyStormPathPuck(on map: NavigationMapView) {
        /* Raised blue dome with a short course nose and a ground shadow. Mapbox's only
         * bundled 3D model is the big arrow, so the dimension is drawn here instead:
         * shadow and bearing nose render under the dome, dome on top. */
        var config = Puck2DConfiguration(
            topImage: DriveNativeMap.puckDomeImage,
            bearingImage: DriveNativeMap.puckNoseImage,
            shadowImage: DriveNativeMap.puckShadowImage,
            scale: .constant(1.0)
        )
        config.pulsing = .none
        map.puckType = .puck2D(config)
        map.puckBearing = .course
        map.mapView.location.options.puckBearingEnabled = true
    }

    private static func renderMapImage(
        size: CGSize,
        _ draw: (CGContext, CGRect) -> Void
    ) -> UIImage {
        let format = UIGraphicsImageRendererFormat.default()
        format.opaque = false
        format.scale = 3
        return UIGraphicsImageRenderer(size: size, format: format).image { ctx in
            draw(ctx.cgContext, CGRect(origin: .zero, size: size))
        }
    }

    /** Dome body — white ring, top-left lit gradient, specular cap. */
    private static let puckDomeImage: UIImage = renderMapImage(
        size: CGSize(width: 30, height: 30)
    ) { ctx, rect in
        ctx.setFillColor(UIColor.white.cgColor)
        ctx.fillEllipse(in: rect)

        let body = rect.insetBy(dx: 2, dy: 2)
        ctx.saveGState()
        ctx.addEllipse(in: body)
        ctx.clip()
        let colors = [
            UIColor(red: 0.49, green: 0.83, blue: 0.99, alpha: 1).cgColor,
            UIColor(red: 0.02, green: 0.40, blue: 0.70, alpha: 1).cgColor,
        ] as CFArray
        if let gradient = CGGradient(
            colorsSpace: CGColorSpaceCreateDeviceRGB(),
            colors: colors,
            locations: [0, 1]
        ) {
            ctx.drawRadialGradient(
                gradient,
                startCenter: CGPoint(x: body.midX - body.width * 0.22, y: body.midY - body.height * 0.26),
                startRadius: 0,
                endCenter: CGPoint(x: body.midX, y: body.midY),
                endRadius: body.width * 0.78,
                options: [.drawsAfterEndLocation]
            )
        }
        ctx.setFillColor(UIColor(white: 1, alpha: 0.30).cgColor)
        ctx.fillEllipse(in: CGRect(
            x: body.minX + body.width * 0.22,
            y: body.minY + body.height * 0.13,
            width: body.width * 0.36,
            height: body.height * 0.22
        ))
        ctx.restoreGState()
    }

    /** Course nose — sits under the dome, only the tip shows ahead of it. */
    private static let puckNoseImage: UIImage = renderMapImage(
        size: CGSize(width: 26, height: 42)
    ) { ctx, rect in
        let tip = CGPoint(x: rect.midX, y: rect.minY + 1)
        let path = UIBezierPath()
        path.move(to: tip)
        path.addQuadCurve(
            to: CGPoint(x: rect.maxX - 3, y: rect.midY + 2),
            controlPoint: CGPoint(x: rect.maxX - 3, y: rect.minY + 9)
        )
        path.addLine(to: CGPoint(x: rect.minX + 3, y: rect.midY + 2))
        path.addQuadCurve(to: tip, controlPoint: CGPoint(x: rect.minX + 3, y: rect.minY + 9))
        path.close()
        ctx.setFillColor(UIColor(red: 0.05, green: 0.62, blue: 0.91, alpha: 0.92).cgColor)
        ctx.addPath(path.cgPath)
        ctx.fillPath()
    }

    /** Ground shadow — soft radial blob so the dome looks lifted off the road. */
    private static let puckShadowImage: UIImage = renderMapImage(
        size: CGSize(width: 42, height: 42)
    ) { ctx, rect in
        let colors = [
            UIColor(white: 0, alpha: 0.34).cgColor,
            UIColor(white: 0, alpha: 0).cgColor,
        ] as CFArray
        guard let gradient = CGGradient(
            colorsSpace: CGColorSpaceCreateDeviceRGB(),
            colors: colors,
            locations: [0, 1]
        ) else { return }
        ctx.drawRadialGradient(
            gradient,
            startCenter: CGPoint(x: rect.midX, y: rect.midY + 2),
            startRadius: 0,
            endCenter: CGPoint(x: rect.midX, y: rect.midY + 2),
            endRadius: rect.width * 0.5,
            options: []
        )
    }

    /**
     * Keep the route under road names/shields and closer to pavement width.
     * Web map already parks route under `road-label`; native Nav defaults sit on top / thick.
     */
    @MainActor
    private func applyStormPathRouteStyle(on map: NavigationMapView) {
        map.customRouteLineLayerPosition = .below("road-label")
        map.routeColor = UIColor(red: 0.22, green: 0.74, blue: 0.97, alpha: 1) /* #38bdf8 */
        map.routeCasingColor = UIColor(white: 0.05, alpha: 0.85)
    }

    @MainActor
    private func addStormPathBuildings() {
        guard let mapView else { return }
        guard let style = mapView.mapView.mapboxMap else { return }
        let layerId = "stormpath-3d-buildings"
        if style.layerExists(withId: layerId) {
            try? style.removeLayer(withId: layerId)
        }
        do {
            var buildings = FillExtrusionLayer(id: layerId, source: "composite")
            buildings.sourceLayer = "building"
            buildings.minZoom = 13
            buildings.filter = Exp(.eq) {
                Exp(.get) { "extrude" }
                "true"
            }
            let night = styleUrl.contains("dark") || styleUrl.contains("night")
            let fill = night
                ? UIColor(white: 0.22, alpha: 1)
                : UIColor(white: 0.78, alpha: 1)
            buildings.fillExtrusionColor = .constant(StyleColor(fill))
            buildings.fillExtrusionHeight = .expression(Exp(.get) { "height" })
            buildings.fillExtrusionBase = .expression(Exp(.get) { "min_height" })
            buildings.fillExtrusionOpacity = .constant(night ? 0.9 : 0.8)
            try style.addLayer(buildings)
        } catch {
            /* Style may already extrude buildings; pitch is what makes them read 3D. */
        }
    }

    /// Signals / stop / yield / rail crossings for the current corridor. Empty clears them.
    @MainActor
    func setRoadControls(_ points: [DriveRoadControl]) {
        roadControls = points
        guard styleReady, let mapView else { return }
        applyRoadControls(on: mapView)
    }

    @MainActor
    private func applyRoadControls(on map: NavigationMapView) {
        guard let style = map.mapView.mapboxMap else { return }
        guard !roadControls.isEmpty else {
            if style.layerExists(withId: Self.roadControlLayerId) {
                try? style.removeLayer(withId: Self.roadControlLayerId)
            }
            if style.sourceExists(withId: Self.roadControlSourceId) {
                try? style.removeSource(withId: Self.roadControlSourceId)
            }
            return
        }

        /* Re-adding an existing id just replaces it, and a style reload drops them all. */
        for kind in DriveRoadControl.Kind.allCases {
            try? style.addImage(Self.roadControlImage(kind), id: kind.imageId)
        }

        var features: [Feature] = []
        features.reserveCapacity(roadControls.count)
        for point in roadControls {
            var feature = Feature(
                geometry: .point(
                    Point(CLLocationCoordinate2D(latitude: point.lat, longitude: point.lng))
                )
            )
            feature.properties = ["icon": .string(point.kind.imageId)]
            features.append(feature)
        }
        let collection = FeatureCollection(features: features)

        if style.sourceExists(withId: Self.roadControlSourceId) {
            style.updateGeoJSONSource(
                withId: Self.roadControlSourceId,
                geoJSON: .featureCollection(collection)
            )
        } else {
            var source = GeoJSONSource(id: Self.roadControlSourceId)
            source.data = .featureCollection(collection)
            try? style.addSource(source)
        }

        guard !style.layerExists(withId: Self.roadControlLayerId) else { return }
        var layer = SymbolLayer(id: Self.roadControlLayerId, source: Self.roadControlSourceId)
        /* Street level only — signal heads are noise on a state-wide view. */
        layer.minZoom = 13
        layer.iconImage = .expression(Exp(.get) { "icon" })
        layer.iconAllowOverlap = .constant(false)
        layer.iconSize = .expression(
            Exp(.interpolate) {
                Exp(.linear)
                Exp(.zoom)
                13
                0.5
                15
                0.72
                17
                0.95
            }
        )
        try? style.addLayer(layer)
    }

    private static func roadControlImage(_ kind: DriveRoadControl.Kind) -> UIImage {
        switch kind {
        case .trafficSignal: return signalIconImage
        case .stopSign: return stopIconImage
        case .yieldSign: return yieldIconImage
        case .railwayCrossing: return railIconImage
        }
    }

    /** Signal head — dark body, three lamps, readable at a glance while moving. */
    private static let signalIconImage: UIImage = renderMapImage(
        size: CGSize(width: 20, height: 20)
    ) { ctx, rect in
        let w = rect.width * 0.46
        let h = rect.height * 0.86
        let body = CGRect(x: (rect.width - w) / 2, y: (rect.height - h) / 2, width: w, height: h)
        let path = UIBezierPath(roundedRect: body, cornerRadius: w * 0.3)
        ctx.setFillColor(UIColor(red: 0.06, green: 0.09, blue: 0.16, alpha: 0.95).cgColor)
        ctx.addPath(path.cgPath)
        ctx.fillPath()
        ctx.setStrokeColor(UIColor(white: 1, alpha: 0.9).cgColor)
        ctx.setLineWidth(1)
        ctx.addPath(path.cgPath)
        ctx.strokePath()

        let lamps: [UIColor] = [
            UIColor(red: 0.97, green: 0.44, blue: 0.44, alpha: 1),
            UIColor(red: 0.98, green: 0.75, blue: 0.14, alpha: 1),
            UIColor(red: 0.20, green: 0.83, blue: 0.60, alpha: 1),
        ]
        let lampR = w * 0.24
        for (i, color) in lamps.enumerated() {
            ctx.setFillColor(color.cgColor)
            let cy = body.minY + body.height * (0.22 + Double(i) * 0.28)
            ctx.fillEllipse(in: CGRect(
                x: rect.midX - lampR,
                y: cy - lampR,
                width: lampR * 2,
                height: lampR * 2
            ))
        }
    }

    private static let stopIconImage: UIImage = renderMapImage(
        size: CGSize(width: 20, height: 20)
    ) { ctx, rect in
        let radius = rect.width * 0.42
        let path = UIBezierPath()
        for i in 0..<8 {
            let angle = (Double.pi / 4) * Double(i) + Double.pi / 8
            let point = CGPoint(
                x: rect.midX + radius * cos(angle),
                y: rect.midY + radius * sin(angle)
            )
            if i == 0 { path.move(to: point) } else { path.addLine(to: point) }
        }
        path.close()
        ctx.setFillColor(UIColor(red: 0.86, green: 0.15, blue: 0.15, alpha: 1).cgColor)
        ctx.addPath(path.cgPath)
        ctx.fillPath()
        ctx.setStrokeColor(UIColor(white: 1, alpha: 0.95).cgColor)
        ctx.setLineWidth(1.4)
        ctx.addPath(path.cgPath)
        ctx.strokePath()
    }

    private static let yieldIconImage: UIImage = renderMapImage(
        size: CGSize(width: 20, height: 20)
    ) { ctx, rect in
        let path = UIBezierPath()
        path.move(to: CGPoint(x: rect.width * 0.1, y: rect.height * 0.22))
        path.addLine(to: CGPoint(x: rect.width * 0.9, y: rect.height * 0.22))
        path.addLine(to: CGPoint(x: rect.midX, y: rect.height * 0.86))
        path.close()
        ctx.setFillColor(UIColor(red: 0.99, green: 0.95, blue: 0.95, alpha: 1).cgColor)
        ctx.addPath(path.cgPath)
        ctx.fillPath()
        ctx.setStrokeColor(UIColor(red: 0.86, green: 0.15, blue: 0.15, alpha: 1).cgColor)
        ctx.setLineWidth(2.4)
        ctx.addPath(path.cgPath)
        ctx.strokePath()
    }

    private static let railIconImage: UIImage = renderMapImage(
        size: CGSize(width: 20, height: 20)
    ) { ctx, rect in
        let disc = rect.insetBy(dx: rect.width * 0.08, dy: rect.height * 0.08)
        ctx.setFillColor(UIColor(red: 0.98, green: 0.80, blue: 0.08, alpha: 1).cgColor)
        ctx.fillEllipse(in: disc)
        ctx.setStrokeColor(UIColor(red: 0.06, green: 0.09, blue: 0.16, alpha: 0.9).cgColor)
        ctx.setLineWidth(1.2)
        ctx.strokeEllipse(in: disc)
        ctx.setLineWidth(2.2)
        ctx.move(to: CGPoint(x: rect.width * 0.3, y: rect.height * 0.3))
        ctx.addLine(to: CGPoint(x: rect.width * 0.7, y: rect.height * 0.7))
        ctx.move(to: CGPoint(x: rect.width * 0.7, y: rect.height * 0.3))
        ctx.addLine(to: CGPoint(x: rect.width * 0.3, y: rect.height * 0.7))
        ctx.strokePath()
    }

    @MainActor
    private func makeWebViewClear(_ webView: UIView, clear: Bool) {
        if webViewBackground == nil {
            webViewWasOpaque = webView.isOpaque
            webViewBackground = webView.backgroundColor
            if let scroll = (webView as? UIScrollView) ?? webView.subviews.compactMap({ $0 as? UIScrollView }).first {
                scrollBackground = scroll.backgroundColor
            }
        }
        webView.isOpaque = clear ? false : webViewWasOpaque
        webView.backgroundColor = clear ? .clear : webViewBackground
        let scroll = (webView as? UIScrollView) ?? webView.subviews.compactMap({ $0 as? UIScrollView }).first
        scroll?.backgroundColor = clear ? .clear : scrollBackground
        if let wk = webView as? WKWebView {
            if scrollBackground == nil {
                scrollBackground = wk.scrollView.backgroundColor
            }
            wk.scrollView.backgroundColor = clear ? .clear : scrollBackground
        }
    }
}
