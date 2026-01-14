import { useMemo } from "react";
import type { Message } from "@myceliasdk/messengers.ts";
import { registry } from "./registry.ts";

export function useMessageRenderer(message: Message) {
  const platformId = message.platform || "default";
  
  const platform = useMemo(() => {
    return registry.get(platformId) || registry.getDefault();
  }, [platformId]);

  return platform?.MessageComponent;
}

export function usePlatform(platformId?: string) {
  return useMemo(() => {
    if (!platformId) return registry.getDefault();
    return registry.get(platformId) || registry.getDefault();
  }, [platformId]);
}

