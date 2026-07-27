import { useEffect, useState } from "react";
import { callResource } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ModelSelector } from "@/components/ModelSelector";
import {
  CheckCircle,
  Loader2,
  RotateCcw,
  Save,
  XCircle,
  Zap,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { extractModelIds, getModelsEndpoint } from "@/lib/inferenceModels";

// Using new ConfigResource instead of direct mongo access

const inferenceConfigSchema = z.object({
  baseUrl: z.string().url("Must be a valid URL"),
  apiKey: z.string(),
  model: z.string().min(1, "Choose a global default model"),
});

type InferenceConfig = z.infer<typeof inferenceConfigSchema>;

const MODEL_ROUTES = [
  {
    workerType: "summarization",
    fallbackWorkerType: "summarization",
    label: "Summaries and summary titles",
    description: "Automatic and manual conversation summaries, plus generated titles.",
  },
  {
    workerType: "conversation_chunk_creator",
    fallbackWorkerType: "conversation_extractor",
    label: "Conversation extraction",
    description: "Conversation segmentation and metadata extraction use the model stored on each new chunk.",
  },
  {
    workerType: "tagger",
    fallbackWorkerType: "tagger",
    label: "Automatic tagging",
    description: "Tag selection and assignment for conversation objects.",
  },
] as const;

const ROUTING_WORKER_TYPES = [...new Set(
  MODEL_ROUTES.flatMap((route) => [route.workerType, route.fallbackWorkerType]),
)];

const InferenceSettingsPage = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [testing, setTesting] = useState(false);
  const [workerDefaults, setWorkerDefaults] = useState<
    Record<string, Record<string, unknown>>
  >({});
  const [taskModels, setTaskModels] = useState<Record<string, string>>({});
  const [taskFallbackModels, setTaskFallbackModels] = useState<
    Record<string, string>
  >({});
  const [testResult, setTestResult] = useState<
    {
      success: boolean;
      message: string;
      models?: string[];
    } | null
  >(null);

  const form = useForm<InferenceConfig>({
    resolver: zodResolver(inferenceConfigSchema),
    defaultValues: {
      baseUrl: "",
      apiKey: "",
      model: "",
    },
  });

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const [configResult, ...defaultsResults] = await Promise.all([
          callResource("config", {
            action: "get",
            path: "inference",
          }),
          ...ROUTING_WORKER_TYPES.map((workerType) =>
            callResource("jobs", {
              action: "get_worker_defaults",
              workerType,
            })
          ),
        ]);

        const defaultsByWorker: Record<string, Record<string, unknown>> = {};
        const modelsByWorker: Record<string, string> = {};
        const fallbackModelsByWorker: Record<string, string> = {};
        ROUTING_WORKER_TYPES.forEach((workerType, index) => {
          const defaults = defaultsResults[index]?.defaults || {};
          defaultsByWorker[workerType] = defaults;
        });
        MODEL_ROUTES.forEach((route) => {
          const defaults = defaultsByWorker[route.workerType] || {};
          const fallbackDefaults = defaultsByWorker[route.fallbackWorkerType] || {};
          if (typeof defaults.model === "string" && defaults.model) {
            modelsByWorker[route.workerType] = defaults.model;
          }
          if (typeof fallbackDefaults.fallbackModel === "string") {
            fallbackModelsByWorker[route.workerType] = fallbackDefaults.fallbackModel;
          }
        });
        setWorkerDefaults(defaultsByWorker);
        setTaskModels(modelsByWorker);
        setTaskFallbackModels(fallbackModelsByWorker);

        if (configResult) {
          form.reset({
            baseUrl: configResult.baseUrl || "",
            apiKey: configResult.apiKey || "",
            model: configResult.model || "",
          });
        }
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to fetch inference settings",
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
      setSaveSuccess(false);

      const invalidFallback = MODEL_ROUTES.find((route) => {
        const primary = taskModels[route.workerType]?.trim() || data.model;
        const fallback = taskFallbackModels[route.workerType]?.trim();
        return fallback && fallback === primary;
      });
      if (invalidFallback) {
        setError(`${invalidFallback.label}: fallback must differ from the primary model.`);
        return;
      }

      const updatedDefaults: Record<string, Record<string, unknown>> = {};
      for (const workerType of ROUTING_WORKER_TYPES) {
        updatedDefaults[workerType] = { ...(workerDefaults[workerType] || {}) };
      }

      MODEL_ROUTES.forEach((route) => {
        const defaults = updatedDefaults[route.workerType];
        const taskModel = taskModels[route.workerType]?.trim();
        if (taskModel) defaults.model = taskModel;
        else delete defaults.model;

        const fallbackDefaults = updatedDefaults[route.fallbackWorkerType];
        fallbackDefaults.fallbackModel =
          taskFallbackModels[route.workerType]?.trim() || "";
      });

      const workerUpdates = Object.entries(updatedDefaults).map(
        ([workerType, defaults]) => callResource("jobs", {
          action: "update_worker_defaults",
          workerType,
          defaults,
        }),
      );

      await Promise.all([
        callResource("config", {
          action: "patch",
          path: "inference",
          updates: {
            baseUrl: data.baseUrl,
            apiKey: data.apiKey,
            model: data.model,
            // All current AI features declare their own failure policy below.
            // Disable the legacy provider-wide fallback to avoid hidden retries.
            fallbackEnabled: false,
            fallbackModel: "",
          },
        }),
        ...workerUpdates,
      ]);
      setWorkerDefaults(updatedDefaults);
      setSaveSuccess(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to save provider configuration",
      );
    } finally {
      setSaving(false);
    }
  };

  const testApiConnection = async () => {
    const values = form.getValues();

    if (!values.baseUrl || !values.apiKey) {
      setTestResult({
        success: false,
        message: "Please enter both Base URL and API Key",
      });
      return;
    }

    setTesting(true);
    setTestResult(null);

    try {
      // Test the API by calling the OpenAI-compatible models endpoint.
      const response = await fetch(
        getModelsEndpoint(values.baseUrl),
        {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${values.apiKey}`,
            "Content-Type": "application/json",
          },
        },
      );

      if (response.ok) {
        const data = await response.json();
        const models = extractModelIds(data.data);
        const modelCount = models.length;
        setTestResult({
          success: true,
          message: `Connection successful! Found ${modelCount} named model${
            modelCount !== 1 ? "s" : ""
          }.`,
          models,
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
        message: err instanceof Error
          ? err.message
          : "Failed to connect to API",
      });
    } finally {
      setTesting(false);
    }
  };

  const globalModel = form.watch("model");

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
          Configure the provider and make model routing explicit for every AI feature.
        </p>
      </div>

      <Card className="p-6">
        <form
          onSubmit={form.handleSubmit(handleSaveProvider)}
          className="space-y-6"
        >
          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-md">
              <p className="text-red-600">{error}</p>
            </div>
          )}

          {saveSuccess && (
            <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 p-3 text-green-700">
              <CheckCircle className="h-5 w-5" />
              Provider and model routing saved.
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="baseUrl">Base URL *</Label>
              <Input
                id="baseUrl"
                {...form.register("baseUrl")}
                placeholder="http://your-openai-compatible-server:8080/v1"
                className={form.formState.errors.baseUrl
                  ? "border-red-500"
                  : ""}
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

          <div className="space-y-5 rounded-lg border p-5">
            <div>
              <h3 className="text-lg font-semibold">Model routing</h3>
              <p className="text-sm text-muted-foreground">
                The global model replaces legacy small/medium/large aliases. A task override wins only for that task.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label>Global default model *</Label>
                <Badge variant="secondary">Chat default</Badge>
              </div>
              <ModelSelector
                value={globalModel}
                onChange={(model) =>
                  form.setValue("model", model, {
                    shouldDirty: true,
                    shouldValidate: true,
                  })}
                placeholder="Choose the model used by default"
                prefetch
              />
              {form.formState.errors.model && (
                <p className="text-sm text-red-500">
                  {form.formState.errors.model.message}
                </p>
              )}
              <p className="break-all font-mono text-xs text-muted-foreground">
                Effective global model: {globalModel || "Not configured"}
              </p>
            </div>

            <div className="space-y-2 rounded-md bg-muted/40 p-4">
              <p className="font-medium">Explicit failure policy</p>
              <p className="text-xs text-muted-foreground">
                Every background feature below chooses its own fallback. Empty fallback means stop with a visible error; there is no hidden provider-wide retry.
              </p>
            </div>

            <div className="space-y-3">
              <div className="rounded-md border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">Assistant chat and chat titles</p>
                    <p className="text-xs text-muted-foreground">
                      Uses the global default. Streaming errors stop the response; chat never switches models silently.
                    </p>
                  </div>
                  <div className="text-right text-xs">
                    <p className="max-w-md break-all font-mono">
                      {globalModel || "Not configured"}
                    </p>
                    <p className="mt-1 text-muted-foreground">On error: Stop with error</p>
                  </div>
                </div>
              </div>

              {MODEL_ROUTES.map((route) => {
                const override = taskModels[route.workerType] || "";
                const effectiveModel = override || globalModel || "Not configured";
                const fallback = taskFallbackModels[route.workerType] || "";
                return (
                  <div key={route.workerType} className="space-y-3 rounded-md border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{route.label}</p>
                          <Badge variant={override ? "default" : "secondary"}>
                            {override ? "Task override" : "Global default"}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {route.description}
                        </p>
                      </div>
                      <div className="text-right text-xs">
                        <p className="text-muted-foreground">Effective primary</p>
                        <p className="max-w-md break-all font-mono">{effectiveModel}</p>
                        <p className="mt-1 text-muted-foreground">
                          On error: {fallback || "Stop with error"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <ModelSelector
                        value={override}
                        onChange={(model) =>
                          setTaskModels((current) => ({
                            ...current,
                            [route.workerType]: model,
                          }))}
                        placeholder={`Use global: ${globalModel || "not configured"}`}
                        className="flex-1"
                        prefetch
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        disabled={!override}
                        onClick={() =>
                          setTaskModels((current) => ({
                            ...current,
                            [route.workerType]: "",
                          }))}
                        title="Use global default"
                      >
                        <RotateCcw className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="space-y-2 rounded-md bg-muted/30 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <Label>Fallback after a primary error</Label>
                        <Badge variant={fallback ? "default" : "outline"}>
                          {fallback ? "Retry once" : "Stop with error"}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        <ModelSelector
                          value={fallback}
                          onChange={(model) =>
                            setTaskFallbackModels((current) => ({
                              ...current,
                              [route.workerType]: model,
                            }))}
                          placeholder="No fallback — stop with error"
                          className="flex-1"
                          prefetch
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          disabled={!fallback}
                          onClick={() =>
                            setTaskFallbackModels((current) => ({
                              ...current,
                              [route.workerType]: "",
                            }))}
                          title="Stop with error; do not retry another model"
                        >
                          <XCircle className="h-4 w-4" />
                        </Button>
                      </div>
                      {fallback && fallback === effectiveModel && (
                        <p className="text-xs text-red-500">
                          Choose a different fallback model, or clear it to stop on error.
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {testResult && (
            <div
              className={`rounded-md p-4 ${
                testResult.success
                  ? "bg-green-50 border border-green-200 text-green-700"
                  : "bg-red-50 border border-red-200 text-red-700"
              }`}
            >
              <div className="flex items-center gap-2">
                {testResult.success
                  ? <CheckCircle className="h-5 w-5 text-green-600" />
                  : <XCircle className="h-5 w-5 text-red-600" />}
                <span>{testResult.message}</span>
              </div>
              {testResult.success && testResult.models &&
                testResult.models.length > 0 && (
                <div className="ml-7 mt-2 w-full">
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide">
                    Available models
                  </p>
                  <ul className="max-h-40 space-y-1 overflow-y-auto rounded border border-green-200 bg-white/60 p-2">
                    {testResult.models.map((model) => (
                      <li key={model} className="break-all font-mono text-xs">
                        {model}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={testApiConnection}
              disabled={testing || saving}
            >
              {testing
                ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Testing...
                  </>
                )
                : (
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
