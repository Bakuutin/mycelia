import { ActionFunction, redirect } from "@remix-run/node";
import { Form, useActionData } from "@remix-run/react";
import { authCookie, verifyToken } from "~/lib/auth.server";

import { Button } from "~/components/ui/button"
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "~/components/ui/card"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"


export let action: ActionFunction = async ({ request }) => {
    let formData = await request.formData();
    let token = formData.get("token");

    if (typeof token !== "string" || token.length === 0) {
        return { error: "Token is required" }
    }

    const auth = verifyToken(token);
    if (!auth) {
        return { error: "Invalid token" }
    }

    return redirect("/", {
        headers: { "Set-Cookie": await authCookie.serialize(token) }
    });
};


export default function Login() {
    let actionData = useActionData<{ error?: string }>();

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
                                        <Label htmlFor="token">Token</Label>
                                        <Input id="token" type="password" name="token" className={ actionData?.error ? 
                                            "border-red-500" : ""
                                         } />
                                    </div>
                                    <Button type="submit" className="w-full">
                                        Login
                                    </Button>
                                </div>
                                <div className="mt-4 text-center text-sm">
                                    Don&apos;t have an account?{" "}
                                    <a href="https://tigor.net" className="underline underline-offset-4">
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