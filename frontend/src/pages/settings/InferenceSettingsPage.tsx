import { useEffect, useState } from "react";
import { callResource } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Save } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

const SERVER_CONFIG_ID = "000000000000000000000000";

const inferenceConfigSchema = z.object({
  baseUrl: z.string().url("Must be a valid URL"),
  apiKey: z.string(),
});

type InferenceConfig = z.infer<typeof inferenceConfigSchema>;

const InferenceSettingsPage = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const form = useForm<InferenceConfig>({
    resolver: zodResolver(inferenceConfigSchema),
    defaultValues: {
      baseUrl: "https://inference.mycelia.tech",
      apiKey: "",
    },
  });

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const configResult = await callResource("mongo", {
          action: "findOne",
          collection: "configs",
          query: { _id: { $oid: SERVER_CONFIG_ID } },
        });

        if (configResult?.inference) {
          form.reset({
            baseUrl: configResult.inference.baseUrl || "https://inference.mycelia.tech",
            apiKey: configResult.inference.apiKey || "",
          });
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to fetch inference settings",
        );
      } finally {
        setLoading(false);
      }
    };

    fetchConfig();
  }, [form]);

  const handleSaveProvider = async (data: InferenceConfig) => {
    try {
      setSaving(true);
      setError(null);

      await callResource("mongo", {
        action: "updateOne",
        collection: "configs",
        query: { _id: { $oid: SERVER_CONFIG_ID } },
        update: {
          $set: {
            inference: {
              baseUrl: data.baseUrl,
              apiKey: data.apiKey,
            },
          },
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save provider configuration");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold mb-2">Inference</h2>
          <p className="text-muted-foreground">
            Configure OpenAI-compatible inference provider.
          </p>
        </div>
        <div className="border rounded-lg p-8 text-center">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold mb-2">Inference</h2>
          <p className="text-muted-foreground">
            Configure inference provider for AI features.
          </p>
        </div>
        <div className="border rounded-lg p-8 text-center">
          <p className="text-red-500">Error: {error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold mb-2">Inference</h2>
        <p className="text-muted-foreground">
          Configure inference provider
        </p>
      </div>

      <Card className="p-6">
        <form onSubmit={form.handleSubmit(handleSaveProvider)} className="space-y-6">
          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-md">
              <p className="text-red-600">{error}</p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="baseUrl">Base URL *</Label>
              <Input
                id="baseUrl"
                {...form.register("baseUrl")}
                placeholder="https://inference.mycelia.tech"
                className={form.formState.errors.baseUrl ? "border-red-500" : ""}
              />
              {form.formState.errors.baseUrl && (
                <p className="text-sm text-red-500">
                  {form.formState.errors.baseUrl.message}
                </p>
              )}
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="apiKey">API Key *</Label>
              <Input
                id="apiKey"
                type="password"
                {...form.register("apiKey")}
                placeholder="Enter your API key"
                className={form.formState.errors.apiKey ? "border-red-500" : ""}
              />
              {form.formState.errors.apiKey && (
                <p className="text-sm text-red-500">
                  {form.formState.errors.apiKey.message}
                </p>
              )}
            </div>
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={saving}>
              {saving
                ? (
                  "Saving..."
                )
                : (
                  <>
                    <Save className="w-4 h-4 mr-2" />
                    Save
                  </>
                )}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
};

export default InferenceSettingsPage;
