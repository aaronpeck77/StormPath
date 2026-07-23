/**
 * Netlify Blobs only auto-configures itself for Functions API v2 (`export default`) and Edge
 * Functions. These functions use the older `export const handler = ...` style — "Lambda
 * compatibility mode" — on purpose, so `home-api/server.ts` can invoke the exact same handler
 * on a plain Node server. Blobs docs: call `connectLambda(event)` immediately before `getStore`
 * in that mode, or every store call throws MissingBlobsEnvironmentError.
 *
 * Home-api invokes these handlers with a hand-built event object, not a real Lambda event —
 * `connectLambda` will fail there, which is fine: home-api never had Blobs and already falls
 * back to its own writable JSON file store.
 */
export async function connectBlobsIfLambda(event: unknown): Promise<void> {
  try {
    const { connectLambda } = await import("@netlify/blobs");
    connectLambda(event as Parameters<typeof connectLambda>[0]);
  } catch {
    /* not a real Netlify Lambda invocation (e.g. home-api) — store falls back to file storage */
  }
}
