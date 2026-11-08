import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LandscapeDockContent, LandscapeNavigationDock } from "../LandscapeNavigationDock";
import { readAppCss } from "../../styles/appCss";

const render = () =>
  renderToStaticMarkup(createElement(LandscapeNavigationDock, {
    miles: "42 mi", bearing: 90,
    onRefresh: () => undefined, onInfo: () => undefined, onTools: () => undefined,
  }));

describe("landscape navigation dock", () => {
  it("puts miles and messages above the drive button row", () => {
    const html = render();
    // DOM order: messages → miles → controls, so buttons sit just over bottom chrome.
    // Phone landscape keeps this order (vertical stack); the iPad panel re-orders via CSS.
    expect(html.indexOf("42 mi remaining")).toBeLessThan(html.indexOf("Refresh the trip"));
    expect(html.indexOf("Refresh the trip")).toBeLessThan(html.indexOf("North indicator"));
    expect(html.indexOf("North indicator")).toBeLessThan(html.indexOf("StormPath Tools"));
    expect(html.indexOf("StormPath Tools")).toBeLessThan(html.indexOf("About StormPath"));
    expect(html).toContain('id="landscape-navigation-messages"');
    expect(html).not.toContain("nav-bottom-toolbar");
  });

  it("keeps ⓘ in the dock for every view — the iPad panel hides/re-orders via CSS", async () => {
    const html = render();
    expect(html).toContain("About StormPath");
    expect(html).toContain("StormPath Tools");
    expect(html).toContain("North indicator");
    expect(html).toContain("Refresh the trip");
    const css = await readAppCss();
    // MP/RT hides the dock ⓘ so the about row can carry it beside route select.
    expect(css).toContain(".landscape-navigation-dock__controls > .map-about-btn { order: 1; }");
    expect(css).toContain(".nav-bottom-dock__about-row\n    .nav-tools-btn");
  });

  it("preserves original content before mounting and outside active navigation", () => {
    for (const active of [false, true]) {
      expect(renderToStaticMarkup(createElement(LandscapeDockContent, {
        active, children: createElement("span", null, "Hazard ahead"),
      }))).toBe("<span>Hazard ahead</span>");
    }
  });

  it("never paints a landscape GPS message over turns while the status bar mounts", () => {
    vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
    try {
      expect(renderToStaticMarkup(createElement(LandscapeDockContent, {
        active: true, children: createElement("span", null, "GPS signal weak"),
      }))).toBe("");
      expect(renderToStaticMarkup(createElement(LandscapeDockContent, {
        active: false, children: createElement("span", null, "Planning message"),
      }))).toContain("Planning message");
    } finally { vi.unstubAllGlobals(); }
  });

  it("lets complete landscape turn instructions wrap instead of clipping them", async () => {
    const css = await readAppCss();
    const start = css.indexOf("  .app-shell.nav-fullmap .nav-top-cluster .top-guidance-bar--turn-only {");
    const sizing = css.slice(start, css.indexOf("\n.rpgl__help {", start));
    expect(sizing).toContain("min-height: min-content");
    expect(sizing).toContain(".turn-banner-street");
    expect(sizing).toContain(".turn-banner-next-instr");
    expect(sizing).toContain("font-size: clamp(0.875rem, 3.4vh, 1rem)");
    expect(sizing).toContain("line-clamp: unset");
    expect(sizing).toContain("white-space: normal");
    expect(sizing).not.toContain("overflow: hidden");
  });

  it("mirrors the control edge without altering the bottom toolbar or top guidance", async () => {
    const css = await readAppCss();
    const dock = css.slice(css.indexOf(".landscape-navigation-dock {"), css.indexOf("\n.drive-hazard-ticker {"));
    expect(dock).toContain('grid-template-areas: "messages controls" "messages miles"');
    expect(dock).toContain('grid-template-areas: "controls messages" "miles messages"');
    expect(dock).toContain("@media (orientation: landscape)");
    expect(dock).toContain(".app-shell--landscape-hand-left");
    expect(dock).toContain("env(safe-area-inset-right)");
    expect(dock).toContain("env(safe-area-inset-left)");
    expect(dock).not.toContain("nav-bottom-toolbar");
    expect(dock).not.toContain("top-guidance");
    expect(dock).not.toContain("border-left");
  });
});
