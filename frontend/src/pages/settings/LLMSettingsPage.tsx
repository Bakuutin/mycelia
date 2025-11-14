import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { callResource } from "@/lib/api";
import type { Model } from "@/types/llm";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Bot, Plus, Settings, Trash2 } from "lucide-react";

const PREDEFINED_ALIASES = ["small", "medium", "large"] as const;

const ModelSkeleton = ({ alias }: { alias: string }) => (
  <Card className="p-4 border-dashed border-2 border-muted-foreground/20">
    <div className="flex items-center justify-between">
      <div className="flex-1 space-y-2">
        <div className="flex items-center gap-2">
          <div className="h-5 w-16 bg-muted animate-pulse rounded"></div>
          <div className="h-5 w-20 bg-muted animate-pulse rounded"></div>
        </div>
        <div className="h-4 w-32 bg-muted animate-pulse rounded"></div>
      </div>
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 bg-muted animate-pulse rounded"></div>
        <div className="h-8 w-8 bg-muted animate-pulse rounded"></div>
      </div>
    </div>
    <div className="mt-2 text-sm text-muted-foreground">
      No {alias} model configured
    </div>
  </Card>
);

const LLMSettingsPage = () => {
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchModels = async () => {
      try {
        const result = await callResource("tech.mycelia.mongo", {
          action: "find",
          collection: "llm_models",
          query: {},
          options: { sort: { alias: 1 } },
        });
        setModels(result);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to fetch LLM models",
        );
      } finally {
        setLoading(false);
      }
    };

    fetchModels();
  }, []);

  const handleDelete = async (modelId: string) => {
    if (!confirm("Are you sure you want to delete this model?")) {
      return;
    }

    try {
      await callResource("tech.mycelia.mongo", {
        action: "deleteOne",
        collection: "llm_models",
        query: { _id: { $oid: modelId } },
      });
      setModels(models.filter((m) => m._id.toString() !== modelId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete model");
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold mb-2">LLM Models</h2>
          <p className="text-muted-foreground">
            Manage your LLM models and providers.
          </p>
        </div>
        <div className="border rounded-lg p-8 text-center">
          <p className="text-muted-foreground">Loading models...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold mb-2">LLM Models</h2>
          <p className="text-muted-foreground">
            Manage your LLM models and providers.
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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold mb-2">LLM Models</h2>
          <p className="text-muted-foreground">
            Manage your LLM models and providers.
          </p>
        </div>
        <Link to="/settings/llms/new">
          <Button>
            <Plus className="w-4 h-4 mr-2" />
            Add Model
          </Button>
        </Link>
      </div>

      <div className="space-y-6">
        {/* Predefined Alias Slots */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Predefined Models</h3>
          <div className="grid gap-4">
            {PREDEFINED_ALIASES.map((alias) => {
              const model = models.find((m) => m.alias === alias);
              return model
                ? (
                  <Card key={model._id.toString()} className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold">{model.alias}</h3>
                          <Badge variant="secondary">{model.provider}</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {model.name} • {model.baseUrl}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Link to={`/settings/llms/${model._id.toString()}`}>
                          <Button variant="outline" size="sm">
                            <Settings className="w-4 h-4" />
                          </Button>
                        </Link>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDelete(model._id.toString())}
                          className="text-red-500 hover:text-red-700"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </Card>
                )
                : <ModelSkeleton key={alias} alias={alias} />;
            })}
          </div>
        </div>

        {/* Custom Models */}
        {models.filter((m) => !PREDEFINED_ALIASES.includes(m.alias as any))
              .length > 0 && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Custom Models</h3>
            <div className="grid gap-4">
              {models
                .filter((m) => !PREDEFINED_ALIASES.includes(m.alias as any))
                .map((model) => (
                  <Card key={model._id.toString()} className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold">{model.alias}</h3>
                          <Badge variant="secondary">{model.provider}</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {model.name} • {model.baseUrl}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Link to={`/settings/llms/${model._id.toString()}`}>
                          <Button variant="outline" size="sm">
                            <Settings className="w-4 h-4" />
                          </Button>
                        </Link>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            handleDelete(model._id.toString())}
                          className="text-red-500 hover:text-red-700"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default LLMSettingsPage;
