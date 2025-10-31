import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { Auth, authenticateOrRedirect } from "../../lib/auth/core.server.ts";
import React from "react";
import { generateApiKey } from "@/lib/auth/tokens.ts";
import { Button } from "@/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Loader2 } from "lucide-react";
import { EJSON, ObjectId } from "bson";
import { getMongoResource } from "@/lib/mongo/core.server.ts";
import { z } from "zod";
import type { Policy } from "@/lib/auth/resources.ts";
import { defaultResourceManager } from "@/lib/auth/resources.ts";

const simplePolicySchema = z.object({
  resource: z.string(),
  action: z.string(),
  effect: z.enum(["allow", "deny"]),
});

const modifyPolicySchema = z.object({
  resource: z.string(),
  action: z.string(),
  effect: z.literal("modify"),
  middleware: z.object({
    code: z.string(),
    arg: z.any().optional(),
  }),
});

const policySchema = z.union([simplePolicySchema, modifyPolicySchema]);
const policiesSchema = z.array(policySchema);
const defaultPolicies: Policy[] = [{
  resource: "**",
  action: "*",
  effect: "allow",
}];

export async function loader({ request }: LoaderFunctionArgs) {
  const auth = await authenticateOrRedirect(request);
  const mongo = await getMongoResource(auth);
  const keys = await mongo({
    action: "find",
    collection: "api_keys",
    query: { isActive: true },
    options: { sort: { createdAt: -1 } },
  });
  return EJSON.serialize({ auth, keys });
}

export async function action({ request }: ActionFunctionArgs) {
  const auth = await authenticateOrRedirect(request);
  const mongo = await getMongoResource(auth);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "create") {
    const name = (formData.get("name") || "Unnamed Key") as string;
    const policiesText = (formData.get("policies") as string) || "";
    let policies: Policy[];
    if (policiesText.trim().length === 0) {
      policies = defaultPolicies;
    } else {
      try {
        const parsed = JSON.parse(policiesText);
        policies = policiesSchema.parse(parsed) as Policy[];
      } catch (_) {
        return { error: "Invalid policies JSON" } as const;
      }
    }
    const key = await generateApiKey(auth.principal, name, policies);
    return { created: key } as const;
  }

  if (intent === "revoke") {
    const id = formData.get("id") as string;
    if (!id) return { error: "Missing id" } as const;
    await mongo({
      action: "updateOne",
      collection: "api_keys",
      query: { _id: new ObjectId(id) },
      update: { $set: { isActive: false } },
    });

    return { revoked: true } as const;
  }

  if (intent === "update") {
    const id = formData.get("id") as string;
    const name = (formData.get("name") || "Unnamed Key") as string;
    const policiesText = (formData.get("policies") as string) || "";
    if (!id) return { error: "Missing id" } as const;
    let policies: Policy[];
    if (policiesText.trim().length === 0) {
      policies = defaultPolicies;
    } else {
      try {
        const parsed = JSON.parse(policiesText);
        policies = policiesSchema.parse(parsed) as Policy[];
      } catch (_) {
        return { error: "Invalid policies JSON" } as const;
      }
    }
    await mongo({
      action: "updateOne",
      collection: "api_keys",
      query: { _id: new ObjectId(id) },
      update: { $set: { name, policies } },
    });
    return { updated: true } as const;
  }

  if (intent === "recalculate-timeline") {
    const recalculateAll = formData.get("recalculateAll") === "true";
    const startStr = formData.get("start") as string;
    const endStr = formData.get("end") as string;

    console.log("Timeline recalculation requested:", { recalculateAll, startStr, endStr });

    try {
      const timelineResource = await defaultResourceManager.getResource(
        "tech.mycelia.timeline",
        auth
      );

      const requestData: any = { action: "recalculate" };

      if (recalculateAll) {
        requestData.all = true;
      } else {
        if (startStr) requestData.start = startStr;
        if (endStr && endStr !== "now") {
          requestData.end = endStr;
        }
      }

      console.log("Calling timeline resource with:", requestData);
      const result = await timelineResource(requestData);
      console.log("Timeline recalculation completed:", result);

      return { timelineRecalculated: result } as const;
    } catch (error) {
      console.error("Timeline recalculation error:", error);
      return { error: error instanceof Error ? error.message : "Timeline recalculation failed" } as const;
    }
  }

  return { error: "Unknown action" } as const;
}

export default function Layout() {
  const [timeRange, setTimeRange] = React.useState<"all" | "preset" | "custom">("preset");
  const [presetRange, setPresetRange] = React.useState("7d");
  const navigation = useNavigation();

  const isRecalculating = navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "recalculate-timeline";

  const { auth, keys } = useLoaderData<
    {
      auth: Auth;
      keys: Array<
        {
          _id: { $oid: string } | string;
          name: string;
          createdAt: { $date: string };
          isActive: boolean;
          openPrefix: string;
          policies: Policy[];
        }
      >;
    }
  >();
  const actionData = useActionData<
    {
      created?: string;
      revoked?: boolean;
      updated?: boolean;
      timelineRecalculated?: { success: boolean; duration: string; message: string };
      error?: string;
    }
  >();

  return (
    <div className="flex flex-1 flex-col p-4 pt-0">
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <div className="flex items-baseline justify-between">
          <div className="text-xl font-semibold">Settings</div>
          <div className="text-sm text-gray-400">{auth.principal}</div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Timeline Management</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4">
              <div className="text-sm text-gray-400">
                Recalculate timeline histograms to update visualization data. This process updates the timeline charts from your selected time period up to now.
              </div>

              <Form method="post" className="flex flex-col gap-4">
                <input type="hidden" name="intent" value="recalculate-timeline" />

                <div className="grid gap-3">
                  <Label>Time Range</Label>

                  <div className="flex flex-col gap-2">
                    <Label className="flex items-center gap-2 font-normal">
                      <input
                        type="radio"
                        name="rangeType"
                        value="preset"
                        checked={timeRange === "preset"}
                        onChange={(e) => e.target.checked && setTimeRange("preset")}
                        className="rounded-full"
                      />
                      Quick select
                    </Label>

                    {timeRange === "preset" && (
                      <select
                        name="preset"
                        value={presetRange}
                        onChange={(e) => setPresetRange(e.target.value)}
                        className="ml-6 rounded-md border bg-background p-2 text-sm"
                      >
                        <option value="1d">Last 24 hours → now</option>
                        <option value="7d">Last 7 days → now</option>
                        <option value="30d">Last 30 days → now</option>
                        <option value="90d">Last 3 months → now</option>
                        <option value="1y">Last year → now</option>
                      </select>
                    )}
                  </div>

                  <div className="flex flex-col gap-2">
                    <Label className="flex items-center gap-2 font-normal">
                      <input
                        type="radio"
                        name="rangeType"
                        value="all"
                        checked={timeRange === "all"}
                        onChange={(e) => e.target.checked && setTimeRange("all")}
                        className="rounded-full"
                      />
                      All time (everything in database → now)
                    </Label>
                  </div>

                  <div className="flex flex-col gap-2">
                    <Label className="flex items-center gap-2 font-normal">
                      <input
                        type="radio"
                        name="rangeType"
                        value="custom"
                        checked={timeRange === "custom"}
                        onChange={(e) => e.target.checked && setTimeRange("custom")}
                        className="rounded-full"
                      />
                      Custom range
                    </Label>

                    {timeRange === "custom" && (
                      <div className="ml-6 grid gap-3">
                        <div className="grid gap-2">
                          <Label htmlFor="start" className="text-sm">
                            From (how far back)
                          </Label>
                          <Input
                            id="start"
                            name="start"
                            placeholder="e.g. 7d, 1month, 2024-01-01"
                          />
                          <span className="text-xs text-gray-500">
                            Use relative time (7d, 30d, 1month) or ISO date
                          </span>
                        </div>

                        <div className="grid gap-2">
                          <Label htmlFor="end" className="text-sm">
                            To (usually "now")
                          </Label>
                          <Input
                            id="end"
                            name="end"
                            placeholder="now or 2024-12-31"
                            defaultValue="now"
                          />
                          <span className="text-xs text-gray-500">
                            Leave as "now" or specify end date
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <input
                  type="hidden"
                  name="recalculateAll"
                  value={timeRange === "all" ? "true" : "false"}
                />
                {timeRange === "preset" && (
                  <>
                    <input type="hidden" name="start" value={presetRange} />
                    <input type="hidden" name="end" value="now" />
                  </>
                )}

                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <Button type="submit" disabled={isRecalculating}>
                      {isRecalculating && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      )}
                      {isRecalculating ? "Recalculating..." : "Recalculate Timeline"}
                    </Button>
                    {!isRecalculating && (
                      <span className="text-xs text-gray-500">
                        {timeRange === "all" && "Will process all data"}
                        {timeRange === "preset" && `Will process ${presetRange === "1d" ? "last 24 hours" : presetRange === "7d" ? "last 7 days" : presetRange === "30d" ? "last 30 days" : presetRange === "90d" ? "last 3 months" : "last year"}`}
                        {timeRange === "custom" && "Will process custom range"}
                      </span>
                    )}
                  </div>
                </div>
              </Form>

              {isRecalculating && (
                <div className="rounded border bg-blue-500/10 border-blue-500/20 p-3">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                    <div className="text-sm text-blue-600">
                      Processing timeline histograms...
                    </div>
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {timeRange === "all" && "Recalculating all data. This may take a while."}
                    {timeRange === "preset" && `Recalculating ${presetRange === "1d" ? "last 24 hours" : presetRange === "7d" ? "last 7 days" : presetRange === "30d" ? "last 30 days" : presetRange === "90d" ? "last 3 months" : "last year"} of data.`}
                    {timeRange === "custom" && "Recalculating custom range. This may take a while."}
                  </div>
                </div>
              )}

              {actionData?.timelineRecalculated && !isRecalculating && (
                <div className="rounded border bg-emerald-500/10 border-emerald-500/20 p-3">
                  <div className="text-sm text-emerald-600">
                    ✓ {actionData.timelineRecalculated.message}
                  </div>
                  <div className="text-xs text-gray-400 mt-1">
                    Completed in {actionData.timelineRecalculated.duration}
                  </div>
                </div>
              )}

              {actionData?.error && !isRecalculating && (
                <div className="rounded border bg-red-500/10 border-red-500/20 p-3">
                  <div className="text-sm text-red-600">
                    ✗ Error: {actionData.error}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Create API Key</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4">
              <Form method="post" className="flex flex-col gap-3">
                <input type="hidden" name="intent" value="create" />
                <div className="grid gap-2">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    name="name"
                    placeholder="e.g. cli, dev, integration"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="policies">Policies JSON</Label>
                  <textarea
                    id="policies"
                    name="policies"
                    defaultValue={JSON.stringify(defaultPolicies, null, 2)}
                    className="min-h-28 w-full rounded-md border bg-background p-2 font-mono text-xs"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Button type="submit">Create</Button>
                  {actionData?.error && (
                    <span className="text-xs text-red-500">
                      {actionData.error}
                    </span>
                  )}
                </div>
              </Form>

              {actionData?.created && (
                <div className="rounded border bg-muted/40 p-3">
                  <div className="text-xs text-gray-400 mb-1">
                    New key (copy now, it won’t be shown again)
                  </div>
                  <div className="text-sm font-mono break-all">
                    {actionData.created}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Existing API Keys</CardTitle>
          </CardHeader>
          <CardContent>
            {keys.length === 0
              ? <div className="text-sm text-gray-400">No keys yet.</div>
              : (
                <ul className="divide-y rounded border">
                  {keys.map((k, idx) => {
                    const id = typeof k._id === "string"
                      ? k._id
                      : (k._id as any)?.$oid ?? "";
                    const created = new Date(k.createdAt.$date)
                      .toLocaleString();
                    return (
                      <li key={id} className="flex flex-col gap-3 p-3">
                        <div className="flex items-center gap-3">
                          <div className="flex-1">
                            <div className="text-sm font-medium">{k.name}</div>
                            <div className="text-xs text-gray-400">
                              Prefix: {k.openPrefix} • {created}
                            </div>
                          </div>
                          <div
                            className={"text-xs mr-2 " +
                              (k.isActive
                                ? "text-emerald-600"
                                : "text-red-500")}
                          >
                            {k.isActive ? "Active" : "Revoked"}
                          </div>
                          {k.isActive && (
                            <Form method="post">
                              <input
                                type="hidden"
                                name="intent"
                                value="revoke"
                              />
                              <input type="hidden" name="id" value={id} />
                              <Button
                                variant="destructive"
                                size="sm"
                                type="submit"
                              >
                                Revoke
                              </Button>
                            </Form>
                          )}
                        </div>
                        {k.isActive && (
                          <Form
                            method="post"
                            className="grid gap-2 rounded border bg-muted/40 p-3"
                          >
                            <input type="hidden" name="intent" value="update" />
                            <input type="hidden" name="id" value={id} />
                            <div className="grid gap-2">
                              <Label htmlFor={`name-${id}`}>Name</Label>
                              <Input
                                id={`name-${id}`}
                                name="name"
                                defaultValue={k.name}
                              />
                            </div>
                            <div className="grid gap-2">
                              <Label htmlFor={`policies-${id}`}>
                                Policies JSON
                              </Label>
                              <textarea
                                id={`policies-${id}`}
                                name="policies"
                                defaultValue={JSON.stringify(
                                  k.policies ?? defaultPolicies,
                                  null,
                                  2,
                                )}
                                className="min-h-28 w-full rounded-md border bg-background p-2 font-mono text-xs"
                              />
                            </div>
                            <div className="flex items-center gap-2">
                              <Button size="sm" type="submit">Save</Button>
                              {actionData?.error && (
                                <span className="text-xs text-red-500">
                                  {actionData.error}
                                </span>
                              )}
                            </div>
                          </Form>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
