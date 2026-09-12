import MapboxNavigationCore
import UIKit

/// Parked: `NavigationMapView` is what killed archives 379–381.
/// Pose hold / follow-cam / puck overlay still run. Drive stays on the web map.
@MainActor
final class DriveNativeMap {
    func attach(
        host _: UIView,
        webView _: UIView,
        navigation _: MapboxNavigation,
        predictiveCacheManager _: PredictiveCacheManager?,
        routes _: NavigationRoutes?
    ) {}

    func show(routes _: NavigationRoutes) {}

    func setVisible(_: Bool, webView _: UIView?) {}

    func detach(webView _: UIView?) {}
}
