import { Resource } from "@/lib/auth/resources.ts";
import { defaultResourceManager } from "@/lib/auth/resources.ts";
import { handleMCPRequest } from "../mcp/mcp.server.ts";
import { Auth } from "@/lib/auth/core.server.ts";

export interface ResourceEntry {
  module: string;
  export?: string;
  args?: any[];
  enabled?: boolean;
}

export interface ResourceRegistryConfig {
  resources: ResourceEntry[];
  customModules?: string[];
}

export const DEFAULT_RESOURCE_CONFIG: ResourceRegistryConfig = {
  resources: [
    {
      module: "@/lib/mongo/core.server.ts",
      export: "MongoResource",
      enabled: true,
    },
    {
      module: "@/lib/mongo/fs.server.ts",
      export: "FsResource",
      enabled: true,
    },
    {
      module: "@/lib/kafka/index.ts",
      export: "KafkaResource",
      enabled: true,
    },
    {
      module: "@/lib/redis.ts",
      export: "RedisResource",
      enabled: true,
    },
    {
      module: "@/lib/timeline/resource.server.ts",
      export: "TimelineResource",
      enabled: true,
    },
  ],
  customModules: [],
};

export async function loadResourceConfig(
  configPath?: string,
): Promise<ResourceRegistryConfig> {
  const configToLoad = configPath || "./config.ts";

  try {
    const cfgModule = await import(configToLoad);

    const resourcesFromConfig: ResourceRegistryConfig | undefined =
      (cfgModule.resources as ResourceRegistryConfig) ||
      (cfgModule.resourceConfig as ResourceRegistryConfig) ||
      (cfgModule.config?.resources as ResourceRegistryConfig);

    if (resourcesFromConfig) {
      return {
        ...DEFAULT_RESOURCE_CONFIG,
        ...resourcesFromConfig,
        resources: resourcesFromConfig.resources?.length
          ? resourcesFromConfig.resources
          : DEFAULT_RESOURCE_CONFIG.resources,
      };
    }

    return DEFAULT_RESOURCE_CONFIG;
  } catch (_error) {
    if (configPath) {
      console.warn(
        `Failed to load resource config from ${configPath}, using defaults:`,
        _error,
      );
    }
    return DEFAULT_RESOURCE_CONFIG;
  }
}

export async function registerResourcesFromConfig(
  config: ResourceRegistryConfig,
): Promise<void> {
  for (const entry of config.resources) {
    if (entry.enabled === false) {
      continue;
    }

    try {
      const module = await import(entry.module);
      const ResourceClass = module[entry.export || "default"];

      if (!ResourceClass) {
        throw new Error(
          `Resource class '${
            entry.export || "default"
          }' not found in module '${entry.module}'`,
        );
      }

      const resourceInstance = entry.args
        ? new ResourceClass(...entry.args)
        : new ResourceClass();

      defaultResourceManager.registerResource(resourceInstance);
      console.log(
        `Registered resource: ${resourceInstance.code || ResourceClass.name}`,
      );
      console.log(
        `Resources: ${defaultResourceManager.listResources().length}`,
      );
    } catch (error) {
      console.error(`Failed to load resource from ${entry.module}:`, error);
    }
  }

  if (config.customModules && config.customModules.length > 0) {
    for (const modulePath of config.customModules) {
      try {
        const customModule = await import(modulePath);

        if (typeof customModule.registerResources === "function") {
          await customModule.registerResources(defaultResourceManager);
          console.log(`Loaded custom module: ${modulePath}`);
        } else if (
          customModule.default &&
          typeof customModule.default.registerResources === "function"
        ) {
          await customModule.default.registerResources(defaultResourceManager);
          console.log(`Loaded custom module: ${modulePath}`);
        } else {
          console.warn(
            `Custom module ${modulePath} does not export 'registerResources' function`,
          );
        }
      } catch (error) {
        console.error(`Failed to load custom module ${modulePath}:`, error);
      }
    }
  }
}

export async function setupResources(configPath?: string): Promise<void> {
  const config = await loadResourceConfig(configPath);
  await registerResourcesFromConfig(config);
}


export { handleMCPRequest };
