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
    private var webViewWasOpaque = true
    private var webViewBackground: UIColor?
    private var scrollBackground: UIColor?

    @MainActor
    func attach(
        host: UIView,
        webView: UIView,
        navigation: MapboxNavigation,
        predictiveCacheManager: PredictiveCacheManager?,
        routes: NavigationRoutes?
    ) {
        lastRoutes = routes ?? lastRoutes
        if mapView == nil {
            let nav = navigation.navigation()
            let map = NavigationMapView(
                location: nav.locationMatching.map(\.enhancedLocation).eraseToAnyPublisher(),
                routeProgress: nav.routeProgress.map(\.?.routeProgress).eraseToAnyPublisher(),
                predictiveCacheManager: predictiveCacheManager
            )
            map.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            map.frame = host.bounds
            map.puckType = .puck3D(.navigationDefault)
            map.puckBearing = .course
            map.showsAlternatives = false
            map.showsRelativeDurationsOnAlternativeManuever = false
            host.insertSubview(map, belowSubview: webView)
            mapView = map
        }
        mapView?.isHidden = false
        makeWebViewClear(webView, clear: true)
        if let lastRoutes {
            mapView?.show(lastRoutes, routeAnnotationKinds: [])
        }
        mapView?.navigationCamera.stop()
    }

    @MainActor
    func show(routes: NavigationRoutes) {
        lastRoutes = routes
        guard let mapView, !mapView.isHidden else { return }
        mapView.show(routes, routeAnnotationKinds: [])
    }

    @MainActor
    func applyFollowCamera(_ sample: DriveFollowCameraSample) {
        guard let mapView, !mapView.isHidden else { return }
        mapView.navigationCamera.stop()
        let height = mapView.bounds.height
        let bottomPad = height > 1 ? height * 0.32 : 180
        let options = CameraOptions(
            center: CLLocationCoordinate2D(latitude: sample.lat, longitude: sample.lng),
            padding: UIEdgeInsets(top: 0, left: 0, bottom: bottomPad, right: 0),
            zoom: sample.zoom,
            bearing: sample.bearing,
            pitch: sample.pitch
        )
        mapView.mapView.mapboxMap.setCamera(to: options)
    }

    @MainActor
    func setVisible(_ visible: Bool, webView: UIView?) {
        mapView?.isHidden = !visible
        if let webView {
            makeWebViewClear(webView, clear: visible)
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
    }

    @MainActor
    var isShowing: Bool {
        guard let mapView else { return false }
        return !mapView.isHidden
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
