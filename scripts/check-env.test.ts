import {
  auditEnv,
  auditEnvContracts,
  fixEnv,
  parseEnvText,
  renderHumanAudit,
  renderHumanContracts,
} from "./check-env.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("audit reports consistency problems without exposing values", () => {
  const example = parseEnvText(
    ".env.example",
    "REQUIRED=default\n# OPTIONAL=off\nSECRET_KEY=\n",
  );
  const env = parseEnvText(
    ".env",
    "OPTIONAL=secret-optional-value\nUNKNOWN=secret-legacy-value\nUNKNOWN=secret-legacy-value\n",
  );
  const audit = auditEnv(env, example);
  const report = renderHumanAudit(audit);

  assert(
    audit.missingRequired.map((item) => item.key).join(",") ===
      "REQUIRED,SECRET_KEY",
    "missing keys",
  );
  assert(audit.undocumented[0]?.key === "UNKNOWN", "undocumented key");
  assert(audit.envDuplicates[0]?.key === "UNKNOWN", "duplicate key");
  assert(audit.optionalEnabled[0]?.key === "OPTIONAL", "optional enabled");
  assert(!report.includes("secret-optional-value"), "optional value leaked");
  assert(!report.includes("secret-legacy-value"), "legacy value leaked");
});

Deno.test("safe fix adds required keys, formats, deduplicates, and preserves unknown keys", async () => {
  const directory = await Deno.makeTempDir();
  const envPath = `${directory}/.env`;
  const examplePath = `${directory}/.env.example`;
  try {
    await Deno.writeTextFile(
      examplePath,
      "REQUIRED=default\nSECRET_KEY=\n# OPTIONAL=off\n",
    );
    await Deno.writeTextFile(envPath, " export UNKNOWN =same\nUNKNOWN=same\n");
    await Deno.chmod(envPath, 0o600);

    const result = await fixEnv(
      parseEnvText(envPath, await Deno.readTextFile(envPath)),
      parseEnvText(examplePath, await Deno.readTextFile(examplePath)),
    );
    const fixed = await Deno.readTextFile(envPath);

    assert(result.changed, "fix should write");
    assert(result.backupPath !== undefined, "backup missing");
    assert(fixed.includes("REQUIRED=default"), "required key not added");
    assert(/SECRET_KEY=[0-9a-f]{64}/.test(fixed), "secret not generated");
    assert(
      fixed.match(/^UNKNOWN=same$/gm)?.length === 1,
      "duplicate not removed",
    );
    assert(!fixed.includes("OPTIONAL=off"), "optional key should not be added");
    assert(
      (await Deno.stat(envPath)).mode! % 0o1000 === 0o600,
      "mode not preserved",
    );
    assert(
      (await Deno.stat(result.backupPath!)).mode! % 0o1000 === 0o600,
      "backup mode is not private",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("safe fix refuses conflicting duplicates", async () => {
  const env = parseEnvText(".env", "KEY=one\nKEY=two\n");
  const example = parseEnvText(".env.example", "KEY=default\n");
  let message = "";
  try {
    await fixEnv(env, example);
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assert(
    message.includes("conflicting duplicates: KEY"),
    "conflict was not refused",
  );
});

Deno.test("explicit prune removes undocumented keys without exposing values", async () => {
  const directory = await Deno.makeTempDir();
  const envPath = `${directory}/.env`;
  const examplePath = `${directory}/.env.example`;
  try {
    await Deno.writeTextFile(examplePath, "REQUIRED=default\n");
    await Deno.writeTextFile(
      envPath,
      "REQUIRED=current\nLEGACY=secret-value-must-not-leak\n",
    );
    const result = await fixEnv(
      parseEnvText(envPath, await Deno.readTextFile(envPath)),
      parseEnvText(examplePath, await Deno.readTextFile(examplePath)),
      { pruneUndocumented: true },
    );
    const fixed = await Deno.readTextFile(envPath);
    assert(result.pruned.join(",") === "LEGACY", "legacy key not reported");
    assert(!fixed.includes("LEGACY="), "legacy key not removed");
    assert(
      !JSON.stringify(result).includes("secret-value-must-not-leak"),
      "pruned value leaked",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("multi-contract audit treats an absent optional deployment as informational", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const mainEnv = `${directory}/.env`;
    const mainExample = `${directory}/.env.example`;
    const optionalEnv = `${directory}/optional/.env`;
    const optionalExample = `${directory}/optional/.env.example`;
    await Deno.mkdir(`${directory}/optional`);
    await Deno.writeTextFile(mainEnv, "MAIN=ready\n");
    await Deno.writeTextFile(mainExample, "MAIN=default\n");
    await Deno.writeTextFile(optionalExample, "OPTIONAL_REQUIRED=\n");

    const results = await auditEnvContracts([
      {
        name: "main",
        envPath: mainEnv,
        examplePath: mainExample,
        required: true,
      },
      {
        name: "optional",
        envPath: optionalEnv,
        examplePath: optionalExample,
        required: false,
      },
    ]);
    const report = renderHumanContracts(results);
    assert(
      results.every((result) => result.consistent),
      "contracts inconsistent",
    );
    assert(report.includes("NOT CONFIGURED"), "optional status missing");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
