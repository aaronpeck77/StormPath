import { useRouteCompareStore } from "../state/routeCompareStore";
import { TollRouteSheet } from "./TollRouteSheet";

interface Props {
  avoidFailureNote: string | null;
  busy: boolean;
  onContinue: () => void;
  onPreview: () => void;
}

/**
 * App-level wrapper around `TollRouteSheet` that subscribes to `routeCompareStore` for
 * `tollRoutePrompt` directly, so `App.tsx` no longer has to deref `tollRoutePrompt?.X` at the
 * render site. Phase 4e2.
 *
 * **Behavior preserved exactly:**
 *  - The sheet renders open whenever `tollRoutePrompt` is non-null, closed otherwise — same
 *    as the prior `<TollRouteSheet open={Boolean(tollRoutePrompt)} … />` gate.
 *  - `tollLabels` falls back to `[]` when no prompt is active (matches the prior `?? []`).
 *
 * **Why a wrapper instead of moving subscription into `TollRouteSheet` itself:** the underlying
 * `TollRouteSheet` is a stateless UI primitive that's also used in tests / Storybook-style
 * isolation. Keeping the store coupling in this wrapper lets the primitive stay generic.
 */
export function TollFlowSheets({ avoidFailureNote, busy, onContinue, onPreview }: Props) {
  const tollRoutePrompt = useRouteCompareStore((s) => s.tollRoutePrompt);

  return (
    <TollRouteSheet
      open={Boolean(tollRoutePrompt)}
      tollLabels={tollRoutePrompt?.labels ?? []}
      avoidFailureNote={avoidFailureNote}
      busy={busy}
      onContinue={onContinue}
      onPreview={onPreview}
    />
  );
}
