import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import sharp from "sharp";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("IAP promotional images", () => {
  it("renders two distinct 1024×1024 flattened RGB PNGs", async () => {
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
  });
});
