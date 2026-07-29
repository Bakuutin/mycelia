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
  Plus,
  RotateCcw,
  Save,
  Trash2,
  XCircle,
  Zap,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { extractModelIds, getModelsEndpoint } from "@/lib/inferenceModels";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

// Using new ConfigResource instead of direct mongo access

const inferenceConfigSchema = z.object({
  baseUrl: z.string().url("Must be a valid URL"),
  apiKey: z.string(),
  profileName: z.string().min(1, "Preset name is required"),
  smallModel: z.string().min(1, "Choose the small alias model"),
  mediumModel: z.string().min(1, "Choose the medium alias model"),
  largeModel: z.string().min(1, "Choose the large alias model"),
  defaultAlias: z.enum(["small", "medium", "large"]),
  chatModel: z.string().min(1, "Choose the default chat model"),
  promptCachingEnabled: z.boolean(),
  promptCacheSessionPrefix: z.string().trim().min(1)
    .max(120, "Keep the cache prefix below 120 characters"),
  transcriptionBaseUrl: z.union([
    z.literal(""),
    z.string().url("Must be a valid STT URL"),
  ]),
  transcriptionApiKey: z.string(),
  transcriptionModel: z.string(),
  transcriptionBatchSize: z.coerce.number().int().min(1).max(32),
  transcriptionBatchTimeoutBaseSeconds: z.coerce.number().int().min(60).max(
    1800,
  ),
  transcriptionBatchTimeoutPerSequenceSeconds: z.coerce.number().int().min(15)
    .max(300),
}).superRefine((value, ctx) => {
  const hasUrl = value.transcriptionBaseUrl.trim().length > 0;
  const hasKey = value.transcriptionApiKey.trim().length > 0;
  if (hasUrl !== hasKey) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "STT URL and API key must both be set, or both left empty",
      path: hasUrl ? ["transcriptionApiKey"] : ["transcriptionBaseUrl"],
    });
  }
  if (/^https?:\/\//i.test(value.transcriptionApiKey.trim())) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "This looks like a URL, not an STT API key",
      path: ["transcriptionApiKey"],
    });
  }
});

type InferenceConfig = z.infer<typeof inferenceConfigSchema>;
type ModelAlias = "small" | "medium" | "large";

type LlmProfile = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  aliases: Record<ModelAlias, string>;
  defaultAlias: ModelAlias;
  chatModel: string;
  promptCaching?: {
    enabled?: boolean;
    sessionPrefix?: string;
  };
};

const MODEL_ROUTES = [
  {
    workerType: "summarization",
    fallbackWorkerType: "summarization",
    label: "Summaries and summary titles",
    description:
      "Automatic and manual conversation summaries, plus generated titles.",
  },
  {
    workerType: "conversation_chunk_creator",
    fallbackWorkerType: "conversation_extractor",
    label: "Conversation extraction",
    description:
      "Conversation segmentation and metadata extraction use the model stored on each new chunk.",
  },
  {
    workerType: "tagger",
    fallbackWorkerType: "tagger",
    label: "Automatic tagging",
    description: "Tag selection and assignment for conversation objects.",
  },
] as const;

const ROUTING_WORKER_TYPES = [
  ...new Set(
    MODEL_ROUTES.flatMap((
      route,
    ) => [route.workerType, route.fallbackWorkerType]),
  ),
];

const InferenceSettingsPage = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [configWarning, setConfigWarning] = useState<string | null>(null);
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
  const [sttTestResult, setSttTestResult] = useState<
    { success: boolean; message: string } | null
  >(null);
  const [sttModelsResult, setSttModelsResult] = useState<
    { success: boolean; message: string } | null
  >(null);
  const [testingStt, setTestingStt] = useState(false);
  const [loadingSttModels, setLoadingSttModels] = useState(false);
  const [sttModels, setSttModels] = useState<string[]>([]);
  const [profiles, setProfiles] = useState<LlmProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState("");

  const form = useForm<InferenceConfig>({
    resolver: zodResolver(inferenceConfigSchema),
    defaultValues: {
      baseUrl: "",
      apiKey: "",
      profileName: "",
      smallModel: "",
      mediumModel: "",
      largeModel: "",
      defaultAlias: "medium",
      chatModel: "",
      promptCachingEnabled: true,
      promptCacheSessionPrefix: "mycelia",
      transcriptionBaseUrl: "",
      transcriptionApiKey: "",
      transcriptionModel: "whisper",
      transcriptionBatchSize: 16,
      transcriptionBatchTimeoutBaseSeconds: 120,
      transcriptionBatchTimeoutPerSequenceSeconds: 60,
    },
  });

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const [configResult, ...defaultsResults] = await Promise.all([
          callResource("config", { action: "get" }),
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
          const fallbackDefaults = defaultsByWorker[route.fallbackWorkerType] ||
            {};
          if (typeof defaults.model === "string" && defaults.model) {
            modelsByWorker[route.workerType] = defaults.model;
          }
          if (typeof fallbackDefaults.fallbackModel === "string") {
            fallbackModelsByWorker[route.workerType] =
              fallbackDefaults.fallbackModel;
          }
        });
        setWorkerDefaults(defaultsByWorker);
        setTaskModels(modelsByWorker);
        setTaskFallbackModels(fallbackModelsByWorker);

        if (configResult) {
          const llmConfig = configResult.llm || configResult.inference || {};
          const transcriptionConfig = configResult.transcription || {};
          const storedTranscriptionKey = transcriptionConfig.apiKey || "";
          const malformedTranscriptionKey = /^https?:\/\//i.test(
            storedTranscriptionKey.trim(),
          );
          const savedProfiles = configResult.llmProfiles?.profiles as
            | Array<Omit<LlmProfile, "chatModel"> & { chatModel?: string }>
            | undefined;
          const legacyModel = llmConfig.model || "";
          const nextProfiles: LlmProfile[] = savedProfiles?.length
            ? savedProfiles.map((profile) => ({
              ...profile,
              chatModel: profile.chatModel ||
                profile.aliases[profile.defaultAlias],
              promptCaching: profile.promptCaching ?? {
                enabled: true,
                sessionPrefix: "mycelia",
              },
            }))
            : [{
              id: "primary",
              name: "Primary",
              baseUrl: llmConfig.baseUrl || "",
              apiKey: llmConfig.apiKey || "",
              aliases: {
                small: legacyModel,
                medium: legacyModel,
                large: legacyModel,
              },
              defaultAlias: "medium",
              chatModel: legacyModel,
              promptCaching: { enabled: true, sessionPrefix: "mycelia" },
            }];
          const nextActiveId = configResult.llmProfiles?.activeProfileId &&
              nextProfiles.some((profile) =>
                profile.id === configResult.llmProfiles.activeProfileId
              )
            ? configResult.llmProfiles.activeProfileId
            : nextProfiles[0].id;
          const activeProfile = nextProfiles.find((profile) =>
            profile.id === nextActiveId
          )!;
          setProfiles(nextProfiles);
          setActiveProfileId(nextActiveId);
          form.reset({
            baseUrl: activeProfile.baseUrl,
            apiKey: activeProfile.apiKey,
            profileName: activeProfile.name,
            smallModel: activeProfile.aliases.small,
            mediumModel: activeProfile.aliases.medium,
            largeModel: activeProfile.aliases.large,
            defaultAlias: activeProfile.defaultAlias,
            chatModel: activeProfile.chatModel,
            promptCachingEnabled: activeProfile.promptCaching?.enabled ?? true,
            promptCacheSessionPrefix:
              activeProfile.promptCaching?.sessionPrefix || "mycelia",
            transcriptionBaseUrl: transcriptionConfig.baseUrl || "",
            transcriptionApiKey: malformedTranscriptionKey
              ? ""
              : storedTranscriptionKey,
            transcriptionModel: transcriptionConfig.model || "whisper",
            transcriptionBatchSize: transcriptionConfig.batchSize || 16,
            transcriptionBatchTimeoutBaseSeconds:
              transcriptionConfig.batchTimeoutBaseSeconds || 120,
            transcriptionBatchTimeoutPerSequenceSeconds:
              transcriptionConfig.batchTimeoutPerSequenceSeconds || 60,
          });
          if (malformedTranscriptionKey) {
            setConfigWarning(
              "Stored STT routing is malformed: the API key contains a URL. The effective environment route is unchanged; enter the correct key before saving.",
            );
          }
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

      const currentProfile: LlmProfile = {
        id: activeProfileId,
        name: data.profileName.trim(),
        baseUrl: data.baseUrl.trim(),
        apiKey: data.apiKey,
        aliases: {
          small: data.smallModel.trim(),
          medium: data.mediumModel.trim(),
          large: data.largeModel.trim(),
        },
        defaultAlias: data.defaultAlias,
        chatModel: data.chatModel.trim(),
        promptCaching: {
          enabled: data.promptCachingEnabled,
          sessionPrefix: data.promptCacheSessionPrefix.trim(),
        },
      };
      const nextProfiles = profiles.map((profile) =>
        profile.id === activeProfileId ? currentProfile : profile
      );
      const globalModel = currentProfile.aliases[currentProfile.defaultAlias];
      const invalidFallback = MODEL_ROUTES.find((route) => {
        const primary = taskModels[route.workerType]?.trim() || globalModel;
        const fallback = taskFallbackModels[route.workerType]?.trim();
        return fallback && fallback === primary;
      });
      if (invalidFallback) {
        setError(
          `${invalidFallback.label}: fallback must differ from the primary model.`,
        );
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
        ([workerType, defaults]) =>
          callResource("jobs", {
            action: "update_worker_defaults",
            workerType,
            defaults,
          }),
      );

      await callResource("config", {
        action: "patch",
        updates: {
          llmProfiles: {
            activeProfileId,
            profiles: nextProfiles,
          },
          llm: {
            baseUrl: currentProfile.baseUrl,
            apiKey: currentProfile.apiKey,
            model: globalModel,
            chatModel: currentProfile.chatModel,
            fallbackEnabled: false,
            fallbackModel: "",
            promptCaching: currentProfile.promptCaching,
          },
          inference: {
            baseUrl: currentProfile.baseUrl,
            apiKey: currentProfile.apiKey,
            model: globalModel,
            chatModel: currentProfile.chatModel,
            fallbackEnabled: false,
            fallbackModel: "",
            promptCaching: currentProfile.promptCaching,
          },
          transcription: {
            baseUrl: data.transcriptionBaseUrl.trim(),
            apiKey: data.transcriptionApiKey.trim(),
            model: data.transcriptionModel.trim() || "whisper",
            batchSize: data.transcriptionBatchSize,
            batchTimeoutBaseSeconds: data.transcriptionBatchTimeoutBaseSeconds,
            batchTimeoutPerSequenceSeconds:
              data.transcriptionBatchTimeoutPerSequenceSeconds,
            fallbackEnabled: false,
            fallbackModel: "",
          },
        },
      });
      await Promise.all(workerUpdates);
      setWorkerDefaults(updatedDefaults);
      setProfiles(nextProfiles);
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

  const handleSaveTranscription = async () => {
    const transcriptionFields = [
      "transcriptionBaseUrl",
      "transcriptionApiKey",
      "transcriptionModel",
      "transcriptionBatchSize",
      "transcriptionBatchTimeoutBaseSeconds",
      "transcriptionBatchTimeoutPerSequenceSeconds",
    ] as const;
    if (!await form.trigger(transcriptionFields)) return;

    const data = form.getValues();
    try {
      setSaving(true);
      setError(null);
      setSaveSuccess(false);
      await callResource("config", {
        action: "patch",
        path: "transcription",
        updates: {
          baseUrl: data.transcriptionBaseUrl.trim(),
          apiKey: data.transcriptionApiKey.trim(),
          model: data.transcriptionModel.trim() || "whisper",
          batchSize: data.transcriptionBatchSize,
          batchTimeoutBaseSeconds: data.transcriptionBatchTimeoutBaseSeconds,
          batchTimeoutPerSequenceSeconds:
            data.transcriptionBatchTimeoutPerSequenceSeconds,
          fallbackEnabled: false,
          fallbackModel: "",
        },
      });
      setSaveSuccess(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to save STT configuration",
      );
    } finally {
      setSaving(false);
    }
  };

  const loadProfileIntoForm = (profile: LlmProfile) => {
    form.setValue("profileName", profile.name);
    form.setValue("baseUrl", profile.baseUrl);
    form.setValue("apiKey", profile.apiKey);
    form.setValue("smallModel", profile.aliases.small);
    form.setValue("mediumModel", profile.aliases.medium);
    form.setValue("largeModel", profile.aliases.large);
    form.setValue("defaultAlias", profile.defaultAlias);
    form.setValue("chatModel", profile.chatModel);
    form.setValue(
      "promptCachingEnabled",
      profile.promptCaching?.enabled ?? true,
    );
    form.setValue(
      "promptCacheSessionPrefix",
      profile.promptCaching?.sessionPrefix || "mycelia",
    );
    setTestResult(null);
  };

  const selectProfile = (profileId: string) => {
    const profile = profiles.find((candidate) => candidate.id === profileId);
    if (!profile) return;
    setActiveProfileId(profileId);
    loadProfileIntoForm(profile);
  };

  const addProfile = () => {
    const id = `provider-${Date.now()}`;
    const profile: LlmProfile = {
      id,
      name: `Provider ${profiles.length + 1}`,
      baseUrl: "",
      apiKey: "",
      aliases: { small: "", medium: "", large: "" },
      defaultAlias: "medium",
      chatModel: "",
      promptCaching: { enabled: true, sessionPrefix: "mycelia" },
    };
    setProfiles((current) => [...current, profile]);
    setActiveProfileId(id);
    loadProfileIntoForm(profile);
  };

  const deleteProfile = () => {
    if (profiles.length <= 1) return;
    const nextProfiles = profiles.filter((profile) =>
      profile.id !== activeProfileId
    );
    setProfiles(nextProfiles);
    setActiveProfileId(nextProfiles[0].id);
    loadProfileIntoForm(nextProfiles[0]);
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

  const testSttConnection = async () => {
    const values = form.getValues();
    if (!values.transcriptionBaseUrl || !values.transcriptionApiKey) {
      setSttModelsResult({
        success: false,
        message: "Enter both STT Base URL and STT API Key",
      });
      return;
    }
    setTestingStt(true);
    setSttTestResult(null);
    try {
      const result = await callResource("transcription", {
        action: "health",
        baseUrl: values.transcriptionBaseUrl.trim(),
        apiKey: values.transcriptionApiKey.trim(),
      }) as { success: boolean; status: number; message: string };
      setSttTestResult({
        success: result.success,
        message: result.success
          ? `STT gateway reachable (HTTP ${result.status}). Load models to verify the Whisper upstream.`
          : `STT returned HTTP ${result.status}: ${result.message}`,
      });
    } catch (err) {
      setSttTestResult({
        success: false,
        message: err instanceof Error
          ? err.message
          : "Failed to connect to STT",
      });
    } finally {
      setTestingStt(false);
    }
  };

  const loadSttModels = async () => {
    const values = form.getValues();
    if (!values.transcriptionBaseUrl || !values.transcriptionApiKey) {
      setSttTestResult({
        success: false,
        message: "Enter both STT Base URL and STT API Key",
      });
      return;
    }
    setLoadingSttModels(true);
    setSttModelsResult(null);
    try {
      const result = await callResource("transcription", {
        action: "models",
        baseUrl: values.transcriptionBaseUrl.trim(),
        apiKey: values.transcriptionApiKey.trim(),
      }) as {
        success: boolean;
        status: number;
        message: string;
        models: string[];
      };
      setSttModels(result.models || []);
      setSttModelsResult({
        success: result.success,
        message: result.success
          ? `${result.message}. Choose one below and save.`
          : `STT models unavailable (HTTP ${result.status}): ${result.message}`,
      });
    } catch (err) {
      setSttModels([]);
      setSttModelsResult({
        success: false,
        message: err instanceof Error
          ? err.message
          : "Failed to load STT models",
      });
    } finally {
      setLoadingSttModels(false);
    }
  };

  const defaultAlias = form.watch("defaultAlias");
  const aliasModels: Record<ModelAlias, string> = {
    small: form.watch("smallModel"),
    medium: form.watch("mediumModel"),
    large: form.watch("largeModel"),
  };
  const globalModel = aliasModels[defaultAlias];
  const chatModel = form.watch("chatModel");
  const resolvedChatModel = (["small", "medium", "large"] as string[])
      .includes(chatModel)
    ? aliasModels[chatModel as ModelAlias]
    : chatModel;

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
          Configure separate LLM and speech-to-text routes, then make model
          routing explicit for every AI feature.
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

          {configWarning && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-md">
              <p className="text-amber-800">{configWarning}</p>
            </div>
          )}

          {saveSuccess && (
            <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 p-3 text-green-700">
              <CheckCircle className="h-5 w-5" />
              Provider and model routing saved.
            </div>
          )}

          <div className="space-y-5 rounded-lg border p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">LLM provider preset</h3>
                <p className="text-sm text-muted-foreground">
                  Switch between Local, Gemini, or any other OpenAI-compatible
                  provider without rewriting task routes.
                </p>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={addProfile}>
                  <Plus className="mr-2 h-4 w-4" /> New preset
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={deleteProfile}
                  disabled={profiles.length <= 1}
                  title="Delete current preset"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Active preset</Label>
                <Select value={activeProfileId} onValueChange={selectProfile}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose provider preset" />
                  </SelectTrigger>
                  <SelectContent>
                    {profiles.map((profile) => (
                      <SelectItem key={profile.id} value={profile.id}>
                        {profile.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="profileName">Preset name *</Label>
                <Input id="profileName" {...form.register("profileName")} />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="baseUrl">LLM Base URL *</Label>
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
                <Label htmlFor="apiKey">LLM API Key *</Label>
                <Input
                  id="apiKey"
                  type="password"
                  {...form.register("apiKey")}
                  placeholder="Enter your API key"
                  className={form.formState.errors.apiKey
                    ? "border-red-500"
                    : ""}
                />
                {form.formState.errors.apiKey && (
                  <p className="text-sm text-red-500">
                    {form.formState.errors.apiKey.message}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-4 rounded-md bg-muted/30 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">Alias mapping</p>
                  <p className="text-xs text-muted-foreground">
                    Jobs may request small, medium, or large. The active preset
                    resolves each alias to the exact model saved below.
                  </p>
                </div>
                <div className="w-48">
                  <Select
                    value={defaultAlias}
                    onValueChange={(value) =>
                      form.setValue("defaultAlias", value as ModelAlias, {
                        shouldDirty: true,
                      })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Preset default alias" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="small">Default: small</SelectItem>
                      <SelectItem value="medium">Default: medium</SelectItem>
                      <SelectItem value="large">Default: large</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {(["small", "medium", "large"] as ModelAlias[]).map((alias) => (
                <div
                  key={alias}
                  className="grid items-center gap-3 md:grid-cols-[7rem_1fr]"
                >
                  <Label className="capitalize">{alias}</Label>
                  <ModelSelector
                    value={aliasModels[alias]}
                    onChange={(model) =>
                      form.setValue(
                        `${alias}Model` as
                          | "smallModel"
                          | "mediumModel"
                          | "largeModel",
                        model,
                        { shouldDirty: true, shouldValidate: true },
                      )}
                    placeholder={`Choose ${alias} model`}
                    availableModels={testResult?.models}
                    prefetch
                  />
                </div>
              ))}
              <p className="break-all font-mono text-xs text-muted-foreground">
                Preset default: {defaultAlias} →{" "}
                {globalModel || "Not configured"}
              </p>
            </div>

            <div className="space-y-3 rounded-md border bg-muted/20 p-4">
              <div>
                <Label className="font-medium">Chat default model</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  New memory chats start with this model. Changing it does not
                  alter existing chats; each chat can override its model from
                  the chat header.
                </p>
              </div>
              <ModelSelector
                value={chatModel}
                onChange={(model) => form.setValue("chatModel", model, {
                  shouldDirty: true,
                  shouldValidate: true,
                })}
                placeholder="Choose chat default model"
                availableModels={testResult?.models}
                prefetch
              />
              {form.formState.errors.chatModel && (
                <p className="text-sm text-red-500">
                  {form.formState.errors.chatModel.message}
                </p>
              )}
              <p className="break-all font-mono text-xs text-muted-foreground">
                New chats: {chatModel && resolvedChatModel !== chatModel
                  ? `${chatModel} → ${resolvedChatModel}`
                  : chatModel || "Not configured"}
              </p>
            </div>

            <div className="space-y-3 rounded-md border bg-muted/20 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Label className="font-medium">OpenRouter prompt cache</Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Keep extraction and summarization requests on the same
                    OpenRouter provider so repeated system prompts can be read
                    from that provider&apos;s prompt cache. This has no effect
                    on non-OpenRouter presets and does not cache model answers.
                  </p>
                </div>
                <Switch
                  checked={form.watch("promptCachingEnabled")}
                  onCheckedChange={(enabled) =>
                    form.setValue("promptCachingEnabled", enabled, {
                      shouldDirty: true,
                    })}
                  aria-label="Enable OpenRouter prompt cache routing"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="promptCacheSessionPrefix">
                  Sticky session prefix
                </Label>
                <Input
                  id="promptCacheSessionPrefix"
                  {...form.register("promptCacheSessionPrefix")}
                  disabled={!form.watch("promptCachingEnabled")}
                  placeholder="mycelia"
                />
                {form.formState.errors.promptCacheSessionPrefix && (
                  <p className="text-sm text-red-500">
                    {form.formState.errors.promptCacheSessionPrefix.message}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Change this only to intentionally start a separate warm-cache
                  namespace. The default <code>mycelia</code> is recommended.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap justify-start gap-3">
              <Button type="submit" disabled={saving || testing}>
                {saving
                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  : <Save className="mr-2 h-4 w-4" />}
                Save preset
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={testApiConnection}
                disabled={testing || saving}
              >
                {testing
                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  : <Zap className="mr-2 h-4 w-4" />}
                Test LLM preset
              </Button>
            </div>

            {testResult && (
              <div
                className={`rounded-md border p-3 text-sm ${
                  testResult.success
                    ? "border-green-200 bg-green-50 text-green-700"
                    : "border-red-200 bg-red-50 text-red-700"
                }`}
              >
                <p>{testResult.message}</p>
                {testResult.models?.length
                  ? (
                    <p className="mt-1 text-xs">
                      Models: {testResult.models.join(", ")}
                    </p>
                  )
                  : null}
              </div>
            )}
          </div>

          <div className="space-y-4 rounded-lg border p-5">
            <div>
              <h3 className="text-lg font-semibold">Speech-to-text route</h3>
              <p className="text-sm text-muted-foreground">
                Used by the transcription worker. If STT_SERVER_URL and
                PROXY_API_KEY are set in the backend environment, they take
                precedence; the effective source is shown on Jobs.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-6">
              <div className="space-y-2 md:col-span-6">
                <Label htmlFor="transcriptionBaseUrl">STT Base URL</Label>
                <Input
                  id="transcriptionBaseUrl"
                  {...form.register("transcriptionBaseUrl")}
                  placeholder="http://your-whisper-proxy:8001"
                />
                {form.formState.errors.transcriptionBaseUrl && (
                  <p className="text-sm text-red-500">
                    {form.formState.errors.transcriptionBaseUrl.message}
                  </p>
                )}
              </div>
              <div className="space-y-2 md:col-span-3">
                <Label htmlFor="transcriptionApiKey">STT API Key</Label>
                <Input
                  id="transcriptionApiKey"
                  type="password"
                  {...form.register("transcriptionApiKey")}
                  placeholder="Proxy API key"
                />
                {form.formState.errors.transcriptionApiKey && (
                  <p className="text-sm text-red-500">
                    {form.formState.errors.transcriptionApiKey.message}
                  </p>
                )}
              </div>
              <div className="space-y-2 md:col-span-3">
                <Label htmlFor="transcriptionModel">STT model</Label>
                {sttModels.length > 0
                  ? (
                    <Select
                      value={form.watch("transcriptionModel")}
                      onValueChange={(value) =>
                        form.setValue("transcriptionModel", value, {
                          shouldDirty: true,
                        })}
                    >
                      <SelectTrigger id="transcriptionModel">
                        <SelectValue placeholder="Choose STT model" />
                      </SelectTrigger>
                      <SelectContent>
                        {sttModels.map((model) => (
                          <SelectItem key={model} value={model}>
                            {model}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )
                  : (
                    <Input
                      id="transcriptionModel"
                      {...form.register("transcriptionModel")}
                      placeholder="large-v3"
                    />
                  )}
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="transcriptionBatchSize">
                  Sequences per job
                </Label>
                <Input
                  id="transcriptionBatchSize"
                  type="number"
                  min={1}
                  max={32}
                  {...form.register("transcriptionBatchSize", {
                    valueAsNumber: true,
                  })}
                />
                {form.formState.errors.transcriptionBatchSize && (
                  <p className="text-sm text-red-500">
                    {form.formState.errors.transcriptionBatchSize.message}
                  </p>
                )}
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="transcriptionBatchTimeoutBaseSeconds">
                  Base timeout (sec)
                </Label>
                <Input
                  id="transcriptionBatchTimeoutBaseSeconds"
                  type="number"
                  min={60}
                  max={1800}
                  {...form.register("transcriptionBatchTimeoutBaseSeconds", {
                    valueAsNumber: true,
                  })}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="transcriptionBatchTimeoutPerSequenceSeconds">
                  Per sequence (sec)
                </Label>
                <Input
                  id="transcriptionBatchTimeoutPerSequenceSeconds"
                  type="number"
                  min={15}
                  max={300}
                  {...form.register(
                    "transcriptionBatchTimeoutPerSequenceSeconds",
                    { valueAsNumber: true },
                  )}
                />
              </div>
              <p className="md:col-span-6 text-xs text-muted-foreground">
                Recommended: 16 sequences. Timeout = base + per-sequence × batch
                size (16 defaults to 18 min). Whisper runs one sequence at a
                time while preparing the next one.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                onClick={() => void handleSaveTranscription()}
                disabled={saving || testingStt}
              >
                {saving
                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  : <Save className="mr-2 h-4 w-4" />}
                Save STT route
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={testSttConnection}
                disabled={testingStt || saving}
              >
                {testingStt
                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  : <Zap className="mr-2 h-4 w-4" />}
                Test STT gateway
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={loadSttModels}
                disabled={loadingSttModels || saving}
              >
                {loadingSttModels
                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  : <RotateCcw className="mr-2 h-4 w-4" />}
                Load STT models
              </Button>
              {sttTestResult && (
                <p
                  className={sttTestResult.success
                    ? "text-sm text-green-700"
                    : "text-sm text-red-600"}
                >
                  Gateway: {sttTestResult.message}
                </p>
              )}
              {sttModelsResult && (
                <p
                  className={sttModelsResult.success
                    ? "text-sm text-green-700"
                    : "text-sm text-red-600"}
                >
                  Models: {sttModelsResult.message}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-5 rounded-lg border p-5">
            <div>
              <h3 className="text-lg font-semibold">Model routing</h3>
              <p className="text-sm text-muted-foreground">
                Tasks use an alias from the active preset unless you choose an
                exact model override here.
              </p>
            </div>

            <div className="rounded-md border bg-muted/20 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">Active preset default</p>
                  <p className="text-xs text-muted-foreground">
                    Background tasks without an explicit override use this
                    route.
                  </p>
                </div>
                <div className="text-right text-xs">
                  <Badge variant="secondary">{defaultAlias}</Badge>
                  <p className="mt-1 max-w-md break-all font-mono">
                    {globalModel || "Not configured"}
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-2 rounded-md bg-muted/40 p-4">
              <p className="font-medium">Explicit failure policy</p>
              <p className="text-xs text-muted-foreground">
                Every background feature below chooses its own fallback. Empty
                fallback means stop with a visible error; there is no hidden
                provider-wide retry.
              </p>
            </div>

            <div className="space-y-3">
              <div className="rounded-md border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">
                      Memory chat
                    </p>
                    <p className="text-xs text-muted-foreground">
                      New chats inherit the chat default below. Every chat can
                      then override it independently; errors never switch models
                      silently.
                    </p>
                  </div>
                  <div className="text-right text-xs">
                    <p className="max-w-md break-all font-mono">
                      {resolvedChatModel || "Not configured"}
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      On error: Stop with error
                    </p>
                  </div>
                </div>
              </div>

              {MODEL_ROUTES.map((route) => {
                const override = taskModels[route.workerType] || "";
                const effectiveModel = override || globalModel ||
                  "Not configured";
                const fallback = taskFallbackModels[route.workerType] || "";
                return (
                  <div
                    key={route.workerType}
                    className="space-y-3 rounded-md border p-4"
                  >
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
                        <p className="text-muted-foreground">
                          Effective primary
                        </p>
                        <p className="max-w-md break-all font-mono">
                          {effectiveModel}
                        </p>
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
                        placeholder={`Use preset default: ${defaultAlias} → ${
                          globalModel || "not configured"
                        }`}
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
                          Choose a different fallback model, or clear it to stop
                          on error.
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <Button type="submit" disabled={saving || testing || testingStt}>
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
