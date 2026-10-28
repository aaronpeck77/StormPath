import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LandscapeDockContent, LandscapeNavigationDock } from "../LandscapeNavigationDock";

const render = () => renderToStaticMarkup(createElement(LandscapeNavigationDock, {
  miles: "42 mi", bearing: 90, onRefresh: () => undefined, onInfo: () => undefined,
}));

describe("landscape navigation dock", () => {
  it("stacks refresh, compass and info above a separate miles cell", () => {
    const html = render();
    expect(html.indexOf("Refresh the trip")).toBeLessThan(html.indexOf("North indicator"));
    expect(html.indexOf("North indicator")).toBeLessThan(html.indexOf("About StormPath"));
    expect(html.indexOf("About StormPath")).toBeLessThan(html.indexOf("42 mi remaining"));
    expect(html).toContain('id="landscape-navigation-messages"');
    expect(html).not.toContain("nav-bottom-toolbar");
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

  it("mirrors the control edge without altering the bottom toolbar or top guidance", async () => {
    const fsModule = "node:fs";
    const { readFileSync } = await import(fsModule);
    const css: string = readFileSync(new URL("../../App.css", import.meta.url), "utf8");
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
