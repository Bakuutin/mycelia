import { z } from "zod";

export const zIcon = z.union([
  z.object({
    text: z.string(),
  }),
  z.object({
    base64: z.string(),
  }),
]).optional();

export type Icon = z.infer<typeof zIcon>;
