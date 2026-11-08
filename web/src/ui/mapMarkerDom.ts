export function makePuckEl(): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "map-user-puck";
  return el;
}

export function makeDestEl(): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "map-dest-marker";
  el.setAttribute("aria-label", "Destination");
  return el;
}

export function makeViaStopEl(): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "map-via-stop-marker";
  el.textContent = "S";
  return el;
}

export function makePoiHoverEl(): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "map-poi-hover-target";
  return el;
}

export function makeBypassHazardEl(): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "map-bypass-hazard-pin";
  wrap.setAttribute("aria-hidden", "true");
  const dot = document.createElement("span");
  dot.className = "map-bypass-hazard-pin__dot";
  dot.textContent = "!";
  const ring = document.createElement("span");
  ring.className = "map-bypass-hazard-pin__pulse";
  wrap.appendChild(ring);
  wrap.appendChild(dot);
  return wrap;
}

/** Pulsing beacon at the countdown "next" hazard — syncs the route line with the drive panel. */
export function makeNextHazardBeaconEl(color: string): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "map-next-hazard-beacon";
  wrap.setAttribute("aria-hidden", "true");
  const ring = document.createElement("span");
  ring.className = "map-next-hazard-beacon__pulse";
  ring.style.background = color;
  const dot = document.createElement("span");
  dot.className = "map-next-hazard-beacon__dot";
  dot.style.background = color;
  wrap.appendChild(ring);
  wrap.appendChild(dot);
  return wrap;
}
