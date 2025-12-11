import type { Platform } from "../core/types.ts";
import { defaultPlatform } from "./default.tsx";
import { Sparkles } from "lucide-react";

export const myceliaPlatform: Platform = {
  ...defaultPlatform,
  id: "mycelia",
  name: "Mycelia",
  icon: Sparkles, 
};

