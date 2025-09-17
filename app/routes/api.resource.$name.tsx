import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticateOr401 } from "@/lib/auth/core.server.ts";
import { defaultResourceManager } from "@/lib/auth/resources.ts";
import { EJSON } from "bson";

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const toolName = params.name;
  if (!toolName) {
    return Response.json({
      success: false,
      error: "Tool name is required",
    }, { status: 400 });
  }

  try {
    const auth = await authenticateOr401(request);
    const body = await request.json();

    const resource = defaultResourceManager.listResources().find((r) =>
      r.code === toolName
    );

    if (!resource) {
      return Response.json({
        success: false,
        error: `Tool '${toolName}' not found`,
      }, { status: 404 });
    }

    try {
      const run = await defaultResourceManager.getResource(toolName, auth);
      const result = await run(EJSON.deserialize(body));
      return Response.json(EJSON.serialize(result));
    } catch (error) {
      if (error instanceof Response) {
        return Response.json({
          success: false,
          error: "Invalid parameters",
        }, { status: 400 });
      }
      throw error;
    }
  } catch (error) {
    console.error(`Tool call failed for ${toolName}:`, error);

    if (error instanceof Response) {
      return error;
    }

    return Response.json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }, { status: 500 });
  }
}