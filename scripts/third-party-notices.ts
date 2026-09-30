/**
 * Generates THIRD_PARTY_NOTICES.txt: the license texts of every third-party package that ships in
 * PWR (server runtime, `pwr`/`pwr-agent` binaries, Studio and Admin bundles), resolved from the
 * installed dependency tree. Usage: `bun run notices` writes it; `bun run notices:check` fails
 * when it is stale (CI and release). Output is deterministic: no dates, sorted by package.
 */
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");
const OUTPUT = join(ROOT, "THIRD_PARTY_NOTICES.txt");
const SHIPPED = ["apps/server", "apps/agent", "apps/cli", "apps/studio", "apps/admin"];
// Frontend builds bundle some devDependencies too (UI kit, class helpers, Tailwind's CSS).
const BUNDLES_DEV_DEPENDENCIES = new Set(["apps/studio", "apps/admin", "packages/ui"]);
// Compilers, bundlers and type packages run at build time; none of their code ships.
const BUILD_ONLY =
  /^(typescript|vite|vite-plugin-solid|@tailwindcss\/vite|drizzle-kit|esbuild|@esbuild\/.+|bun-types|@types\/.+)$/;
const LICENSE_FILE = /^(licen[cs]e|copying|notice)([.-].*)?$/i;
// Canonical SPDX texts for packages that ship no license file of their own.
const STANDARD_TEXTS = join(import.meta.dir, "licenses");
const RULE = "=".repeat(80);

type Package = { name: string; version: string; license: string; source: string; texts: string[] };

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null && key in value ? Reflect.get(value, key) : undefined;
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const keys = (value: unknown): string[] =>
  typeof value === "object" && value !== null ? Object.keys(value) : [];
const readManifest = (dir: string): unknown =>
  JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));

/** SPDX expression from `license`, or the legacy `licenses` array. */
const licenseOf = (manifest: unknown): string => {
  const license = field(manifest, "license");
  if (typeof license === "string") return license;
  if (text(field(license, "type"))) return text(field(license, "type"));
  const legacy = field(manifest, "licenses");
  const types = Array.isArray(legacy) ? legacy.map((l) => text(field(l, "type"))) : [];
  return types.filter(Boolean).join(" OR ") || "UNKNOWN";
};

/** Browsable source URL from `repository` (string or object) or `homepage`. */
const sourceOf = (manifest: unknown): string => {
  const repository = field(manifest, "repository");
  const url =
    text(repository) || text(field(repository, "url")) || text(field(manifest, "homepage"));
  return url
    .replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/^github:/, "https://github.com/")
    .replace(/\.git$/, "");
};

const normalize = (content: string): string =>
  content
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();

/** Copyright holder as declared in package.json, else the source repository. */
const authorOf = (manifest: unknown, source: string): string => {
  const author = field(manifest, "author");
  return text(author) || text(field(author, "name")) || `the authors of ${source}`;
};

/**
 * The package's own license/notice files, verbatim apart from line endings. Without one, the
 * canonical text of its declared license with the declared author; unknown licenses fail loudly.
 */
const licenseTexts = (dir: string, manifest: unknown, license: string, source: string) => {
  const files = readdirSync(dir).filter((name) => LICENSE_FILE.test(name));
  if (files.length > 0)
    return files.sort().map((name) => normalize(readFileSync(join(dir, name), "utf8")));
  const standard = join(STANDARD_TEXTS, `${license}.txt`);
  if (!existsSync(standard))
    throw new Error(`${text(field(manifest, "name"))} has no license file; add ${standard}`);
  return [
    `This package includes no license file. It is distributed under ${license}; copyright ${authorOf(manifest, source)}. The standard ${license} text follows.\n\n${normalize(readFileSync(standard, "utf8"))}`,
  ];
};

/** Node resolution from a package directory: nearest `node_modules/<name>`, real path. */
const resolveFrom = (fromDir: string, name: string): string | null => {
  let dir = fromDir;
  while (true) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return realpathSync(candidate);
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
};

const shipped = new Map<string, Package>();
const visitedWorkspaces = new Set<string>();
const visitedDirs = new Set<string>();

/** Workspace packages are ours: follow what they ship, list only third parties. */
const visitWorkspace = (workspace: string): void => {
  if (visitedWorkspaces.has(workspace)) return;
  visitedWorkspaces.add(workspace);
  const dir = join(ROOT, workspace);
  const manifest = readManifest(dir);
  const names = [
    ...keys(field(manifest, "dependencies")),
    ...(BUNDLES_DEV_DEPENDENCIES.has(workspace) ? keys(field(manifest, "devDependencies")) : []),
  ].filter((name) => !BUILD_ONLY.test(name));
  for (const name of names) {
    const resolved = resolveFrom(dir, name);
    if (!resolved) throw new Error(`${workspace}: ${name} is not installed; run bun install`);
    visitDir(resolved);
  }
};

/**
 * Third-party package: record it, then its dependencies and installed optionals. Peers are not
 * followed: our apps list every runtime peer directly, while third-party peers are mostly
 * optional tooling integrations (e.g. `better-auth` → `drizzle-kit`).
 */
const visitDir = (dir: string): void => {
  const inRepo = relative(ROOT, dir);
  if (!inRepo.startsWith("..") && !inRepo.split("/").includes("node_modules")) {
    visitWorkspace(inRepo);
    return;
  }
  if (visitedDirs.has(dir)) return;
  visitedDirs.add(dir);
  const manifest = readManifest(dir);
  const name = text(field(manifest, "name"));
  const version = text(field(manifest, "version"));
  // Build tools and per-OS/CPU binaries never ship (and would make output machine-dependent).
  if (BUILD_ONLY.test(name) || field(manifest, "os") || field(manifest, "cpu")) return;
  const license = licenseOf(manifest);
  const source = sourceOf(manifest);
  shipped.set(`${name}@${version}`, {
    name,
    version,
    license,
    source,
    texts: licenseTexts(dir, manifest, license, source),
  });
  const required = keys(field(manifest, "dependencies"));
  const optional = keys(field(manifest, "optionalDependencies"));
  for (const dep of [...required, ...optional]) {
    const resolved = resolveFrom(dir, dep);
    // Optional dependencies ship only when installed on this platform.
    if (resolved) visitDir(resolved);
    else if (!optional.includes(dep))
      throw new Error(`${name}@${version}: dependency ${dep} is not installed`);
  }
};

const render = (): string => {
  for (const app of SHIPPED) visitWorkspace(app);
  const packages = [...shipped.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
  );
  const width = Math.max(...packages.map((p) => `${p.name}@${p.version}`.length)) + 2;
  const summary = packages.map((p) => `  ${`${p.name}@${p.version}`.padEnd(width)}${p.license}`);
  const sections = packages.map((p) =>
    [
      RULE,
      `${p.name}@${p.version}`,
      `License: ${p.license}`,
      ...(p.source ? [`Source: ${p.source}`] : []),
      "-".repeat(80),
      p.texts.join(`\n\n${"-".repeat(40)}\n\n`),
    ].join("\n"),
  );
  return [
    "THIRD-PARTY SOFTWARE NOTICES",
    "",
    "PWR (the server, the Admin web UI, and the `pwr` and `pwr-agent` programs with the embedded",
    "Studio) includes the third-party software listed below. Each package is distributed under its",
    "own license, reproduced in full after the summary. PWR itself is licensed under the terms in",
    "the LICENSE file.",
    "",
    "Generated by `bun run notices` from the installed dependency tree; do not edit by hand.",
    "",
    `Summary (${packages.length} packages)`,
    "",
    ...summary,
    "",
    ...sections,
    RULE,
    "",
  ].join("\n");
};

const output = render();
if (Bun.argv.includes("--check")) {
  const current = existsSync(OUTPUT) ? readFileSync(OUTPUT, "utf8") : "";
  if (current !== output) {
    console.error("THIRD_PARTY_NOTICES.txt is out of date: run `bun run notices` and commit it.");
    process.exit(1);
  }
  console.log(`THIRD_PARTY_NOTICES.txt is current (${shipped.size} packages).`);
} else {
  writeFileSync(OUTPUT, output);
  console.log(`Wrote THIRD_PARTY_NOTICES.txt (${shipped.size} packages).`);
}
