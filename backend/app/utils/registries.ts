import { expandGlob } from "@std/fs";
import { toFileUrl } from "@std/path";

export interface Capability<Input, Output> {
  name: string;
  use: (input: Input) => Promise<Output>;
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
    if (capability.name in this.entries) {
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
    if (
        mod && 
        typeof mod === "object" &&
        "name" in mod &&
        "use" in mod &&
        typeof mod.name === "string" &&
        typeof mod.use === "function"
    ) {
      discovered.push(mod);
    } else {
      console.warn(`Invalid capability module: ${file.path}`);
    }
  }
  return discovered;
}
