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
    private func applyStormPathStyle(on map: NavigationMapView) {
        styleReady = false
        let uri = StyleURI(rawValue: "mapbox://styles/mapbox/streets-v12") ?? .streets
        map.mapView.mapboxMap.loadStyle(uri) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                self.styleReady = true
                /* Pitch before first progress tick so the hole never flashes flat 2D. */
                var boot = CameraOptions()
                boot.pitch = 64
                map.mapView.mapboxMap.setCamera(to: boot)
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
        guard let style = mapView.mapView.mapboxMap else { return }
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

    /// Match `.map-user-puck` / `--driving`: 22px blue sphere, white ring, soft shadow.
    /// Do not use `makeDefault(showBearing:)` — that adds Mapbox's large flat bearing disc.
    private static func stormpathPuck2D() -> Puck2DConfiguration {
        var config = Puck2DConfiguration(
            topImage: stormpathPuckDotImage(),
            bearingImage: nil,
            shadowImage: nil,
            scale: .constant(1.0),
            showsAccuracyRing: false
        )
        config.opacity = 1
        return config
    }

    /// Bakes the web CSS look (radial highlight + ring + drop shadow) into one image.
    private static func stormpathPuckDotImage() -> UIImage {
        let scale = UIScreen.main.scale
        /* 22pt disc + room for the CSS-like shadow so Mapbox does not upscale a tiny bitmap. */
        let canvasPt: CGFloat = 32
        let discPt: CGFloat = 22
        let px = canvasPt * scale
        let discPx = discPt * scale
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: px, height: px))
        return renderer.image { ctx in
            let cg = ctx.cgContext
            let center = CGPoint(x: px / 2, y: px / 2 - 0.5 * scale)
            let radius = discPx / 2

            /* Soft drop shadow (0 3px 8px rgba(0,0,0,0.4)) */
            cg.saveGState()
            cg.setShadow(
                offset: CGSize(width: 0, height: 2.5 * scale),
                blur: 5 * scale,
                color: UIColor(white: 0, alpha: 0.4).cgColor
            )
            cg.setFillColor(UIColor.black.cgColor)
            cg.fillEllipse(in: CGRect(
                x: center.x - radius,
                y: center.y - radius,
                width: discPx,
                height: discPx
            ))
            cg.restoreGState()

            /* White ring (3px border) */
            let ring = UIBezierPath(
                ovalIn: CGRect(x: center.x - radius, y: center.y - radius, width: discPx, height: discPx)
            )
            UIColor.white.setFill()
            ring.fill()

            /* Inner disc — radial like #6bb8ff → #1a73e8 → #0a3d91 */
            let inset = 3 * scale
            let innerRect = CGRect(
                x: center.x - radius + inset,
                y: center.y - radius + inset,
                width: discPx - inset * 2,
                height: discPx - inset * 2
            )
            let colors = [
                UIColor(red: 107 / 255, green: 184 / 255, blue: 255 / 255, alpha: 1).cgColor,
                UIColor(red: 26 / 255, green: 115 / 255, blue: 232 / 255, alpha: 1).cgColor,
                UIColor(red: 10 / 255, green: 61 / 255, blue: 145 / 255, alpha: 1).cgColor,
            ] as CFArray
            if let gradient = CGGradient(
                colorsSpace: CGColorSpaceCreateDeviceRGB(),
                colors: colors,
                locations: [0, 0.42, 1]
            ) {
                cg.saveGState()
                cg.addEllipse(in: innerRect)
                cg.clip()
                let highlight = CGPoint(
                    x: innerRect.minX + innerRect.width * 0.32,
                    y: innerRect.minY + innerRect.height * 0.26
                )
                cg.drawRadialGradient(
                    gradient,
                    startCenter: highlight,
                    startRadius: 0,
                    endCenter: CGPoint(x: innerRect.midX, y: innerRect.midY),
                    endRadius: innerRect.width * 0.72,
                    options: [.drawsAfterEndLocation]
                )
                cg.restoreGState()
            }

            /* Specular rim */
            cg.saveGState()
            cg.setFillColor(UIColor(white: 1, alpha: 0.35).cgColor)
            let gloss = CGRect(
                x: innerRect.minX + innerRect.width * 0.18,
                y: innerRect.minY + innerRect.height * 0.12,
                width: innerRect.width * 0.45,
                height: innerRect.height * 0.28
            )
            cg.fillEllipse(in: gloss)
            cg.restoreGState()
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
