/**
 * Public marketing / legal site on Netlify (static pages from `web/public/`).
 * Site name in Netlify dashboard: **stormpath2** → https://stormpath2.netlify.app
 *
 * Deploy: double-click `web/BUILD_FOR_NETLIFY.bat`, drag output folder to Netlify Deploys.
 * See `docs/NETLIFY_HOSTING.md`.
 */
export const STORMPATH_NETLIFY_SITE_NAME = "stormpath2";

export const STORMPATH_PUBLIC_SITE_ORIGIN = `https://${STORMPATH_NETLIFY_SITE_NAME}.netlify.app`;

export function publicSiteUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${STORMPATH_PUBLIC_SITE_ORIGIN}${p}`;
}

export const STORMPATH_PUBLIC_PRIVACY_URL = publicSiteUrl("/privacy.html");
export const STORMPATH_PUBLIC_TERMS_URL = publicSiteUrl("/terms.html");
export const STORMPATH_PUBLIC_SUPPORT_URL = publicSiteUrl("/support.html");
