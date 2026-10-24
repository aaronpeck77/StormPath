import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { describe, expect, it } from "vitest";
import sharp from "sharp";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("IAP promotional images", () => {
  it("renders two distinct 1024×1024 flattened RGB PNGs that are not the app icon", async () => {
    execFileSync("node", ["scripts/render-iap-promo.mjs"], { cwd: webRoot, stdio: "pipe" });
    const monthly = path.join(webRoot, "assets/store/stormpath-plus-promo-monthly.png");
    const yearly = path.join(webRoot, "assets/store/stormpath-plus-promo-yearly.png");
    const a = fs.readFileSync(monthly);
    const b = fs.readFileSync(yearly);
    expect(a.equals(b)).toBe(false);
    for (const buf of [a, b]) {
      const meta = await sharp(buf).metadata();
      expect(meta.width).toBe(1024);
      expect(meta.height).toBe(1024);
      expect(meta.format).toBe("png");
      expect(meta.hasAlpha).toBe(false);
    }

    const iconSvg = fs.readFileSync(path.join(webRoot, "assets/stormpath-app-icon.svg"));
    const iconPng = new Resvg(iconSvg, { fitTo: { mode: "width", value: 1024 } }).render().asPng();
    const icon = await sharp(iconPng)
      .resize(1024, 1024, { fit: "fill" })
      .flatten({ background: "#5EB8E8" })
      .png()
      .toBuffer();
    expect(a.equals(icon)).toBe(false);
    expect(b.equals(icon)).toBe(false);
  });
});
