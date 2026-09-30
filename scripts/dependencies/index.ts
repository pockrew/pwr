import { Glob } from "bun";
import { existsSync, realpathSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import * as ts from "typescript/unstable/ast";
import { API } from "typescript/unstable/async";

import { INTERNAL_RULES, SIZE_LIMITS } from "./rules";

export const ROOT = resolve(import.meta.dir, "../..");

export const toPosix = (p: string): string => p.split(sep).join("/");

export type Finding = {
  level: "error" | "warn";
  rule: string;
  message: string;
  file?: string;
};

export type AnalysisReport = {
  modules: number;
  findings: Finding[];
};

type WorkspaceMeta = Map<string, Map<string, string>>;
const resolveSpec = (
  file: string,
  spec: string,
  files: ReadonlySet<string>,
  meta: WorkspaceMeta,
  _root: string,
): string | null => {
  const target = meta.get(file)?.get(spec);
  return target && files.has(target) ? target : null;
};

export const detectCycles = (graph: ReadonlyMap<string, readonly string[]>): string[][] => {
  const cycles: string[][] = [];
  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];

  const visit = (node: string): void => {
    const s = state.get(node);
    if (s === "done") return;
    if (s === "visiting") {
      cycles.push([...stack.slice(stack.indexOf(node)), node]);
      return;
    }
    state.set(node, "visiting");
    stack.push(node);
    for (const dep of graph.get(node) ?? []) {
      visit(dep);
    }
    stack.pop();
    state.set(node, "done");
  };

  for (const node of graph.keys()) {
    visit(node);
  }

  return cycles;
};
const scanImports = (
  source: ts.SourceFile,
): Array<{ spec: string; typeOnly: boolean; node: ts.Node }> => {
  const imports: Array<{ spec: string; typeOnly: boolean; node: ts.Node }> = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const typeOnly =
        clause?.phaseModifier === ts.SyntaxKind.TypeKeyword ||
        (!!bindings &&
          ts.isNamedImports(bindings) &&
          !clause?.name &&
          bindings.elements.length > 0 &&
          bindings.elements.every((item) => item.isTypeOnly));
      imports.push({ spec: node.moduleSpecifier.text, typeOnly, node: node.moduleSpecifier });
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const typeOnly =
        node.isTypeOnly ||
        (!!node.exportClause &&
          ts.isNamedExports(node.exportClause) &&
          node.exportClause.elements.length > 0 &&
          node.exportClause.elements.every((item) => item.isTypeOnly));
      imports.push({ spec: node.moduleSpecifier.text, typeOnly, node: node.moduleSpecifier });
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      imports.push({
        spec: node.argument.literal.text,
        typeOnly: true,
        node: node.argument.literal,
      });
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      const argument = node.arguments[0];
      if (
        !argument ||
        !(ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))
      )
        throw new Error("Dynamic module specifiers must be literals");
      imports.push({ spec: argument.text, typeOnly: false, node: argument });
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      const expression = node.moduleReference.expression;
      if (expression && ts.isStringLiteral(expression))
        imports.push({ spec: expression.text, typeOnly: node.isTypeOnly, node: expression });
    }
    node.forEachChild(visit);
  };
  visit(source);
  return imports;
};

const SKIP = ["node_modules/", "/dist/", "/.bun-cache/", "routeTree.gen.ts", "/.states/"];

const collect = async (pattern: string, root = ROOT): Promise<string[]> => {
  const out: string[] = [];
  for await (const f of new Glob(pattern).scan(root)) {
    const p = toPosix(f);
    if (!SKIP.some((s) => p.includes(s))) out.push(p);
  }
  return out;
};

const checkParentImports = (file: string, rawSpecs: string[]): Finding | null => {
  const spec = rawSpecs.find((s) => s.startsWith("../"));
  if (!spec) return null;

  return {
    level: "error",
    rule: "no-parent-imports",
    message: `${file} uses forbidden parent import "${spec}"`,
    file,
  };
};

const checkSchemaPurity = (
  file: string,
  rawSpecs: string[],
  files: Set<string>,
  meta: WorkspaceMeta,
  root: string,
): Finding | null => {
  if (!file.startsWith("packages/shared/")) return null;

  for (const spec of rawSpecs) {
    if (
      spec.startsWith("@pockrew/server") ||
      spec.startsWith("@server") ||
      spec.startsWith("apps/")
    ) {
      return {
        level: "error",
        rule: "schemas-pure",
        message: `${file} violates schema purity with import "${spec}"`,
        file,
      };
    }

    const target = resolveSpec(file, spec, files, meta, root);
    if (!target) continue;

    if (target.startsWith("apps/") || !target.startsWith("packages/shared/")) {
      return {
        level: "error",
        rule: "schemas-pure",
        message: `${file} violates schema purity with internal dependency "${target}"`,
        file,
      };
    }
  }

  return null;
};

const SIZE_EXEMPT: readonly RegExp[] = [
  /^apps\/server\/src\/db\/migrations\//,
  /\.gen\.ts$/,
  /\.snapshot\.json$/,
  /^CHANGELOG\.md$/i,
  /(^|\/)docs\/plans\//,
  /\.(test|spec)\.tsx?$/,
];

export const checkSize = (file: string, code: string): Finding | null => {
  if (SIZE_EXEMPT.some((r) => r.test(file)) || file === "apps/server/worker-configuration.d.ts")
    return null;

  const limit = SIZE_LIMITS.find((l) => l.match.test(file));
  if (!limit) return null;

  const lines = code.split("\n").length;
  if (lines <= limit.warn) return null;

  const level = lines > limit.fail ? "error" : "warn";
  const bound = level === "error" ? limit.fail : limit.warn;
  return {
    level,
    rule: `max-lines-${limit.label}`,
    message: `${file} is ${lines} lines (${level === "error" ? "limit" : "soft limit"} ${bound}) — see §4.6`,
    file,
  };
};

const BARREL_ALLOWED: readonly RegExp[] = [
  /^apps\/(?:server|agent)\/src\/db\/schemas?\/index\.ts$/,
  /^packages\/shared\/src\/(schemas|libs)\/index\.ts$/,
  /^packages\/core\/src\/(ports|index)\.ts$/,
  /^packages\/core\/src\/ports\/index\.ts$/,
  /^apps\/server\/src\/auth\/index\.ts$/,
];

export const isBarrel = (file: string, code: string): boolean => {
  if (!/(^|\/)index\.tsx?$/.test(file)) return false;
  if (BARREL_ALLOWED.some((r) => r.test(file))) return false;

  const lines = code
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^([/*])/.test(l));

  return lines.length > 0 && lines.every((l) => /^export\s/.test(l) && / from ["']/.test(l));
};

const checkInternalRules = (file: string, target: string): Finding[] => {
  const findings: Finding[] = [];
  for (const rule of INTERNAL_RULES) {
    if (rule.name === "schemas-pure") continue;

    const m = rule.from.exec(file);
    if (!m) continue;

    const hit = typeof rule.to === "function" ? rule.to(target, m) : rule.to.test(target);
    if (!hit) continue;

    findings.push({
      level: "error",
      rule: rule.name,
      message: `${file} → ${target} — ${rule.why}`,
      file,
    });
  }
  return findings;
};

export const analyzeWorkspace = async (
  root = ROOT,
  options: { includeWarnings?: boolean } = {},
): Promise<AnalysisReport> => {
  root = realpathSync(root);
  const includeWarnings = options.includeWarnings ?? false;
  const meta: WorkspaceMeta = new Map();
  const sources = await collect("{apps,packages,scripts}/**/*.{ts,tsx}", root);
  if (sources.length === 0) {
    return {
      modules: 0,
      findings: [
        {
          level: "error",
          rule: "empty-scan",
          message: "No source modules found; boundary verification did not run.",
        },
      ],
    };
  }
  const api = new API({ cwd: root });
  try {
    const snapshot = await api.updateSnapshot({
      openFiles: sources.map((file) => resolve(root, file)),
    });
    const docs = await collect("docs/**/*.md", root);
    const files = new Set(sources);

    const graph = new Map<string, string[]>();
    const findings: Finding[] = [];
    const serverOnlyFiles = new Set<string>();
    const clientOnlyFiles = new Set<string>();

    for (const file of [...sources, ...docs]) {
      const code = await Bun.file(resolve(root, file)).text();

      const size = checkSize(file, code);
      if (size !== null && (includeWarnings || size.level === "error")) {
        findings.push(size);
      }

      if (!files.has(file)) continue; // Markdown docs stop after size check

      if (/^\s*\/\/\s*@server-only\s*$/m.test(code)) serverOnlyFiles.add(file);
      if (/^\s*\/\/\s*@client-only\s*$/m.test(code)) clientOnlyFiles.add(file);

      if (includeWarnings && isBarrel(file, code)) {
        findings.push({
          level: "warn",
          rule: "no-barrel",
          message: `${file} looks like a re-export barrel — import the concrete file directly (§4.6)`,
          file,
        });
      }

      const absolute = resolve(root, file);
      const project = await snapshot.getDefaultProjectForFile(absolute);
      const source = await project?.program.getSourceFile(absolute);
      if (!source || !project) throw new Error(`Source not loaded: ${file}`);
      if ((await project.program.getSyntacticDiagnostics(absolute)).length > 0) {
        findings.push({
          level: "error",
          rule: "source-syntax",
          message: `Invalid syntax in ${file}`,
          file,
        });
        continue;
      }
      let imports: ReturnType<typeof scanImports>;
      try {
        imports = scanImports(source);
      } catch {
        findings.push({
          level: "error",
          rule: "dynamic-import",
          message: `Unresolvable dynamic import in ${file}`,
          file,
        });
        continue;
      }
      const resolved = new Map<string, string>();
      for (const entry of imports) {
        const handle = (await project.checker.getSymbolAtLocation(entry.node))?.declarations[0];
        const path = (await handle?.resolve())?.getSourceFile().fileName;
        if (path) resolved.set(entry.spec, toPosix(relative(root, realpathSync(path))));
      }
      meta.set(file, resolved);
      const rawSpecs = imports.map((item) => item.spec);
      for (const { spec, typeOnly } of imports) {
        const isClientApp = /^(?:packages\/api-client|apps\/(?:studio|admin|cli))\//.test(file);

        if (
          typeOnly &&
          !file.endsWith(".integration.test.ts") &&
          isClientApp &&
          /^(?:@pockrew\/wr-server|@server|@pockrew\/wr-agent|@agent)(?:\/|$)/.test(spec) &&
          spec !== "@pockrew/pwr-server/rpc" &&
          spec !== "@pockrew/pwr-agent/rpc"
        ) {
          findings.push({
            level: "error",
            rule: "api-client-server-type",
            message: `Only RPC types are public: ${spec}`,
            file,
          });
        }
        const options = project.compilerOptions;
        const internal =
          /^(?:\.|~\/|@server\/|@pockrew\/)/.test(spec) ||
          Object.keys(options.paths ?? {}).some((pattern) =>
            spec.startsWith(pattern.replace(/\*$/, "")),
          );
        const asset = spec.startsWith(".") && existsSync(resolve(root, dirname(file), spec));
        if (internal && !asset && !resolveSpec(file, spec, files, meta, root)) {
          findings.push({
            level: "error",
            rule: "unresolved-import",
            message: `${file} cannot resolve ${spec}`,
            file,
          });
        }
      }
      const runtimeSpecs = imports.filter((item) => !item.typeOnly).map((item) => item.spec);
      for (const { spec, typeOnly } of imports) {
        const isRpcAllowed = /^(?:packages\/api-client|apps\/(?:studio|admin|cli|agent))\//.test(
          file,
        );
        if (
          !typeOnly ||
          (isRpcAllowed &&
            (spec === "@pockrew/pwr-server/rpc" || spec === "@pockrew/pwr-agent/rpc"))
        )
          continue;
        const target = resolveSpec(file, spec, files, meta, root);
        if (target) findings.push(...checkInternalRules(file, target));
      }
      const isStrictSourceExempt =
        file.endsWith(".d.ts") || /\.(test|spec)\.tsx?$/.test(file) || file.endsWith(".tsx");
      const violations: string[] = [];
      const inspect = (node: ts.Node): void => {
        if (
          node.kind === ts.SyntaxKind.AnyKeyword ||
          (ts.isAsExpression(node) &&
            !(
              ts.isTypeReferenceNode(node.type) &&
              ts.isIdentifier(node.type.typeName) &&
              node.type.typeName.text === "const"
            )) ||
          node.kind === ts.SyntaxKind.TypeAssertionExpression ||
          ts.isNonNullExpression(node) ||
          ts.isFunctionDeclaration(node) ||
          ts.isFunctionExpression(node)
        ) {
          violations.push("unsafe type or non-arrow function");
        }
        node.forEachChild(inspect);
      };
      if (!isStrictSourceExempt) inspect(source);
      if (violations.length)
        findings.push({
          level: "error",
          rule: "strict-source",
          message: `${file}: ${violations.length} unsafe type/arrow-rule violations`,
          file,
        });

      // Check parent imports
      const parentFinding = checkParentImports(file, rawSpecs);
      if (parentFinding) findings.push(parentFinding);

      // Check schema purity
      const schemaFinding = checkSchemaPurity(file, rawSpecs, files, meta, root);
      if (schemaFinding) findings.push(schemaFinding);

      // Resolve runtime dependencies and check internal rules
      const deps: string[] = [];
      for (const spec of runtimeSpecs) {
        const target = resolveSpec(file, spec, files, meta, root);
        if (!target) continue;

        deps.push(target);
        findings.push(...checkInternalRules(file, target));
      }

      graph.set(file, deps);
    }

    // Check cycles
    for (const cycle of detectCycles(graph)) {
      findings.push({
        level: "error",
        rule: "no-cycles",
        message: cycle.join(" → "),
      });
    }

    return {
      modules: sources.length,
      findings,
    };
  } finally {
    await api.close();
  }
};

export const main = async (argv = process.argv.slice(2)): Promise<number> => {
  const report = await analyzeWorkspace(ROOT, { includeWarnings: true });

  let filteredFindings = report.findings;
  if (argv.length > 0) {
    filteredFindings = report.findings.filter((f) =>
      argv.some((prefix) => f.file?.startsWith(prefix)),
    );
  }

  const errors = filteredFindings.filter((f) => f.level === "error");
  const warns = filteredFindings.filter((f) => f.level === "warn");

  for (const f of [...errors, ...warns]) {
    console[f.level === "error" ? "error" : "warn"](`${f.level} ${f.rule}: ${f.message}`);
  }

  const scale = `${report.modules} modules`;
  if (errors.length > 0) {
    console.error(`✗ ${errors.length} error(s), ${warns.length} warning(s). ${scale}.`);
    return 1;
  }

  console.log(`✔ clean — ${warns.length} warning(s). ${scale}.`);
  return 0;
};

if (import.meta.main) {
  process.exit(await main());
}
