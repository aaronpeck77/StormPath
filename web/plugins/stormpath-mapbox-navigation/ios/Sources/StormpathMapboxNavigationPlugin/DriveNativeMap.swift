import Combine
import MapboxNavigationCore
import UIKit
import WebKit

/// Native NavigationMapView under the Capacitor WebView — map / route / puck / follow-cam.
@MainActor
final class DriveNativeMap {
    private var mapView: NavigationMapView?
    private var lastRoutes: NavigationRoutes?
    private var webViewWasOpaque = true
    private var webViewBackground: UIColor?
    private var scrollBackground: UIColor?

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
        mapView?.update(navigationCameraState: .following)
    }

    func show(routes: NavigationRoutes) {
        lastRoutes = routes
        guard let mapView, !mapView.isHidden else { return }
        mapView.show(routes, routeAnnotationKinds: [])
        mapView.update(navigationCameraState: .following)
    }

    func setVisible(_ visible: Bool, webView: UIView?) {
        mapView?.isHidden = !visible
        if let webView {
            makeWebViewClear(webView, clear: visible)
        }
        if visible {
            mapView?.update(navigationCameraState: .following)
        }
    }

    func detach(webView: UIView?) {
        if let webView {
            makeWebViewClear(webView, clear: false)
        }
        mapView?.removeFromSuperview()
        mapView = nil
        lastRoutes = nil
    }

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
