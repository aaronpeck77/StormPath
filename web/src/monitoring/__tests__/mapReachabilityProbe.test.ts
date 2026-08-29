import { describe, expect, it, vi } from "vitest";
import { probeMapReachability } from "../mapReachabilityProbe";

describe("probeMapReachability", () => {
  it("returns false without calling the network when the browser is offline", async () => {
    const fetchImpl = vi.fn();
    await expect(
      probeMapReachability({ navigatorOnLine: false, fetchImpl: fetchImpl as unknown as typeof fetch })
    ).resolves.toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("treats any fetch resolve as reachable (incl. opaque no-cors / 401)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    await expect(
      probeMapReachability({ navigatorOnLine: true, fetchImpl: fetchImpl as unknown as typeof fetch })
    ).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ mode: "no-cors" })
    );
  });

  it("treats a network / timeout throw as unreachable", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError"));
    await expect(
      probeMapReachability({ navigatorOnLine: true, fetchImpl: fetchImpl as unknown as typeof fetch })
    ).resolves.toBe(false);
  });
});
