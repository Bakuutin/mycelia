import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { callResource } from "@/lib/api";
import { getLLM } from "@/lib/llm";
import type { Model } from "@/types/llm";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft,
  CheckCircle,
  Copy,
  Loader2,
  Play,
  Save,
  Trash2,
  XCircle,
} from "lucide-react";

const updateModelSchema = z.object({
  alias: z.enum(["small", "medium", "large"]),
  name: z.string().min(1, "Name is required").max(
    100,
    "Name must be less than 100 characters",
  ),
  provider: z.string().min(1, "Provider is required").max(
    50,
    "Provider must be less than 50 characters",
  ),
  baseUrl: z.string().url("Must be a valid URL"),
  apiKey: z.string().min(1, "API key is required"),
});

type UpdateModelData = z.infer<typeof updateModelSchema>;

const LLMDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [model, setModel] = useState<Model | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<
    {
      success: boolean;
      response?: any;
      error?: string;
    } | null
  >(null);
  const [streamingResponse, setStreamingResponse] = useState<string>("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [testMessage, setTestMessage] = useState(
    "Hello, can you respond with a simple greeting?",
  );

  const form = useForm<UpdateModelData>({
    resolver: zodResolver(updateModelSchema),
  });

  useEffect(() => {
    const fetchModel = async () => {
      if (!id) return;

      try {
        setLoading(true);
        const result = await callResource("tech.mycelia.mongo", {
          action: "findOne",
          collection: "llm_models",
          query: { _id: { $oid: id } },
        });

        if (result) {
          setModel(result);
          form.reset({
            alias: result.alias,
            name: result.name,
            provider: result.provider,
            baseUrl: result.baseUrl,
            apiKey: result.apiKey,
          });
        } else {
          setError("Model not found");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch model");
      } finally {
        setLoading(false);
      }
    };

    fetchModel();
  }, [id, form]);

  const onSubmit = async (data: UpdateModelData) => {
    if (!id) return;

    try {
      setSaving(true);
      setError(null);

      await callResource("tech.mycelia.mongo", {
        action: "updateOne",
        collection: "llm_models",
        query: { _id: { $oid: id } },
        update: {
          $set: {
            ...data,
            updatedAt: new Date(),
          },
        },
      });

      navigate("/settings/llms");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update model");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!id || !confirm("Are you sure you want to delete this model?")) {
      return;
    }

    try {
      await callResource("tech.mycelia.mongo", {
        action: "deleteOne",
        collection: "llm_models",
        query: { _id: { $oid: id } },
      });
      navigate("/settings/llms");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete model");
    }
  };

  const handleDuplicate = () => {
    if (!model) return;

    const searchParams = new URLSearchParams({
      alias: model.alias,
      name: model.name,
      provider: model.provider,
      baseUrl: model.baseUrl,
      apiKey: model.apiKey,
    });

    navigate(`/settings/llms/new?${searchParams.toString()}`);
  };

  const handleTest = async () => {
    if (!model) return;

    try {
      setTesting(true);
      setTestResult(null);
      setError(null);
      setStreamingResponse("");
      setIsStreaming(true);

      const llm = getLLM(model.alias);
      const stream = await llm.stream([{ role: "user", content: testMessage }]);

      let fullResponse = "";

      for await (const chunk of stream) {
        const content = chunk.content;
        if (content) {
          fullResponse += content;
          setStreamingResponse(fullResponse);
        }
      }

      setTestResult({
        success: true,
        response: { content: fullResponse },
      });
    } catch (err) {
      setTestResult({
        success: false,
        error: err instanceof Error ? err.message : "Test request failed",
      });
    } finally {
      setTesting(false);
      setIsStreaming(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-semibold">Loading...</h2>
        <div className="border rounded-lg p-8 text-center">
          <p className="text-muted-foreground">Loading model details...</p>
        </div>
      </div>
    );
  }

  if (error || !model) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link to="/settings/llms">
            <Button variant="outline" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
          </Link>
          <h2 className="text-2xl font-semibold">Error</h2>
        </div>
        <div className="border rounded-lg p-8 text-center">
          <p className="text-red-500">{error || "Model not found"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/settings/llms">
            <Button variant="outline" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
          </Link>
          <h2 className="text-2xl font-semibold">{model.alias}</h2>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={handleDuplicate}
          >
            <Copy className="w-4 h-4 mr-2" />
            Duplicate
          </Button>
          <Button
            variant="outline"
            onClick={handleDelete}
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Delete
          </Button>
        </div>
      </div>

      <Card className="p-6">
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-md">
              <p className="text-red-600">{error}</p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="alias">Alias *</Label>
              <Input
                id="alias"
                {...form.register("alias")}
                className={form.formState.errors.alias ? "border-red-500" : ""}
              />
              {form.formState.errors.alias && (
                <p className="text-sm text-red-500">
                  {form.formState.errors.alias.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">Model Name *</Label>
              <Input
                id="name"
                {...form.register("name")}
                className={form.formState.errors.name ? "border-red-500" : ""}
              />
              {form.formState.errors.name && (
                <p className="text-sm text-red-500">
                  {form.formState.errors.name.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="provider">Provider *</Label>
              <Input
                id="provider"
                {...form.register("provider")}
                className={form.formState.errors.provider
                  ? "border-red-500"
                  : ""}
              />
              {form.formState.errors.provider && (
                <p className="text-sm text-red-500">
                  {form.formState.errors.provider.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="baseUrl">Base URL *</Label>
              <Input
                id="baseUrl"
                {...form.register("baseUrl")}
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
          </div>

          <div className="space-y-2">
            <Label htmlFor="apiKey">API Key *</Label>
            <Input
              id="apiKey"
              type="password"
              {...form.register("apiKey")}
              className={form.formState.errors.apiKey ? "border-red-500" : ""}
            />
            {form.formState.errors.apiKey && (
              <p className="text-sm text-red-500">
                {form.formState.errors.apiKey.message}
              </p>
            )}
          </div>

          <div className="flex justify-end gap-4">
            <Link to="/settings/llms">
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Link>
            <Button type="submit" disabled={saving}>
              {saving
                ? (
                  "Saving..."
                )
                : (
                  <>
                    <Save className="w-4 h-4 mr-2" />
                    Save Changes
                  </>
                )}
            </Button>
          </div>
        </form>
      </Card>

      {/* Test Request Section */}
      <Card className="p-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Test Model</h3>
            <Button
              onClick={handleTest}
              disabled={testing || !model}
              variant="outline"
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
                    <Play className="w-4 h-4 mr-2" />
                    Test Request
                  </>
                )}
            </Button>
          </div>

          <div className="space-y-2">
            <Label htmlFor="testMessage">Test Message</Label>
            <Textarea
              id="testMessage"
              value={testMessage}
              onChange={(e) => setTestMessage(e.target.value)}
              placeholder="Enter a test message to send to the model..."
              rows={3}
            />
          </div>

          {/* Streaming Response Display */}
          {isStreaming && (
            <div className="space-y-2">
              <Label>Streaming Response:</Label>
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
                <div className="text-sm text-blue-800 whitespace-pre-wrap">
                  {streamingResponse}
                  <span className="animate-pulse">|</span>
                </div>
              </div>
            </div>
          )}

          {testResult && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                {testResult.success
                  ? <CheckCircle className="w-5 h-5 text-green-500" />
                  : <XCircle className="w-5 h-5 text-red-500" />}
                <span
                  className={`font-medium ${
                    testResult.success ? "text-green-700" : "text-red-700"
                  }`}
                >
                  {testResult.success ? "Test Successful" : "Test Failed"}
                </span>
              </div>

              {testResult.success && testResult.response && (
                <div className="space-y-2">
                  <Label>Final Response:</Label>
                  <div className="p-3 bg-green-50 border border-green-200 rounded-md">
                    <div className="text-sm text-green-800 whitespace-pre-wrap">
                      {testResult.response.content ||
                        JSON.stringify(testResult.response, null, 2)}
                    </div>
                  </div>
                </div>
              )}

              {!testResult.success && testResult.error && (
                <div className="space-y-2">
                  <Label>Error:</Label>
                  <div className="p-3 bg-red-50 border border-red-200 rounded-md">
                    <p className="text-sm text-red-800">{testResult.error}</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
};

export default LLMDetailPage;
