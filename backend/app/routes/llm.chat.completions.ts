import type { Request, Response as ExpressResponse } from "express";
import { authenticateOr401 } from "@/lib/auth/core.server.ts";
import { getLLMResource } from "@/lib/llm/resource.server.ts";
import { asyncHandler } from "@/middleware/asyncHandler.ts";

export const llmChatCompletionsHandler = asyncHandler(
  async (req: Request, res: ExpressResponse) => {
    const auth = await authenticateOr401(req, res);
    const body = req.body;

    const llmResource = await getLLMResource(auth);

    const result = await llmResource({
      action: "completions",
      ...body,
    });

    if (result instanceof Response) {
      const responseBody = await result.json();
      res.status(result.status).json(responseBody);
      return;
    }

    res.json(result);
  },
);
