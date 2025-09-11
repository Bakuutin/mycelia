import { LoaderFunctionArgs } from "@remix-run/node";
import { Outlet, useLoaderData } from "@remix-run/react";
import { Auth, authenticateOrRedirect } from "../../lib/auth/core.server.ts";
import React from "react";

export async function loader({ request }: LoaderFunctionArgs) {
  const auth = await authenticateOrRedirect(request);
  return { auth };
}

export default function Layout() {
  const { auth } = useLoaderData<{ auth: Auth }>();

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      Hello {auth.principal}
    </div>
  );
}
