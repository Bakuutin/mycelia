import { ActionFunction } from "@remix-run/node";
import { exchangeApiKeyForAccessToken } from "@/lib/auth/tokens.ts";

export const action: ActionFunction = async ({ request }) => {
  const body = await request.json();
  const token = body.token;

  const { jwt, error } = await exchangeApiKeyForAccessToken(token);
  if (error) {
    return { error };
  }

  return Response.json({ jwt });
};
