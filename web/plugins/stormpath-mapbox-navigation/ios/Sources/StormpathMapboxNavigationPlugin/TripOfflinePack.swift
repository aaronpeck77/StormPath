import Foundation
import CoreLocation
import Capacitor
import MapboxCommon
import MapboxNavigationCore
import Turf
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
 *   startTripPack, tripPackStatus, estimateTripPack, cancelTripPack,
 *   removeTripPack, setHomeRegion, homeRegionStatus.
 *
 * Nav tiles for offline routing come from Core's PredictiveCacheConfig along
 * the corridor (already wired in makeCoreConfig) — this pack's job is the
 * map tiles + region retention, which is what the dead-zone park trip lacked.
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

    /// Same TileStore the rest of the SDK uses (Maps SDK shared default, on disk).
    private var tileStore: TileStore { TileStore.default }
    private var activeLoads: [String: Cancelable] = [:]

    // MARK: - Descriptors

    /// Map tileset descriptor from the Maps SDK offline manager. The nav graph
    /// along the corridor is already warmed by Core's PredictiveCacheConfig,
    /// so no separate nav descriptor is needed here.
    private func tilesetDescriptors(accessToken: String) -> [TilesetDescriptor] {
        #if canImport(MapboxMaps)
        let opts = TilesetDescriptorOptions(styleURI: .streets, zoomRange: 0...16, tilesets: nil)
        return [OfflineManager().createTilesetDescriptor(for: opts)]
        #else
        return []
        #endif
    }

    private func packError(_ code: Int, _ msg: String) -> NSError {
        NSError(domain: "TripOfflinePack", code: code, userInfo: [NSLocalizedDescriptionKey: msg])
    }

    // MARK: - Trip corridor pack

    /// Download a corridor pack around a route polyline.
    /// - Parameters:
    ///   - coords: route geometry [lng,lat]
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
            completion(.failure(packError(1, "need at least 2 coords")))
            return
        }
        let geometry = Geometry.lineString(LineString(points))
        guard let options = TileRegionLoadOptions(
            geometry: geometry,
            descriptors: tilesetDescriptors(accessToken: accessToken),
            metadata: ["kind": PackKind.trip.rawValue, "created": Date().timeIntervalSince1970],
            acceptExpired: true,
            networkRestriction: .none
        ) else {
            completion(.failure(packError(2, "could not build tile region options")))
            return
        }
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
                switch result {
                case .success: completion(.success(packId))
                case .failure(let e): completion(.failure(e))
                }
            }
        )
        activeLoads[packId] = load
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
            completion(.failure(packError(1, "need at least 2 coords")))
            return
        }
        let geometry = Geometry.lineString(LineString(points))
        guard let options = TileRegionLoadOptions(
            geometry: geometry,
            descriptors: tilesetDescriptors(accessToken: accessToken),
            metadata: nil,
            acceptExpired: true,
            networkRestriction: .none
        ) else {
            completion(.failure(packError(2, "could not build tile region options")))
            return
        }
        tileStore.estimateTileRegion(
            forId: PackKind.trip.rawValue,
            loadOptions: options,
            estimateOptions: TileRegionEstimateOptions(preciseEstimationTimeout: 5, timeout: 0),
            progress: { _ in },
            completion: { result in
                switch result {
                case .success(let est): completion(.success(est.storageSize))
                case .failure(let e): completion(.failure(e))
                }
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
            completion(.failure(packError(1, "need home center")))
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
        guard let options = TileRegionLoadOptions(
            geometry: geometry,
            descriptors: tilesetDescriptors(accessToken: accessToken),
            metadata: ["kind": PackKind.home.rawValue, "created": Date().timeIntervalSince1970],
            acceptExpired: true,
            networkRestriction: .none
        ) else {
            completion(.failure(packError(2, "could not build tile region options")))
            return
        }
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
                switch result {
                case .success: completion(.success(packId))
                case .failure(let e): completion(.failure(e))
                }
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
        tileStore.removeTileRegion(forId: packId)
        completion(.success(()))
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
                    "requiredResourceCount": region.requiredResourceCount
                ])
            case .failure:
                completion(["packId": packId, "exists": false])
            }
        }
    }
}
