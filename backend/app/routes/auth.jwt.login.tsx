/**
 * Friend-Lite compatible JWT login endpoint.
 */

import type { ActionFunctionArgs } from "@remix-run/node";
import { action as tokenAction } from "@/routes/oauth.token.ts";

export async function action(args: ActionFunctionArgs) {
  return tokenAction(args);
}
