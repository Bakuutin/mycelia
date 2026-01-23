import { useEffect, useState } from "react";
import { callResource } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Save, Zap, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

// Using new ConfigResource instead of direct mongo access

const inferenceConfigSchema = z.object({
  baseUrl: z.string().url("Must be a valid URL"),
  apiKey: z.string(),
});

type InferenceConfig = z.infer<typeof inferenceConfigSchema>;

const InferenceSettingsPage = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

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
        const configResult = await callResource("config", {
          action: "get",
          path: "inference",
        });

        if (configResult) {
          form.reset({
            baseUrl: configResult.baseUrl || "https://inference.mycelia.tech",
            apiKey: configResult.apiKey || "",
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

      await callResource("config", {
        action: "patch",
        path: "inference",
        updates: {
          baseUrl: data.baseUrl,
          apiKey: data.apiKey,
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save provider configuration");
    } finally {
      setSaving(false);
    }
  };

  const testApiConnection = async () => {
    const values = form.getValues();

    if (!values.baseUrl || !values.apiKey) {
      setTestResult({ success: false, message: "Please enter both Base URL and API Key" });
      return;
    }

    setTesting(true);
    setTestResult(null);

    try {
      // Test the API by calling the /v1/models endpoint
      const response = await fetch(
        values.baseUrl.replace(/\/$/, "") + "/v1/models",
        {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${values.apiKey}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        const modelCount = data.data?.length || 0;
        setTestResult({
          success: true,
          message: `Connection successful! Found ${modelCount} model${modelCount !== 1 ? 's' : ''}.`
        });
      } else {
        const errorText = await response.text();
        let errorMessage = `API returned ${response.status}`;
        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.error?.message) {
            errorMessage = errorJson.error.message;
          }
        } catch {
          if (errorText) {
            errorMessage = errorText.substring(0, 100);
          }
        }
        setTestResult({ success: false, message: errorMessage });
      }
    } catch (err) {
      setTestResult({
        success: false,
        message: err instanceof Error ? err.message : "Failed to connect to API"
      });
    } finally {
      setTesting(false);
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

          {testResult && (
            <div className={`p-4 rounded-md flex items-center gap-2 ${
              testResult.success
                ? "bg-green-50 border border-green-200 text-green-700"
                : "bg-red-50 border border-red-200 text-red-700"
            }`}>
              {testResult.success ? (
                <CheckCircle className="w-5 h-5 text-green-600" />
              ) : (
                <XCircle className="w-5 h-5 text-red-600" />
              )}
              <span>{testResult.message}</span>
            </div>
          )}

          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={testApiConnection}
              disabled={testing || saving}
            >
              {testing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Testing...
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4 mr-2" />
                  Test API
                </>
              )}
            </Button>
            <Button type="submit" disabled={saving || testing}>
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
