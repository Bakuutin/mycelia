import { ActionFunctionArgs } from "@remix-run/node";
import { authenticateOr401 } from "@/lib/auth/core.server.ts";
import { getLLMResource } from "@/lib/llm/resource.server.ts";

export async function action({ request }: ActionFunctionArgs) {
  const auth = await authenticateOr401(request);

  const body = await request.json();

  try {
    const llmResource = await getLLMResource(auth);

    const result = await llmResource({
      action: "completions",
      ...body,
    });

    // Check if result is a streaming Response
    if (result instanceof Response) {
      return result;
    }

    return Response.json(result);
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    console.error("Error processing LLM request:", error);
    return Response.json(
      {
        error: {
          message: `Processing error: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
          type: "server_error",
          code: "processing_error",
        },
      },
      { status: 500 },
    );
  }
}
