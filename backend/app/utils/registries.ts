import { expandGlob } from "@std/fs";
import { toFileUrl } from "@std/path";
import { z } from "zod";



export const zTriggerSource = z.object({
  channel: z.string(),
  name: z.string(),
  filter: z.record(z.string(), z.any()).optional(),
});

export type TriggerSource = z.infer<typeof zTriggerSource>;

export const zTriggers = z.object({
  sources: z.array(zTriggerSource),
  debounceMs: z.number().optional(),
});

export type Triggers = z.infer<typeof zTriggers>;

export const zCapabilityManifest = z.object({
  name: z.string(),
  inputSchema: z.any(),
  outputSchema: z.any(),
  policies: z.array(z.any()).optional(),
  maxConcurrency: z.number().optional(),
  triggers: zTriggers.optional(),
});

export type CapabilityManifest = z.infer<typeof zCapabilityManifest>;

export type RegistryEntry = {
  manifest: CapabilityManifest;
  path: URL;
  
};

export class Registry<T extends RegistryEntry = RegistryEntry> {
  private readonly entries = new Map<string, T>();

  list(): T[] {
    return [...this.entries.values()];
  }

  get(name: string): T | undefined {
    return this.entries.get(name);
  }

  unregister(name: string): boolean {
    return this.entries.delete(name);
  }

  register(capability: T): void {
    if (capability.manifest.name in this.entries) {
      throw new Error(`Duplicate capability: ${capability.manifest.name}`);
    }
    this.entries.set(capability.manifest.name, capability);
  }
}

export async function discoverCapabilities<Input, Output>(
  options: {
    globPattern: string;
    root: string;
    exclude?: string[];
  },
): Promise<
  RegistryEntry[]
> {
  const discovered: RegistryEntry[] = [];

  for await (
    const file of expandGlob(options.globPattern, {
      root: options.root,
      includeDirs: false,
      exclude: options.exclude,
    })
  ) {
    const capabilityModule = toFileUrl(file.path);

    const sdkPath = Deno.cwd();
    const launcherPath = `${sdkPath}/app/utils/capabilityLauncher.ts`;

    const cmd = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "-E",
        "--config",
        `${sdkPath}/deno.json`,
        `--allow-read=${sdkPath}`,
        `--allow-read=${sdkPath}/../interfaces`,
        launcherPath,
      ],
      env: {
        MYCELIA_CAPABILITY_PATH: capabilityModule.toString(),
      },
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    });

    const child = cmd.spawn();

    let stdoutContent = "";
    let stderrContent = "";

    const stdoutReader = child.stdout.getReader();
    const stderrReader = child.stderr.getReader();

    const readStdout = async () => {
      while (true) {
        const { done, value } = await stdoutReader.read();
        if (done) break;
        stdoutContent += new TextDecoder().decode(value);
      }
    };

    const readStderr = async () => {
      while (true) {
        const { done, value } = await stderrReader.read();
        if (done) break;
        stderrContent += new TextDecoder().decode(value);
      }
    };

    await Promise.all([readStdout(), readStderr()]);

    const { code } = await child.status;

    if (code !== 0) {
      console.error(`Failed to discover capability: ${stderrContent}`);
      continue;
    }

    // Find the last line of output which should be the JSON result
    const lines = stdoutContent.trim().split("\n");
    const lastLine = lines[lines.length - 1];

    try {
      const resp = JSON.parse(lastLine);
      const manifest = zCapabilityManifest.parse(resp);
      
      // Ensure we have schemas before attempting to use them
      if (manifest.inputSchema) {
        z.fromJSONSchema(manifest.inputSchema);
      }
      if (manifest.outputSchema) {
        z.fromJSONSchema(manifest.outputSchema);
      }
      
      discovered.push({ manifest, path: capabilityModule });
    } catch (err) {
      console.error(`Failed to parse worker output: ${lastLine} ${err}`);
    }
  }

  return discovered;
}
