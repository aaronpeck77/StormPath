import Combine
import CoreLocation
import MapboxMaps
import MapboxNavigationCore
import UIKit
import WebKit

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

    @MainActor
    func attach(
        host: UIView,
        webView: UIView,
        navigation: MapboxNavigation,
        predictiveCacheManager: PredictiveCacheManager?,
        routes: NavigationRoutes?
    ) {
        lastRoutes = routes ?? lastRoutes
        hostedWebView = webView
        if mapView == nil {
            let nav = navigation.navigation()
            let map = NavigationMapView(
                location: nav.locationMatching.map(\.enhancedLocation).eraseToAnyPublisher(),
                routeProgress: nav.routeProgress.map(\.?.routeProgress).eraseToAnyPublisher(),
                predictiveCacheManager: predictiveCacheManager
            )
            map.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            map.frame = host.bounds
            map.puckType = .puck2D(Self.stormpathPuck2D())
            map.puckBearing = .course
            map.showsAlternatives = false
            map.showsRelativeDurationsOnAlternativeManuever = false
            map.navigationCamera.stop()
            map.isHidden = true
            host.insertSubview(map, belowSubview: webView)
            mapView = map
            applyStormPathStyle(on: map)
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
        mapView?.show(routes, routeAnnotationKinds: [])
    }

    @MainActor
    func applyFollowCamera(_ sample: DriveFollowCameraSample) {
        lastFollowSample = sample
        guard styleReady else { return }
        writeFollowCamera(sample)
        revealIfFramed()
    }

    @MainActor
    func setVisible(_ visible: Bool, webView: UIView?) {
        if !visible {
            revealedThroughWebView = false
            mapView?.isHidden = true
            if let webView {
                makeWebViewClear(webView, clear: false)
            }
            return
        }
        hostedWebView = webView ?? hostedWebView
        /* Stay hidden until applyFollowCamera frames the puck. */
        if revealedThroughWebView {
            mapView?.isHidden = false
            if let hostedWebView {
                makeWebViewClear(hostedWebView, clear: true)
            }
        }
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
    private func applyStormPathStyle(on map: NavigationMapView) {
        styleReady = false
        let uri = StyleURI(rawValue: "mapbox://styles/mapbox/streets-v12") ?? .streets
        map.mapView.mapboxMap.loadStyle(uri) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                self.styleReady = true
                if let routes = self.lastRoutes {
                    self.mapView?.show(routes, routeAnnotationKinds: [])
                }
                if let sample = self.lastFollowSample {
                    self.writeFollowCamera(sample)
                    self.revealIfFramed()
                }
                self.addStormPathBuildings()
            }
        }
    }

    @MainActor
    private func addStormPathBuildings() {
        guard let mapView else { return }
        let style = mapView.mapView.mapboxMap
        let layerId = "stormpath-3d-buildings"
        if style.layerExists(withId: layerId) { return }
        do {
            var buildings = FillExtrusionLayer(id: layerId, source: "composite")
            buildings.sourceLayer = "building"
            buildings.minZoom = 13
            buildings.filter = Exp(.eq) {
                Exp(.get) { "extrude" }
                "true"
            }
            buildings.fillExtrusionColor = .constant(StyleColor(UIColor(white: 0.78, alpha: 1)))
            buildings.fillExtrusionHeight = .expression(Exp(.get) { "height" })
            buildings.fillExtrusionBase = .expression(Exp(.get) { "min_height" })
            buildings.fillExtrusionOpacity = .constant(0.8)
            try style.addLayer(buildings)
        } catch {
            /* streets-v12 may already extrude buildings; pitch is what makes them read 3D. */
        }
    }

    /// StormPath web puck: blue circle, white ring — not the SDK 3D triangle.
    private static func stormpathPuck2D() -> Puck2DConfiguration {
        var config = Puck2DConfiguration.makeDefault(showBearing: true)
        config.topImage = stormpathPuckDotImage(size: 22)
        config.opacity = 1
        return config
    }

    private static func stormpathPuckDotImage(size: CGFloat) -> UIImage {
        let scale = UIScreen.main.scale
        let px = size * scale
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: px, height: px))
        return renderer.image { ctx in
            let rect = CGRect(x: 0, y: 0, width: px, height: px).insetBy(dx: scale, dy: scale)
            let ring = UIBezierPath(ovalIn: rect)
            UIColor.white.setFill()
            ring.fill()
            let inner = rect.insetBy(dx: 3 * scale, dy: 3 * scale)
            let dot = UIBezierPath(ovalIn: inner)
            UIColor(red: 26 / 255, green: 115 / 255, blue: 232 / 255, alpha: 1).setFill()
            dot.fill()
        }
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
