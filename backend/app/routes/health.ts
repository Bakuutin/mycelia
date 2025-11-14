import type { LoaderFunctionArgs } from "@remix-run/node";

export async function loader({ request }: LoaderFunctionArgs) {
  return Response.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  }, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
}
