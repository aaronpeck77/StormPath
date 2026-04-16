/**
 * Fixed widget: dial rotates so the arrow points toward geographic north on the map
 * (map bearing from Mapbox — east-up = 90°).
 */
export function DriveCompass({ bearingDeg }: { bearingDeg: number | null }) {
  const rot =
    bearingDeg != null && Number.isFinite(bearingDeg) ? -bearingDeg : 0;

  return (
    <div
      className="drive-compass"
      role="img"
      aria-label={
        bearingDeg != null && Number.isFinite(bearingDeg)
          ? `North indicator, map rotated ${Math.round(bearingDeg)} degrees`
          : "North indicator"
      }
    >
      <div className="drive-compass__dial" style={{ transform: `rotate(${rot}deg)` }}>
        <span className="drive-compass__needle" aria-hidden />
      </div>
    </div>
  );
}
