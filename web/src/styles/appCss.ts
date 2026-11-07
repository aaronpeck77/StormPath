/**
 * Test/dev helper — returns App.css content with its `@import "./styles/…"`
 * manifest inlined in order, i.e. the same concatenated text the pre-split
 * monolith produced. Use this instead of reading `App.css` directly when a
 * test asserts on raw CSS rules.
 *
 * Node builtins are pulled in via non-literal `import()` specifiers (same
 * trick as `LandscapeNavigationDock.test.ts`) so this file type-checks
 * without `@types/node` — the app tsconfig intentionally excludes node types.
 */
export async function readAppCss(): Promise<string> {
  const fsModule = "node:fs";
  const pathModule = "node:path";
  const urlModule = "node:url";
  const { readFileSync } = await import(fsModule);
  const { dirname, resolve } = await import(pathModule);
  const { fileURLToPath } = await import(urlModule);

  const here = dirname(fileURLToPath(import.meta.url));
  const appCssPath = resolve(here, "../App.css");
  const manifest = readFileSync(appCssPath, "utf8");
  const importRe = /@import\s+"([^"]+)"\s*;/g;
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(manifest)) !== null) {
    out += manifest.slice(last, m.index);
    out += readFileSync(resolve(dirname(appCssPath), m[1]!), "utf8");
    last = m.index + m[0].length;
  }
  out += manifest.slice(last);
  return out;
}
