import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticateOr401 } from "@/lib/auth/core.server.ts";
import { defaultResourceManager } from "@/lib/auth/resources.ts";
import { EJSON } from "bson";
import { tracer, requestCounter } from "@/lib/telemetry.ts";

export async function action({ request, params }: ActionFunctionArgs) {
  const toolName = params.name;
  
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  if (!toolName) {
    return Response.json({
      success: false,
      error: "Tool name is required",
    }, { status: 400 });
  }

  return tracer.startActiveSpan(`api.resource.${toolName}`, async (span) => {
    try {
      span.setAttributes({
        "tool.name": toolName,
        "http.method": request.method,
        "http.url": request.url,
      });

      requestCounter.add(1, { tool: toolName, method: "POST" });

      const auth = await authenticateOr401(request);
      span.setAttributes({
        "auth.principal": auth.principal,
      });
      
      const body = await request.json();
      const resource = defaultResourceManager.listResources().find((r) =>
        r.code === toolName
      );

      if (!resource) {
        span.setAttributes({
          "error": true,
          "error.message": `Tool '${toolName}' not found`,
        });
        return Response.json({
          success: false,
          error: `Tool '${toolName}' not found`,
        }, { status: 404 });
      }

      const run = await defaultResourceManager.getResource(toolName, auth);
      const deserializedBody = EJSON.deserialize(body);
      
      let result: Response | any = await run(deserializedBody);

      if (!(result instanceof Response)) {
        result = Response.json(EJSON.serialize(result));
      }

      
      span.setAttributes({
        "success": true,
      });
      
      return result;
    } catch (error) {
      span.setAttributes({
        "error": true,
        "error.message": error instanceof Error ? error.message : "Unknown error",
      });

      if (error instanceof Response) {
        return Response.json({
          success: false,
          error: "Invalid parameters",
        }, { status: 400 });
      }

      return Response.json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }, { status: 500 });
    } finally {
      span.end();
    }
  });
}
