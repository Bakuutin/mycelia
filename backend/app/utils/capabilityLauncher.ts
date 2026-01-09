/**
 * Capability Launcher - Entry point for discovering capability manifests
 * 
 * 1. Loads the target capability module from path
 * 2. Extracts manifest information
 * 3. Outputs JSON to stdout
 */

async function main() {
  const capabilityPath = Deno.env.get("MYCELIA_CAPABILITY_PATH");

  if (!capabilityPath) {
    console.error("Missing MYCELIA_CAPABILITY_PATH environment variable");
    Deno.exit(1);
  }

  try {
    const mod = await import(capabilityPath);
    const capability = (mod.default && typeof mod.default === "object") ? mod.default : mod;
    
    const manifest = {
      name: capability.name,
      inputSchema: capability.inputSchema,
      outputSchema: capability.outputSchema,
      policies: capability.policies,
      maxConcurrency: capability.maxConcurrency,
      triggers: capability.triggers
    };

    console.log(JSON.stringify(manifest));
    Deno.exit(0);
  } catch (err) {
    console.error(`Failed to load capability at ${capabilityPath}: ${err}`);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main();
}

