export type InternalRule = {
  name: string;
  from: RegExp;
  to: RegExp | ((target: string, fromMatch: RegExpExecArray) => boolean);
  why: string;
};

export const INTERNAL_RULES: readonly InternalRule[] = [
  {
    name: "platform-no-modules",
    from: /^apps\/server\/src\/platform\//,
    to: /^apps\/server\/src\/modules\//,
    why: "platform is domain-agnostic and must not know a domain exists (§4.2.1)",
  },
  {
    name: "routes-are-leaves",
    from: /^apps\/server\/src\/(?!app\.ts$|modules\/[^/]+\/routes?\.test\.ts$)/,
    to: /^apps\/server\/src\/modules\/[^/]+\/routes?\.ts$/,
    why: "routes.ts is an HTTP edge, not a library: only app.ts and its colocated test may import it",
  },
  {
    name: "auth-routes-are-leaves",
    from: /^apps\/server\/src\/(?!app\.ts$|auth\/route\.ts$|auth\/index\.ts$|auth\/[^/]+\/route(s)?\.test\.ts$)/,
    to: /^apps\/server\/src\/auth\/[^/]+\/route(s)?\.ts$/,
    why: "provider routes are mounted by auth only (§6.3)",
  },
  {
    name: "apps-no-cross-import",
    // Integration fixtures exercise the real producer and consumer together; production stays isolated.
    from: /^apps\/([^/]+)\/(?!.*\.integration\.test\.ts$)/,
    to: (target, m) => target.startsWith("apps/") && !target.startsWith(`apps/${m[1] ?? ""}/`),
    why: "apps share code through packages/*, never through each other; `import type` is fine and is stripped before this check",
  },
  {
    name: "schemas-pure",
    from: /^packages\/shared\//,
    to: /^(apps\/|packages\/(?!shared\/))/,
    why: "packages/shared is the pure contract layer and depends on no apps or internal packages (§14.2.4)",
  },
];

export type SizeLimit = {
  match: RegExp;
  warn: number;
  fail: number;
  label: string;
};

export const SIZE_LIMITS: readonly SizeLimit[] = [
  {
    match: /^apps\/server\/src\/(app\.ts|auth\/index\.ts)$/,
    warn: 100,
    fail: 150,
    label: "wiring",
  },
  { match: /\.mdx?$/, warn: 600, fail: 1000, label: "doc" },
  { match: /\.tsx?$/, warn: 300, fail: 500, label: "source" },
];
