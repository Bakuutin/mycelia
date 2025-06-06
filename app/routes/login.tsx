import React from "react";
import { ActionFunction, redirect } from "@remix-run/node";
import { Form, useActionData } from "@remix-run/react";
import { authCookie, verifyToken } from "../lib/auth/core.server.ts";

import { Button } from "@/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import {
  exchangeApiKeyForAccessToken,
  verifyApiKey,
} from "@/lib/auth/tokens.ts";

export const action: ActionFunction = async ({ request }) => {
  const formData = await request.formData();
  const token = formData.get("token");

  if (typeof token !== "string" || token.length === 0) {
    return { error: "Token is required" };
  }

  const key = await exchangeApiKeyForAccessToken(token, "30 days");
  if (!key) {
    return { error: "Invalid token" };
  }

  return redirect("/", {
    headers: { "Set-Cookie": await authCookie.serialize(key) },
  });
};

export default function Login() {
  const actionData = useActionData<{ error?: string }>();

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">Login</CardTitle>
              <CardDescription>
                Enter your token below to login to your account
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Form method="post">
                <div className="flex flex-col gap-6">
                  <div className="grid gap-2">
                    <Label htmlFor="token">
                      {actionData?.error
                        ? (
                          <span className="text-red-500">
                            {actionData.error}
                          </span>
                        )
                        : "Token"}
                    </Label>
                    <Input
                      id="token"
                      type="password"
                      name="token"
                      className={actionData?.error ? "border-red-500" : ""}
                    />
                  </div>
                  <Button type="submit" className="w-full">
                    Login
                  </Button>
                </div>
                <div className="mt-4 text-center text-sm">
                  Don&apos;t have an account?{" "}
                  <a
                    href="https://tigor.net"
                    className="underline underline-offset-4"
                  >
                    Ask Tigor
                  </a>
                </div>
              </Form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
