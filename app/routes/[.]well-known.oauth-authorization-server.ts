import type { LoaderFunctionArgs } from "@remix-run/node";
import {
  authorizationServerMetadataSchema,
  buildAuthorizationServerMetadata,
} from "@/lib/auth/oauth.ts";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const origin = url.origin;
  const body = buildAuthorizationServerMetadata(origin);
  const parsed = authorizationServerMetadataSchema.safeParse(body);
  if (!parsed.success) {
    return new Response("Server configuration invalid", { status: 500 });
  }
  return Response.json(parsed.data, { status: 200 });
}
