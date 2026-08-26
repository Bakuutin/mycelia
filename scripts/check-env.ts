#!/usr/bin/env -S deno run --allow-read

type Assignment = {
  key: string;
  value: string;
  line: number;
  raw: string;
  commented: boolean;
  normalized: string;
};

type LineIssue = {
  line: number;
  key?: string;
  reason: string;
};

export type ParsedEnvFile = {
  path: string;
  text: string;
  lines: string[];
  active: Assignment[];
  commented: Assignment[];
  malformed: LineIssue[];
  formatting: LineIssue[];
};

type Duplicate = {
  key: string;
  lines: number[];
  conflicting: boolean;
};

export type EnvAudit = {
  consistent: boolean;
  strict: boolean;
  files: {
    env: FileStats;
    example: FileStats;
  };
  missingRequired: Array<{ key: string; line: number }>;
  missingOptional: Array<{ key: string; line: number }>;
  undocumented: Array<{ key: string; lines: number[] }>;
  optionalEnabled: Array<{ key: string; lines: number[] }>;
  blankValues: Array<{ key: string; lines: number[] }>;
  envDuplicates: Duplicate[];
  exampleDuplicates: Duplicate[];
  envMalformed: LineIssue[];
  exampleMalformed: LineIssue[];
  formatting: LineIssue[];
  errorCount: number;
  warningCount: number;
};

type FileStats = {
  path: string;
  lines: number;
  assignments: number;
  commentedAssignments: number;
  uniqueKeys: number;
  duplicateKeys: number;
  malformedLines: number;
  formattingIssues: number;
};

type CliOptions = {
  envPath: string;
  examplePath: string;
  all: boolean;
  customPaths: boolean;
  fix: boolean;
  json: boolean;
  pruneUndocumented: boolean;
  strict: boolean;
};

type FixOptions = {
  pruneUndocumented?: boolean;
};

type FixResult = {
  changed: boolean;
  backupPath?: string;
  added: string[];
  generated: string[];
  deduplicated: string[];
  formatted: string[];
  pruned: string[];
};

export type EnvContractSpec = {
  name: string;
  envPath: string;
  examplePath: string;
  required: boolean;
};

export type EnvContractResult = EnvContractSpec & {
  configured: boolean;
  consistent: boolean;
  template: FileStats;
  templateErrorCount: number;
  audit?: EnvAudit;
};

const ENV_CONTRACTS: EnvContractSpec[] = [
  {
    name: "main",
    envPath: ".env",
    examplePath: ".env.example",
    required: true,
  },
  {
    name: "diarizator",
    envPath: "diarizator/.env",
    examplePath: "diarizator/.env.template",
    required: false,
  },
  {
    name: "gpu",
    envPath: "gpu/.env",
    examplePath: "gpu/.env.example",
    required: false,
  },
  {
    name: "rag",
    envPath: ".env.rag.local",
    examplePath: ".env.rag.example",
    required: false,
  },
];

const ACTIVE_ASSIGNMENT = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;
const COMMENTED_ASSIGNMENT = /^\s*#\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function assignmentGroups(entries: Assignment[]): Map<string, Assignment[]> {
  const groups = new Map<string, Assignment[]>();
  for (const entry of entries) {
    const current = groups.get(entry.key) ?? [];
    current.push(entry);
    groups.set(entry.key, current);
  }
  return groups;
}

function duplicates(entries: Assignment[]): Duplicate[] {
  return [...assignmentGroups(entries).entries()]
    .filter(([, occurrences]) => occurrences.length > 1)
    .map(([key, occurrences]) => ({
      key,
      lines: occurrences.map((entry) => entry.line),
      conflicting: new Set(occurrences.map((entry) => entry.value)).size > 1,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

export function parseEnvText(path: string, input: string): ParsedEnvFile {
  const text = input.replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();

  const active: Assignment[] = [];
  const commented: Assignment[] = [];
  const malformed: LineIssue[] = [];
  const formatting: LineIssue[] = [];

  lines.forEach((raw, index) => {
    const line = index + 1;
    const trimmed = raw.trim();
    if (!trimmed) return;

    const commentedMatch = raw.match(COMMENTED_ASSIGNMENT);
    if (commentedMatch) {
      const [, key, value] = commentedMatch;
      commented.push({
        key,
        value,
        line,
        raw,
        commented: true,
        normalized: `# ${key}=${value}`,
      });
      return;
    }

    if (trimmed.startsWith("#")) return;

    const activeMatch = raw.match(ACTIVE_ASSIGNMENT);
    if (activeMatch) {
      const [, key, value] = activeMatch;
      const normalized = `${key}=${value}`;
      active.push({
        key,
        value,
        line,
        raw,
        commented: false,
        normalized,
      });
      if (raw !== normalized) {
        formatting.push({
          line,
          key,
          reason:
            "assignment should use KEY=value without export or key-side spaces",
        });
      }
      return;
    }

    if (raw.includes("=")) {
      malformed.push({
        line,
        reason: "assignment-like line does not use a valid environment key",
      });
    }
  });

  return { path, text, lines, active, commented, malformed, formatting };
}

function fileStats(file: ParsedEnvFile, example: boolean): FileStats {
  const relevant = example ? [...file.active, ...file.commented] : file.active;
  return {
    path: file.path,
    lines: file.lines.length,
    assignments: file.active.length,
    commentedAssignments: file.commented.length,
    uniqueKeys: new Set(relevant.map((entry) => entry.key)).size,
    duplicateKeys: duplicates(relevant).length,
    malformedLines: file.malformed.length,
    formattingIssues: file.formatting.length,
  };
}

export function auditEnv(
  env: ParsedEnvFile,
  example: ParsedEnvFile,
  strict = false,
): EnvAudit {
  const envGroups = assignmentGroups(env.active);
  const exampleActiveGroups = assignmentGroups(example.active);
  const allExampleEntries = [...example.active, ...example.commented];
  const requiredKeys = new Set(example.active.map((entry) => entry.key));
  const allKnownKeys = new Set(allExampleEntries.map((entry) => entry.key));
  const optionalKeys = new Set(
    example.commented
      .map((entry) => entry.key)
      .filter((key) => !requiredKeys.has(key)),
  );

  const missingRequired = [...requiredKeys]
    .filter((key) => !envGroups.has(key))
    .map((key) => ({ key, line: exampleActiveGroups.get(key)![0].line }))
    .sort((a, b) => a.key.localeCompare(b.key));

  const optionalExampleGroups = assignmentGroups(example.commented);
  const missingOptional = [...optionalKeys]
    .filter((key) => !envGroups.has(key))
    .map((key) => ({ key, line: optionalExampleGroups.get(key)![0].line }))
    .sort((a, b) => a.key.localeCompare(b.key));

  const undocumented = [...envGroups.entries()]
    .filter(([key]) => !allKnownKeys.has(key))
    .map(([key, entries]) => ({
      key,
      lines: entries.map((entry) => entry.line),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));

  const optionalEnabled = [...envGroups.entries()]
    .filter(([key]) => optionalKeys.has(key))
    .map(([key, entries]) => ({
      key,
      lines: entries.map((entry) => entry.line),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));

  const blankValues = [...envGroups.entries()]
    .filter(([, entries]) => entries.at(-1)!.value.trim() === "")
    .map(([key, entries]) => ({
      key,
      lines: entries.map((entry) => entry.line),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));

  const envDuplicates = duplicates(env.active);
  const exampleDuplicates = duplicates(allExampleEntries);
  const errorCount = missingRequired.length + envDuplicates.length +
    exampleDuplicates.length + env.malformed.length + example.malformed.length;
  const warningCount = undocumented.length + env.formatting.length +
    (strict ? blankValues.length : 0);

  return {
    consistent: errorCount === 0 && warningCount === 0,
    strict,
    files: {
      env: fileStats(env, false),
      example: fileStats(example, true),
    },
    missingRequired,
    missingOptional,
    undocumented,
    optionalEnabled,
    blankValues,
    envDuplicates,
    exampleDuplicates,
    envMalformed: env.malformed,
    exampleMalformed: example.malformed,
    formatting: env.formatting,
    errorCount,
    warningCount,
  };
}

function formatKeys(
  items: Array<{ key: string; line?: number; lines?: number[] }>,
): string[] {
  return items.map((item) => {
    const locations = item.lines ?? (item.line ? [item.line] : []);
    return locations.length
      ? `${item.key} (line${locations.length === 1 ? "" : "s"} ${
        locations.join(", ")
      })`
      : item.key;
  });
}

function formatLineIssues(items: LineIssue[]): string[] {
  return items.map((item) =>
    `${item.key ? `${item.key}: ` : ""}line ${item.line} — ${item.reason}`
  );
}

function humanList(title: string, items: string[], detail?: string): string[] {
  if (!items.length) return [];
  return [
    `${title} (${items.length})${detail ? ` — ${detail}` : ""}:`,
    ...items.map((item) => `  - ${item}`),
    "",
  ];
}

export function renderHumanAudit(audit: EnvAudit): string {
  const env = audit.files.env;
  const example = audit.files.example;
  const lines = [
    "Environment consistency check",
    "",
    `Files:`,
    `  ${example.path}: ${example.lines} lines, ${example.assignments} required assignments, ${example.commentedAssignments} optional examples, ${example.uniqueKeys} unique keys`,
    `  ${env.path}: ${env.lines} lines, ${env.assignments} assignments, ${env.uniqueKeys} unique keys, ${audit.blankValues.length} blank values`,
    "",
  ];

  lines.push(
    ...humanList("Missing required keys", formatKeys(audit.missingRequired)),
  );
  lines.push(...humanList(
    "Optional keys not enabled",
    formatKeys(audit.missingOptional),
    "informational",
  ));
  lines.push(...humanList(
    "Optional keys enabled",
    formatKeys(audit.optionalEnabled),
    "informational",
  ));
  lines.push(...humanList(
    "Undocumented keys",
    formatKeys(audit.undocumented),
    "present in the environment file but absent from the selected template; review manually",
  ));
  lines.push(...humanList(
    "Duplicate keys in .env",
    audit.envDuplicates.map((item) =>
      `${item.key} (lines ${item.lines.join(", ")}${
        item.conflicting ? "; conflicting values" : ""
      })`
    ),
  ));
  lines.push(...humanList(
    "Duplicate keys in .env.example",
    audit.exampleDuplicates.map((item) =>
      `${item.key} (lines ${item.lines.join(", ")}${
        item.conflicting ? "; conflicting defaults" : ""
      })`
    ),
  ));
  lines.push(
    ...humanList(
      "Malformed lines in .env",
      formatLineIssues(audit.envMalformed),
    ),
  );
  lines.push(
    ...humanList(
      "Malformed lines in .env.example",
      formatLineIssues(audit.exampleMalformed),
    ),
  );
  lines.push(
    ...humanList("Formatting issues", formatLineIssues(audit.formatting)),
  );
  lines.push(...humanList(
    "Blank values",
    formatKeys(audit.blankValues),
    audit.strict
      ? "warnings in strict mode"
      : "informational; values are never displayed",
  ));

  lines.push(
    `Summary: ${audit.errorCount} errors, ${audit.warningCount} warnings, ${audit.missingOptional.length} optional keys absent.`,
    `Status: ${audit.consistent ? "CONSISTENT" : "NEEDS ATTENTION"}`,
    "No environment values were printed.",
  );
  return lines.join("\n");
}

function secureSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timestamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(
    /\.\d{3}Z$/,
    "Z",
  );
}

export async function fixEnv(
  env: ParsedEnvFile,
  example: ParsedEnvFile,
  options: FixOptions = {},
): Promise<FixResult> {
  const audit = auditEnv(env, example);
  const conflicting = audit.envDuplicates.filter((item) => item.conflicting);
  if (conflicting.length) {
    throw new Error(
      `Refusing to fix conflicting duplicates: ${
        conflicting.map((item) => item.key).join(", ")
      }`,
    );
  }
  if (audit.exampleDuplicates.length) {
    throw new Error(
      "Refusing to fix while the selected template contains duplicate keys",
    );
  }
  if (audit.envMalformed.length || audit.exampleMalformed.length) {
    throw new Error(
      "Refusing to fix malformed assignment-like lines; review their line numbers first",
    );
  }

  const envGroups = assignmentGroups(env.active);
  const linesToRemove = new Set<number>();
  const deduplicated: string[] = [];
  for (const duplicate of audit.envDuplicates) {
    const entries = envGroups.get(duplicate.key)!;
    for (const entry of entries.slice(0, -1)) linesToRemove.add(entry.line);
    deduplicated.push(duplicate.key);
  }

  const pruned = options.pruneUndocumented
    ? audit.undocumented.map((item) => item.key)
    : [];
  if (options.pruneUndocumented) {
    for (const item of audit.undocumented) {
      for (const line of item.lines) linesToRemove.add(line);
    }
  }

  const formattingByLine = new Map(
    env.active
      .filter((entry) => entry.raw !== entry.normalized)
      .map((entry) => [entry.line, entry.normalized]),
  );
  const formatted = uniqueSorted(
    env.active
      .filter((entry) => entry.raw !== entry.normalized)
      .map((entry) => entry.key),
  );

  const outputLines = env.lines.flatMap((line, index) => {
    const lineNumber = index + 1;
    if (linesToRemove.has(lineNumber)) return [];
    return [formattingByLine.get(lineNumber) ?? line];
  });

  const exampleGroups = assignmentGroups(example.active);
  const added: string[] = [];
  const generated: string[] = [];
  const additions: string[] = [];
  for (const missing of audit.missingRequired) {
    const entry = exampleGroups.get(missing.key)![0];
    let value = entry.value;
    if (entry.key === "SECRET_KEY" && value.trim() === "") {
      value = secureSecret();
      generated.push(entry.key);
    }
    additions.push(`${entry.key}=${value}`);
    added.push(entry.key);
  }

  if (additions.length) {
    if (outputLines.length && outputLines.at(-1)?.trim() !== "") {
      outputLines.push("");
    }
    outputLines.push(
      `# --- Added by scripts/check-env.sh (${
        new Date().toISOString().slice(0, 10)
      }) ---`,
      ...additions,
    );
  }

  const changed = linesToRemove.size > 0 || formattingByLine.size > 0 ||
    additions.length > 0 ||
    !env.text.endsWith("\n");
  if (!changed) {
    return {
      changed: false,
      added,
      generated,
      deduplicated,
      formatted,
      pruned,
    };
  }

  const stat = await Deno.stat(env.path);
  const backupPath = `${env.path}.backup-${timestamp()}`;
  await Deno.copyFile(env.path, backupPath);
  await Deno.chmod(backupPath, 0o600);

  const tempPath = `${env.path}.tmp-${Deno.pid}`;
  try {
    await Deno.writeTextFile(tempPath, `${outputLines.join("\n")}\n`);
    if (stat.mode !== null) await Deno.chmod(tempPath, stat.mode & 0o777);
    await Deno.rename(tempPath, env.path);
  } catch (error) {
    try {
      await Deno.remove(tempPath);
    } catch {
      // The temp file may not have been created yet.
    }
    throw error;
  }

  return {
    changed: true,
    backupPath,
    added,
    generated,
    deduplicated,
    formatted,
    pruned,
  };
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    envPath: ".env",
    examplePath: ".env.example",
    all: false,
    customPaths: false,
    fix: false,
    json: false,
    pruneUndocumented: false,
    strict: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--all") options.all = true;
    else if (arg === "--fix") options.fix = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--prune-undocumented") {
      options.pruneUndocumented = true;
    } else if (arg === "--strict") options.strict = true;
    else if (arg === "--env") {
      options.customPaths = true;
      options.envPath = args[++index] ?? "";
    } else if (arg === "--example") {
      options.customPaths = true;
      options.examplePath = args[++index] ?? "";
    } else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: ./scripts/check-env.sh [options]

Compare .env with .env.example without printing values.

Options:
  --all             Audit main, diarizator, GPU, and RAG env contracts
  --fix             Back up .env, add required missing keys, normalize spacing,
                    and remove only identical duplicates
  --prune-undocumented
                    With --fix, remove keys absent from the selected template
  --strict          Treat blank active values as warnings
  --json            Print a value-free machine-readable report
  --env PATH        Environment file (default: .env)
  --example PATH    Example file (default: .env.example)
  -h, --help        Show this help`);
      Deno.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.envPath || !options.examplePath) {
    throw new Error("--env and --example require paths");
  }
  if (options.all && options.customPaths) {
    throw new Error("--all cannot be combined with --env or --example");
  }
  if (options.all && options.fix) {
    throw new Error("--all is audit-only; run --fix for one explicit contract");
  }
  if (options.pruneUndocumented && !options.fix) {
    throw new Error("--prune-undocumented requires --fix");
  }
  return options;
}

async function loadParsed(path: string): Promise<ParsedEnvFile> {
  return parseEnvText(path, await Deno.readTextFile(path));
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isFile;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

export async function auditEnvContracts(
  contracts: EnvContractSpec[],
  strict = false,
): Promise<EnvContractResult[]> {
  const results: EnvContractResult[] = [];
  for (const contract of contracts) {
    const example = await loadParsed(contract.examplePath);
    const templateErrorCount = duplicates([
      ...example.active,
      ...example.commented,
    ]).length + example.malformed.length;
    const configured = await fileExists(contract.envPath);
    if (!configured) {
      results.push({
        ...contract,
        configured: false,
        consistent: !contract.required && templateErrorCount === 0,
        template: fileStats(example, true),
        templateErrorCount,
      });
      continue;
    }

    const audit = auditEnv(await loadParsed(contract.envPath), example, strict);
    results.push({
      ...contract,
      configured: true,
      consistent: audit.consistent,
      template: fileStats(example, true),
      templateErrorCount,
      audit,
    });
  }
  return results;
}

export function renderHumanContracts(results: EnvContractResult[]): string {
  const lines = ["Environment contract audit", ""];
  for (const result of results) {
    lines.push(`[${result.name}] ${result.envPath}`);
    if (result.audit) {
      lines.push(renderHumanAudit(result.audit), "");
      continue;
    }

    lines.push(
      result.required
        ? "Required environment file is missing."
        : "Optional deployment is not configured; template checked only.",
      `Template: ${result.examplePath}, ${result.template.uniqueKeys} unique keys, ${result.templateErrorCount} errors`,
      `Status: ${result.consistent ? "NOT CONFIGURED" : "NEEDS ATTENTION"}`,
      "",
    );
  }
  const consistent = results.every((result) => result.consistent);
  lines.push(
    `Overall status: ${consistent ? "CONSISTENT" : "NEEDS ATTENTION"}`,
    "No environment values were printed.",
  );
  return lines.join("\n");
}

async function main(): Promise<void> {
  const options = parseArgs(Deno.args);

  if (options.all) {
    const contracts = await auditEnvContracts(ENV_CONTRACTS, options.strict);
    const consistent = contracts.every((contract) => contract.consistent);
    if (options.json) {
      console.log(JSON.stringify({ consistent, contracts }, null, 2));
    } else {
      console.log(renderHumanContracts(contracts));
    }
    Deno.exitCode = consistent ? 0 : 1;
    return;
  }

  let env = await loadParsed(options.envPath);
  const example = await loadParsed(options.examplePath);
  let fix: FixResult | undefined;

  if (options.fix) {
    fix = await fixEnv(env, example, {
      pruneUndocumented: options.pruneUndocumented,
    });
    env = await loadParsed(options.envPath);
  }

  const audit = auditEnv(env, example, options.strict);
  if (options.json) {
    console.log(JSON.stringify({ ...audit, fix }, null, 2));
  } else {
    if (fix?.changed) {
      console.log(`Updated ${options.envPath}; backup: ${fix.backupPath}`);
      if (fix.added.length) console.log(`Added keys: ${fix.added.join(", ")}`);
      if (fix.generated.length) {
        console.log(`Generated secure values for: ${fix.generated.join(", ")}`);
      }
      if (fix.deduplicated.length) {
        console.log(
          `Removed identical duplicates: ${fix.deduplicated.join(", ")}`,
        );
      }
      if (fix.formatted.length) {
        console.log(`Normalized assignments: ${fix.formatted.join(", ")}`);
      }
      if (fix.pruned.length) {
        console.log(`Removed undocumented keys: ${fix.pruned.join(", ")}`);
      }
      console.log("");
    } else if (fix) {
      console.log("No safe fixes were needed.\n");
    }
    console.log(renderHumanAudit(audit));
  }

  Deno.exitCode = audit.consistent ? 0 : 1;
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(
      `Environment check failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    Deno.exitCode = 2;
  }
}
