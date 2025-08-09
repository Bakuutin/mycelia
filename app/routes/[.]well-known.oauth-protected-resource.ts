import type { LoaderFunctionArgs } from "@remix-run/node";
import {
  buildProtectedResourceMetadata,
  protectedResourceMetadataSchema,
} from "@/lib/auth/oauth.ts";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const origin = url.origin;
  const body = buildProtectedResourceMetadata(origin);
  const parsed = protectedResourceMetadataSchema.safeParse(body);
  if (!parsed.success) {
    return new Response("Server configuration invalid", { status: 500 });
  }
  return Response.json(parsed.data, { status: 200 });
}
