export interface MCPConfig {
  supportedProtocolVersions: string[];
  defaultProtocolVersion: string;
  enableSSE: boolean;
}

export const DEFAULT_MCP_CONFIG: MCPConfig = {
  supportedProtocolVersions: ["2025-03-26", "2024-11-05"],
  defaultProtocolVersion: "2025-03-26",
  enableSSE: true,
};

export function getMCPConfig(): MCPConfig {
  return DEFAULT_MCP_CONFIG;
}

export function validateProtocolVersion(
  version: string | null,
  config: MCPConfig,
): string | null {
  if (!version) return config.defaultProtocolVersion;
  return config.supportedProtocolVersions.includes(version) ? version : null;
}
