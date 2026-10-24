import Foundation
import CoreLocation
import Capacitor
import MapboxCommon
import MapboxNavigationCore
#if canImport(MapboxMaps)
import MapboxMaps
#endif

/**
 * Brain P2 — "Download this trip" + always-on home region.
 *
 * What this owns:
 *  - A TileStore corridor pack along the locked trip polyline (map + nav tiles)
 *    so the app keeps rendering and can compute routes with no bars.
 *  - A home-region pack (~homeRadiusM around the user's home anchor), refreshed
 *    on WiFi so spontaneous dead-zone starts still show a map.
 *
 * Both packs live in MapboxCommon.TileStore — on disk, survive kills/reboots.
 * Web calls these through the StormpathMapboxNavigation plugin methods:
 *   startTripPack, tripPackProgress, estimateTripPack, cancelTripPack,
 *   removeTripPack, setHomeRegion, homeRegionStatus.
 *
 * NOTE: Nav SDK 3.x APIs — verified against plugin's existing imports at
 * build time in CI. The pack ids are stable so a re-Go replaces, not stacks.
 */
final class TripOfflinePack {

    enum PackKind: String {
        case trip = "stormpath-trip-corridor"
        case home = "stormpath-home-region"
    }

    struct Progress {
        let packId: String
        let completedCount: UInt64
        let completedSize: UInt64
        let requiredResourceCount: UInt64
        var fraction: Double {
            requiredResourceCount == 0 ? 0 : Double(completedCount) / Double(requiredResourceCount)
        }
    }

    private let tileStore = TileStore.shared
    private var activeLoads: [String: TileRegionCancelable] = [:]
    private var progressHandlers: [String: (Progress) -> Void] = [:]

    // MARK: - Descriptors

    /// Navigation tiles descriptor (offline routing/rerouting inside the pack).
    /// Map tiles come from OfflineManager when the Maps SDK is linked; the nav
    /// descriptor alone still gives Core offline routing which is the P2 core.
    private func tilesetDescriptors(accessToken: String) -> [TilesetDescriptor] {
        var out: [TilesetDescriptor] = []
        // Navigation graph tiles — offline routing inside the region.
        if let nav = TilesetDescriptorFactory.getSpecificVersion(version: "latest") {
            out.append(nav)
        }
        #if canImport(MapboxMaps)
        let offlineManager = OfflineManager(resourceOptions: .init(accessToken: accessToken))
        out.append(offlineManager.createTilesetDescriptor())
        #endif
        return out
    }

    // MARK: - Trip corridor pack

    /// Download a corridor pack around a route polyline.
    /// - Parameters:
    ///   - coords: route geometry [lng,lat]
    ///   - accessToken: Mapbox token for the tileset descriptors
    ///   - progress: fraction updates for the UI
    ///   - completion: packId or error
    func startTripPack(coords: [[Double]],
                       accessToken: String,
                       progress: @escaping (Progress) -> Void,
                       completion: @escaping (Result<String, Error>) -> Void) {
        let packId = PackKind.trip.rawValue
        cancel(packId: packId)
        let points = coords.compactMap { c -> LocationCoordinate2D? in
            guard c.count >= 2 else { return nil }
            return LocationCoordinate2D(latitude: c[1], longitude: c[0])
        }
        guard points.count >= 2 else {
            completion(.failure(NSError(domain: "TripOfflinePack", code: 1,
                                        userInfo: [NSLocalizedDescriptionKey: "need at least 2 coords"])))
            return
        }
        let geometry = Geometry.lineString(LineString(points))
        let options = TileRegionLoadOptions(
            geometry: geometry,
            descriptors: tilesetDescriptors(accessToken: accessToken),
            metadata: ["kind": PackKind.trip.rawValue, "created": Date().timeIntervalSince1970],
            acceptExpired: true,
            networkRestriction: .none
        )
        let load = tileStore.loadTileRegion(
            forId: packId,
            loadOptions: options,
            progress: { p in
                progress(Progress(packId: packId,
                                  completedCount: p.completedResourceCount,
                                  completedSize: p.completedResourceSize,
                                  requiredResourceCount: p.requiredResourceCount))
            },
            completion: { [weak self] result in
                self?.activeLoads.removeValue(forKey: packId)
                self?.progressHandlers.removeValue(forKey: packId)
                completion(result.map { _ in packId })
            }
        )
        activeLoads[packId] = load
        progressHandlers[packId] = progress
    }

    /// Estimate pack size before downloading so the UI can say "~84 MB".
    func estimateTripPack(coords: [[Double]],
                          accessToken: String,
                          completion: @escaping (Result<UInt64, Error>) -> Void) {
        let points = coords.compactMap { c -> LocationCoordinate2D? in
            guard c.count >= 2 else { return nil }
            return LocationCoordinate2D(latitude: c[1], longitude: c[0])
        }
        guard points.count >= 2 else {
            completion(.failure(NSError(domain: "TripOfflinePack", code: 1,
                                        userInfo: [NSLocalizedDescriptionKey: "need at least 2 coords"])))
            return
        }
        let geometry = Geometry.lineString(LineString(points))
        tileStore.estimateTileRegion(
            forId: PackKind.trip.rawValue,
            loadOptions: TileRegionLoadOptions(
                geometry: geometry,
                descriptors: tilesetDescriptors(accessToken: accessToken),
                metadata: nil,
                acceptExpired: true,
                networkRestriction: .none
            ),
            estimateOptions: TileRegionEstimateOptions(
                errorMargin: 0.1,
                timeEstimationTimeout: 5_000,
                extraOptions: nil
            ),
            completion: { result in
                completion(result.map { $0.estimatedStorageSize })
            }
        )
    }

    // MARK: - Home region pack

    /// Download (or refresh) a bounded circle around a home anchor.
    func setHomeRegion(center: [Double],
                       radiusMeters: Double,
                       accessToken: String,
                       progress: @escaping (Progress) -> Void,
                       completion: @escaping (Result<String, Error>) -> Void) {
        let packId = PackKind.home.rawValue
        cancel(packId: packId)
        guard center.count >= 2 else {
            completion(.failure(NSError(domain: "TripOfflinePack", code: 1,
                                        userInfo: [NSLocalizedDescriptionKey: "need home center"])))
            return
        }
        let c = LocationCoordinate2D(latitude: center[1], longitude: center[0])
        // Circle polygon — TileStore regions are geometry-bounded.
        var ring: [LocationCoordinate2D] = []
        let metersPerDegLat = 111_320.0
        let dLat = radiusMeters / metersPerDegLat
        let dLng = radiusMeters / (metersPerDegLat * cos(c.latitude * .pi / 180))
        for i in 0..<48 {
            let a = Double(i) / 48.0 * 2 * .pi
            ring.append(.init(latitude: c.latitude + dLat * sin(a),
                              longitude: c.longitude + dLng * cos(a)))
        }
        ring.append(ring[0])
        let geometry = Geometry.polygon(Polygon([ring]))
        let options = TileRegionLoadOptions(
            geometry: geometry,
            descriptors: tilesetDescriptors(accessToken: accessToken),
            metadata: ["kind": PackKind.home.rawValue, "created": Date().timeIntervalSince1970],
            acceptExpired: true,
            networkRestriction: .none
        )
        let load = tileStore.loadTileRegion(
            forId: packId,
            loadOptions: options,
            progress: { p in
                progress(Progress(packId: packId,
                                  completedCount: p.completedResourceCount,
                                  completedSize: p.completedResourceSize,
                                  requiredResourceCount: p.requiredResourceCount))
            },
            completion: { [weak self] result in
                self?.activeLoads.removeValue(forKey: packId)
                self?.progressHandlers.removeValue(forKey: packId)
                completion(result.map { _ in packId })
            }
        )
        activeLoads[packId] = load
    }

    // MARK: - Lifecycle

    func cancel(packId: String) {
        activeLoads.removeValue(forKey: packId)?.cancel()
    }

    func remove(packId: String, completion: @escaping (Result<Void, Error>) -> Void) {
        cancel(packId: packId)
        tileStore.removeTileRegion(forId: packId) { result in
            completion(result.map { _ in () })
        }
    }

    /// Current on-disk state for the About sheet / diagnostics.
    func status(packId: String, completion: @escaping ([String: Any]) -> Void) {
        tileStore.tileRegion(forId: packId) { result in
            switch result {
            case .success(let region):
                completion([
                    "packId": packId,
                    "exists": true,
                    "completedResourceCount": region.completedResourceCount,
                    "completedResourceSize": region.completedResourceSize,
                    "requiredResourceCount": region.requiredResourceCount,
                    "expires": (try? region.expires?.timeIntervalSince1970) ?? 0
                ])
            case .failure:
                completion(["packId": packId, "exists": false])
            }
        }
    }
}
