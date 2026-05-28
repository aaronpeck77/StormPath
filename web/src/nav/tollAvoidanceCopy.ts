/** Driver-facing explanation when Mapbox cannot return a toll-free route. */
export function tollAvoidFailureExplanation(rawError: string | undefined): string {
  const raw = (rawError ?? "").trim().toLowerCase();
  if (!raw) {
    return (
      "There isn't a practical toll-free driving route for this trip. Some destinations can only " +
      "be reached via toll bridges, turnpikes, or managed lanes with no reasonable free alternative."
    );
  }
  if (
    raw.includes("noroute") ||
    raw.includes("no route") ||
    raw.includes("not find a matching") ||
    raw.includes("impossible route")
  ) {
    return (
      "Mapbox couldn't build a toll-free route between your start and destination. On this trip, " +
      "toll roads may be the only practical connection—for example a bridge, turnpike, or metro " +
      "area without a parallel free road."
    );
  }
  if (raw.includes("403") || raw.includes("forbidden")) {
    return "Routing is blocked right now (Mapbox token / URL restriction). Tolls can't be avoided until routing works again.";
  }
  if (raw.includes("401")) {
    return "Routing couldn't run (Mapbox token issue). Try again after checking your app configuration.";
  }
  if (raw.includes("timeout") || raw.includes("network")) {
    return "The toll-free reroute timed out or lost connection. Try again, or continue with the current route.";
  }
  return (
    "We couldn't replan around tolls for this trip. You can continue with the current route or choose " +
    "a different destination or stop along the way."
  );
}

/** After `exclude=toll`, Mapbox still returned toll segments on the best leg. */
export function tollFreeReplanStillHasTolls(tollLabels: string[]): string {
  const where =
    tollLabels.length > 0
      ? ` Toll segments still include ${tollLabels.slice(0, 3).join(", ")}${tollLabels.length > 3 ? ", …" : ""}.`
      : "";
  return (
    "Avoid-tolls was applied, but the best available route still uses toll roads." +
    where +
    " There may be no toll-free path for this destination."
  );
}

export type ComputeRoutesResult = { ok: true } | { ok: false; reason: string };

export function computeRoutesFailed(reason: string): Extract<ComputeRoutesResult, { ok: false }> {
  return { ok: false, reason };
}

export function computeRoutesSucceeded(): Extract<ComputeRoutesResult, { ok: true }> {
  return { ok: true };
}
