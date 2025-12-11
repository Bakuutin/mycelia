import type { Platform } from "./types.ts";

class PlatformRegistry {
  private platforms: Map<string, Platform> = new Map();
  private defaultPlatformId: string = "default";

  register(platform: Platform) {
    this.platforms.set(platform.id, platform);
  }

  get(id: string): Platform | undefined {
    return this.platforms.get(id);
  }

  getAll(): Platform[] {
    return Array.from(this.platforms.values());
  }

  setDefault(id: string) {
    if (this.platforms.has(id)) {
      this.defaultPlatformId = id;
    }
  }

  getDefault(): Platform | undefined {
    return this.platforms.get(this.defaultPlatformId);
  }
}

export const registry = new PlatformRegistry();

