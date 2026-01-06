import { expandGlob } from "@std/fs";
import { toFileUrl } from "@std/path";

export interface Capability<Input, Output> {
  name: string;
  use: (input: Input) => Promise<Output>;
  /** Optional trigger configuration */
  trigger?: any;
  /** Optional maximum concurrency (e.g. for singleton workers) */
  maxConcurrency?: number;
}

export class Registry<Input, Output, C extends Capability<Input, Output>> {
  private readonly entries = new Map<string, C>();

  list(): C[] {
    return [...this.entries.values()];
  }

  get(name: string): C | undefined {
    return this.entries.get(name);
  }

  unregister(name: string): boolean {
    return this.entries.delete(name);
  }

  register(capability: C): void {
    if (this.entries.has(capability.name)) {
      throw new Error(`Duplicate registry entry: ${capability.name}`);
    }
    this.entries.set(capability.name, capability);
  }
}


export async function discoverCapabilities<Input, Output>(
  globPattern: string,
  root: string,
  exclude: string[] = [],
): Promise<
  Capability<Input, Output>[]
> {
  const discovered: Capability<Input, Output>[] = [];

  for await (
    const file of expandGlob(globPattern, { root, includeDirs: false, exclude })
  ) {
    const mod = await import(toFileUrl(file.path).href);
    const cap = mod.default || mod;

    if (
        cap && 
        typeof cap === "object" &&
        "name" in cap &&
        "use" in cap &&
        typeof cap.name === "string" &&
        typeof cap.use === "function"
    ) {
      discovered.push(cap as Capability<Input, Output>);
    } else {
      console.warn(`Invalid capability module: ${file.path}`);
    }
  }
  return discovered;
}
