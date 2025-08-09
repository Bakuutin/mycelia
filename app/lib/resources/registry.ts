import { Resource } from "@/lib/auth/resources.ts";
import { defaultResourceManager } from "@/lib/auth/resources.ts";
import { MyceliaResourceMCPServer, createMCPServerFromResourceManager } from "@/lib/mcp/server.ts";
import { Auth } from "@/lib/auth/core.server.ts";

export interface ResourceEntry {
  // Dynamic import path to the resource class
  module: string;
  // Export name from the module (default: "default")
  export?: string;
  // Resource constructor arguments (if any)
  args?: any[];
  // Whether this resource is enabled
  enabled?: boolean;
}

export interface ResourceRegistryConfig {
  resources: ResourceEntry[];
  // Custom modules that provide additional resources
  customModules?: string[];
}

// Default resource configuration
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

export async function loadResourceConfig(configPath?: string): Promise<ResourceRegistryConfig> {
  // Default to config.ts if no path specified  
  const configToLoad = configPath || "./config.ts";

  try {
    const config = await import(configToLoad);
    // Look for resources config in the imported config
    const resourceConfig = config.resources || config.resourceConfig || config.default?.resources;
    
    if (resourceConfig) {
      return {
        ...DEFAULT_RESOURCE_CONFIG,
        ...resourceConfig,
      };
    }
    
    // If no resources config found, use defaults
    return DEFAULT_RESOURCE_CONFIG;
  } catch (error) {
    if (configPath) {
      // If a specific config was requested but failed, warn and use defaults
      console.warn(`Failed to load resource config from ${configPath}, using defaults:`, error);
    }
    // If config.ts doesn't exist or doesn't have resources, use defaults silently
    return DEFAULT_RESOURCE_CONFIG;
  }
}

export async function registerResourcesFromConfig(config: ResourceRegistryConfig): Promise<void> {
  // Register main resources
  for (const entry of config.resources) {
    if (entry.enabled === false) {
      continue;
    }

    try {
      const module = await import(entry.module);
      const ResourceClass = module[entry.export || "default"];
      
      if (!ResourceClass) {
        console.warn(`Resource class '${entry.export || "default"}' not found in module '${entry.module}'`);
        continue;
      }

      const resourceInstance = entry.args 
        ? new ResourceClass(...entry.args)
        : new ResourceClass();

      defaultResourceManager.registerResource(resourceInstance);
      console.log(`Registered resource: ${resourceInstance.code || ResourceClass.name}`);
    } catch (error) {
      console.error(`Failed to load resource from ${entry.module}:`, error);
    }
  }

  // Load custom modules
  if (config.customModules) {
    for (const modulePath of config.customModules) {
      try {
        const customModule = await import(modulePath);
        
        // Custom modules can export a `registerResources` function
        if (typeof customModule.registerResources === "function") {
          await customModule.registerResources(defaultResourceManager);
          console.log(`Loaded custom module: ${modulePath}`);
        } else if (customModule.default && typeof customModule.default.registerResources === "function") {
          await customModule.default.registerResources(defaultResourceManager);
          console.log(`Loaded custom module: ${modulePath}`);
        } else {
          console.warn(`Custom module ${modulePath} does not export 'registerResources' function`);
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

// Create MCP server for all registered resources
export function createMCPServer(auth: Auth): MyceliaResourceMCPServer {
  return createMCPServerFromResourceManager(defaultResourceManager, auth);
}

// Create admin MCP server (for CLI usage)
export function createAdminMCPServer(): MyceliaResourceMCPServer {
  const adminAuth = new Auth({
    principal: "admin",
    policies: [{
      action: "*",
      resource: "**",
      effect: "allow",
    }],
  });
  
  return createMCPServer(adminAuth);
}

// Get list of all available MCP tools
export async function listAvailableMCPTools(): Promise<string[]> {
  const server = createAdminMCPServer();
  const tools = await server.listTools();
  return tools.map(tool => tool.name);
}