import Foundation
import MapboxDirections
import MapboxNavigationCore

/// Look-ahead from Mapbox Electronic Horizon: the current edge's posted limit,
/// and incident road objects on the most probable path.
struct HorizonSnapshot {
    var limitMph: Double?
    var hazards: [[String: Any]]
}

enum HorizonAhead {
    /// About 6 miles. Far enough to see work zones the last route call missed.
    static let horizonLengthM: Double = 10_000

    static func snapshot(
        event: EHorizonStatus.Events.PositionUpdated,
        graph: RoadGraph
    ) -> HorizonSnapshot {
        HorizonSnapshot(
            limitMph: limitMph(event: event, graph: graph),
            hazards: hazards(from: event.distances)
        )
    }

    private static func limitMph(
        event: EHorizonStatus.Events.PositionUpdated,
        graph: RoadGraph
    ) -> Double? {
        let startMeta = graph.edgeMetadata(edgeIdentifier: event.startingEdge.identifier)
        if let mph = mph(from: startMeta) {
            return mph
        }
        let startNames = roadNames(startMeta)
        guard !startNames.isEmpty else { return nil }

        var edge = event.startingEdge
        var walked = remainingLength(meta: startMeta, fraction: event.position.fractionFromStart)
        var steps = 0
        while steps < 8, walked <= 300 {
            steps += 1
            guard let next = nextEdge(edge) else { return nil }
            let meta = graph.edgeMetadata(edgeIdentifier: next.identifier)
            let names = roadNames(meta)
            if names.isEmpty || names.isDisjoint(with: startNames) {
                return nil
            }
            if let mph = mph(from: meta) {
                return mph
            }
            walked += meta?.length ?? 0
            edge = next
        }
        return nil
    }

    /// The SDK stores the graph limit in km/h. Unlimited is infinity — leave that blank.
    private static func mph(from meta: RoadGraph.Edge.Metadata?) -> Double? {
        guard let limit = meta?.speedLimit else { return nil }
        let mph = limit.converted(to: UnitSpeed.milesPerHour).value
        guard mph.isFinite, mph >= 10, mph <= 95 else { return nil }
        return mph.rounded()
    }

    private static func roadNames(_ meta: RoadGraph.Edge.Metadata?) -> Set<String> {
        guard let meta else { return [] }
        return Set(meta.names.map { $0.text.lowercased() }.filter { !$0.isEmpty })
    }

    private static func remainingLength(
        meta: RoadGraph.Edge.Metadata?,
        fraction: Double
    ) -> Double {
        let length = meta?.length ?? 0
        let traveled = length * min(1, max(0, fraction))
        return max(0, length - traveled)
    }

    private static func nextEdge(_ edge: RoadGraph.Edge) -> RoadGraph.Edge? {
        let mpp = edge.outletEdges.filter { $0.level == 0 }
        let pool = mpp.isEmpty ? edge.outletEdges : mpp
        return pool.max(by: { $0.probability < $1.probability })
    }

    private static func hazards(from distances: [DistancedRoadObject]) -> [[String: Any]] {
        var rows: [(meters: Double, kind: String, text: String, id: String)] = []
        var seen = Set<String>()
        for item in distances {
            guard case .incident(let incident) = item.kind else { continue }
            let id = item.identifier
            if seen.contains(id) { continue }
            guard let meters = aheadMeters(item), meters >= 0, meters <= horizonLengthM else { continue }
            guard let label = hazardLabel(incident) else { continue }
            seen.insert(id)
            rows.append((meters, label.kind, label.text, id))
        }
        rows.sort { $0.meters < $1.meters }
        return rows.prefix(4).map { row in
            [
                "kind": row.kind,
                "text": row.text,
                "distanceM": row.meters,
            ]
        }
    }

    private static func aheadMeters(_ item: DistancedRoadObject) -> Double? {
        switch item {
        case .point(_, _, let distance), .gantry(_, _, let distance):
            return distance
        case .line(_, _, let distanceToEntry, _, _, _, _):
            return max(0, distanceToEntry)
        case .polygon(_, _, let entry, _, let inside),
             .subgraph(_, _, let entry, _, let inside):
            if inside { return 0 }
            return entry
        }
    }

    private static func hazardLabel(_ incident: Incident?) -> (kind: String, text: String)? {
        guard let incident, let kind = incident.kind else { return nil }
        let title: String
        let key: String
        switch kind {
        case .construction:
            title = "Construction"
            key = "construction"
        case .laneRestriction:
            title = "Lane closed"
            key = "lane_restriction"
        case .roadClosure:
            title = "Road closed"
            key = "road_closure"
        case .accident:
            title = "Crash"
            key = "accident"
        case .congestion:
            title = "Congestion"
            key = "congestion"
        case .roadHazard:
            title = "Road hazard"
            key = "road_hazard"
        case .disabledVehicle:
            title = "Stopped vehicle"
            key = "disabled_vehicle"
        case .weather:
            title = "Weather on the road"
            key = "weather"
        case .plannedEvent:
            title = "Planned road work"
            key = "planned_event"
        case .massTransit, .miscellaneous, .otherNews, .undefined:
            return nil
        }
        return (key, line(title: title, incident: incident))
    }

    private static func line(title: String, incident: Incident) -> String {
        var text = title
        if incident.roadIsClosed == true, incident.kind != .roadClosure {
            text += ", road closed"
        }
        let detail = incident.description
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if detail.isEmpty || detail.compare(title, options: .caseInsensitive) == .orderedSame {
            return text
        }
        let clipped = detail.count > 72 ? String(detail.prefix(69)) + "…" : detail
        return "\(text): \(clipped)"
    }
}
