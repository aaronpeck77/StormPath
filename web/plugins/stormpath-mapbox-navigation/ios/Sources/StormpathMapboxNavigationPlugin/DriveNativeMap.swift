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
            }
        }
    }

    @MainActor
    private func applyStormPathPuck(on map: NavigationMapView) {
        /* Built-in Nav SDK 3D chevron (not the flat blue 2D disc). Re-apply after style load. */
        map.puckType = .puck3D(.navigationDefault)
        map.puckBearing = .course
        map.mapView.location.options.puckBearingEnabled = true
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
