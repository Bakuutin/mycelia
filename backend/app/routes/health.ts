import type { Request, Response } from "express";
import { getServerConfig } from "@/lib/config/serverConfig.server.ts";

export async function rootHandler(_req: Request, res: Response) {
  res.json({
    message: "Mycelia API is running 🍄",
  });
}

// Cache connectivity check results for 30 seconds
let connectivityCache: {
  internet: boolean;
  llm: boolean | null; // null = no provider configured
  checkedAt: number;
} | null = null;

const CONNECTIVITY_CACHE_TTL_MS = 30_000;

async function checkConnectivity(): Promise<{ internet: boolean; llm: boolean | null }> {
  const now = Date.now();
  
  // Return cached result if still valid
  if (connectivityCache && (now - connectivityCache.checkedAt) < CONNECTIVITY_CACHE_TTL_MS) {
    return { internet: connectivityCache.internet, llm: connectivityCache.llm };
  }

  let internet = false;
  let llm: boolean | null = null; // null means no provider configured

  // Check internet connectivity via DNS/simple fetch
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    // Use a reliable public endpoint for internet check
    const response = await fetch("https://dns.google/resolve?name=example.com&type=A", {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    internet = response.ok;
  } catch {
    internet = false;
  }

  // Check LLM provider connectivity if internet is available
  if (internet) {
    try {
      const config = await getServerConfig();
      const provider = config?.inferenceProvider;
      
      if (provider?.baseUrl) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        // Normalize base URL - just get the host part for a simple HEAD request
        let baseUrl = provider.baseUrl.replace(/\/$/, "");
        
        // Try a simple HEAD request to the base URL (not /v1/models which may not exist)
        const response = await fetch(baseUrl, {
          method: "HEAD",
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        // Consider reachable if we get any response (even 4xx means server is up)
        llm = response.status < 500;
      } else {
        // No provider configured - that's fine, just means LLM not set up
        llm = null;
      }
    } catch (err) {
      // Network error - provider is configured but unreachable
      console.log("[health] LLM connectivity check failed:", err instanceof Error ? err.message : String(err));
      llm = false;
    }
  }

  // Update cache
  connectivityCache = { internet, llm, checkedAt: now };

  return { internet, llm };
}

export async function healthHandler(_req: Request, res: Response) {
  const connectivity = await checkConnectivity();
  
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    connectivity: {
      internet: connectivity.internet,
      llm: connectivity.llm,
    },
  });
}
