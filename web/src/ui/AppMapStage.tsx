import { lazy, Suspense, type ReactNode } from "react";
import type { DriveMapProps } from "./DriveMap";

/** Prod code-split. Normalizes named/default export so React.lazy never hits its broken `%s` log path. */
const lazyDriveMap = () =>
  import("./DriveMap").then((m) => {
    const component = m.default ?? m.DriveMap;
    if (component == null) {
      throw new Error("DriveMap failed to load (missing component export). Hard-reload the page.");
    }
    return { default: component };
  });

const DriveMap = lazy(lazyDriveMap);

if (import.meta.hot) {
  /* React.lazy caches the first import — after DriveMap HMR, reload so lazy picks up the new module. */
  import.meta.hot.accept("./DriveMap", () => {
    window.location.reload();
  });
}

export type AppMapStageProps = {
  driveMapProps: DriveMapProps;
  /** Nav chrome, hazard sheets, drawers, and bottom chrome stacked above the map canvas. */
  children?: ReactNode;
};

/** Map canvas + lazy-loaded `DriveMap`, plus whatever overlay chrome App stacks above it. */
export function AppMapStage({ driveMapProps, children }: AppMapStageProps) {
  return (
    <div className="map-stage map-bleed">
      <div className="map-canvas">
        <Suspense fallback={<div className="drive-map" />}>
          <DriveMap {...driveMapProps} />
        </Suspense>
      </div>
      {children}
    </div>
  );
}
