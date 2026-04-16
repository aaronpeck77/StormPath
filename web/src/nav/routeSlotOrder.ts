/**
 * A/B/C display order: index 0 = Route A (blue), 1 = B, 2 = C.
 * Underlying route ids are stable; labels permute when the user picks a different leg.
 */

/** True iff `slot` is exactly the same multiset of ids as `plan` (full A/B/C permutation). */
export function isFullSlotPermutation(slot: string[], planIds: string[]): boolean {
  if (slot.length !== planIds.length || planIds.length === 0) return false;
  if (new Set(slot).size !== slot.length) return false;
  const a = [...planIds].sort().join("\0");
  const b = [...slot].sort().join("\0");
  return a === b;
}

/** After plan change: keep prior order for ids that still exist, append new ids in plan order. */
export function reconcileSlotOrderWithPlan(prev: string[], planIds: string[]): string[] {
  if (!planIds.length) return [];
  const set = new Set(planIds);
  const kept = prev.filter((id) => set.has(id));
  const seen = new Set(kept);
  const out = [...kept];
  for (const id of planIds) {
    if (!seen.has(id)) {
      out.push(id);
      seen.add(id);
    }
  }
  return out;
}

/**
 * User chose `selectedId`. It becomes A. Apply:
 * - was already A → no change
 * - was B → swap A and B; C unchanged
 * - was C → new A = old C, new B = old A, new C = old B
 */
export function slotOrderAfterSelect(order: string[], selectedId: string): string[] {
  if (order.length < 2) return order;
  const i = order.indexOf(selectedId);
  if (i <= 0) return [...order];

  const d0 = order[0]!;
  const d1 = order[1];
  const d2 = order[2];

  if (order.length === 2) {
    if (i === 1 && d1 != null) return [d1, d0];
    return [...order];
  }

  if (d1 == null || d2 == null) return [...order];
  if (i === 1) return [d1, d0, d2];
  if (i === 2) return [d2, d0, d1];
  return [...order];
}

/** Route A is always slot 0. */
export function mainRouteIdFromSlotOrder(order: string[]): string {
  return order[0] ?? "";
}
