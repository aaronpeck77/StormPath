/** Semver from `package.json`, injected at Vite build time as {@link __APP_VERSION__}. */
export const STORMPATH_APP_VERSION = __APP_VERSION__;

/** iOS/TestFlight build number — set in CI as `VITE_IOS_BUILD_NUMBER` (matches GitHub run #). */
export function stormpathIosBuildNumber(): string | null {
  const raw = (import.meta.env.VITE_IOS_BUILD_NUMBER as string | undefined)?.trim();
  return raw || null;
}

/**
 * Human label for About, support email, and console — aligns with TestFlight when built on CI.
 * Examples: `1.0.1 (build 112)`, `1.0.1 · dev`.
 */
export function stormpathVersionLabel(opts?: { dev?: boolean }): string {
  const dev = opts?.dev ?? import.meta.env.DEV;
  const build = stormpathIosBuildNumber();
  if (dev) return `${STORMPATH_APP_VERSION} · dev`;
  if (build) return `${STORMPATH_APP_VERSION} (build ${build})`;
  return STORMPATH_APP_VERSION;
}

/** Short chip text for the About header. */
export function stormpathVersionChipLabel(opts?: { dev?: boolean }): string {
  const dev = opts?.dev ?? import.meta.env.DEV;
  const build = stormpathIosBuildNumber();
  if (dev) return `v${STORMPATH_APP_VERSION} · dev`;
  if (build) return `v${STORMPATH_APP_VERSION} · build ${build}`;
  return `v${STORMPATH_APP_VERSION}`;
}

/** Sentry release string — version + build when available. */
export function stormpathSentryRelease(): string {
  const build = stormpathIosBuildNumber();
  return build ? `stormpath@${STORMPATH_APP_VERSION}+${build}` : `stormpath@${STORMPATH_APP_VERSION}`;
}
