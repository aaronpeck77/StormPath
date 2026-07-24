/**
 * Manual Netlify credit-balance snapshot for Control Room.
 *
 * Credit-based plans (Free = 300/mo) have no public usage API for remaining credits —
 * only the dashboard. Ops enter the number from Usage & billing → Credit balance; we
 * persist it in Blobs so every Control Room session sees the same figure.
 */

export type NetlifyCreditsSnapshot = {
  remaining: number;
  included: number;
  setAt: string;
};

const FREE_INCLUDED = 300;
const BLOB_KEY = "netlify-credits/current";

async function blobsGet(): Promise<NetlifyCreditsSnapshot | null> {
  try {
    const { getStore } = await import("@netlify/blobs");
    const store = getStore("stormpath-ops");
    const data = await store.get(BLOB_KEY, { type: "json" });
    if (
      data &&
      typeof data === "object" &&
      typeof (data as NetlifyCreditsSnapshot).remaining === "number"
    ) {
      return data as NetlifyCreditsSnapshot;
    }
  } catch (e) {
    console.error("[netlify-credits] Blobs read failed:", e);
  }
  return null;
}

async function blobsSet(snap: NetlifyCreditsSnapshot): Promise<boolean> {
  try {
    const { getStore } = await import("@netlify/blobs");
    const store = getStore("stormpath-ops");
    await store.setJSON(BLOB_KEY, snap);
    return true;
  } catch (e) {
    console.error("[netlify-credits] Blobs write failed:", e);
    return false;
  }
}

export async function readNetlifyCredits(): Promise<NetlifyCreditsSnapshot | null> {
  return blobsGet();
}

export async function setNetlifyCredits(input: {
  remaining: number;
  included?: number;
}): Promise<NetlifyCreditsSnapshot> {
  const remaining = Math.max(0, Math.floor(Number(input.remaining) || 0));
  const included = Math.max(
    remaining,
    Math.floor(Number(input.included) || FREE_INCLUDED)
  );
  const snap: NetlifyCreditsSnapshot = {
    remaining,
    included,
    setAt: new Date().toISOString(),
  };
  await blobsSet(snap);
  return snap;
}

/** Free-plan default allotment — Personal is 1000, Pro starts at 3000. */
export const NETLIFY_FREE_CREDITS = FREE_INCLUDED;
