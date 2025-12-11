import type { Platform } from "../core/types.ts";
import { defaultPlatform } from "./default.tsx";
import { Shield } from "lucide-react";

export const signalPlatform: Platform = {
  ...defaultPlatform,
  id: "signal",
  name: "Signal",
  icon: Shield, // Using Shield icon as a placeholder for Signal
};

