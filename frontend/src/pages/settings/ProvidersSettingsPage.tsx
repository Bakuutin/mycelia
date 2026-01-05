import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { callResource } from "@/lib/api";
import type { Provider } from "@/types/llm";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Server, Plus, Settings, Trash2 } from "lucide-react";

const ProvidersSettingsPage = () => {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchProviders = async () => {
      try {
        const result = await callResource("mongo", {
          action: "find",
          collection: "inference_providers",
          query: {},
          options: { sort: { type: 1, name: 1 } },
        });
        setProviders(result);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to fetch providers",
        );
      } finally {
        setLoading(false);
      }
    };

    fetchProviders();
  }, []);

  const handleDelete = async (providerId: string) => {
    if (!confirm("Are you sure you want to delete this provider?")) {
      return;
    }

    try {
      await callResource("mongo", {
        action: "deleteOne",
        collection: "inference_providers",
        query: { _id: { $oid: providerId } },
      });
      setProviders(providers.filter((p) => p._id.toString() !== providerId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete provider");
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold mb-2">Inference Providers</h2>
          <p className="text-muted-foreground">
            Manage your inference providers (LLM and transcription services).
          </p>
        </div>
        <div className="border rounded-lg p-8 text-center">
          <p className="text-muted-foreground">Loading providers...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold mb-2">Inference Providers</h2>
          <p className="text-muted-foreground">
            Manage your inference providers (LLM and transcription services).
          </p>
        </div>
        <div className="border rounded-lg p-8 text-center">
          <p className="text-red-500">Error: {error}</p>
        </div>
      </div>
    );
  }

  const llmProviders = providers.filter((p) => p.type === "llm");
  const transcriptionProviders = providers.filter((p) => p.type === "transcription");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold mb-2">Inference Providers</h2>
          <p className="text-muted-foreground">
            Manage your inference providers (LLM and transcription services).
          </p>
        </div>
        <Link to="/settings/providers/new">
          <Button>
            <Plus className="w-4 h-4 mr-2" />
            Add Provider
          </Button>
        </Link>
      </div>

      <div className="space-y-6">
        {/* LLM Providers */}
        {llmProviders.length > 0 && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">LLM Providers</h3>
            <div className="grid gap-4">
              {llmProviders.map((provider) => (
                <Card key={provider._id.toString()} className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{provider.name}</h3>
                        <Badge variant="secondary">{provider.type}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {provider.baseUrl}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Link to={`/settings/providers/${provider._id.toString()}`}>
                        <Button variant="outline" size="sm">
                          <Settings className="w-4 h-4" />
                        </Button>
                      </Link>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDelete(provider._id.toString())}
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

        {/* Transcription Providers */}
        {transcriptionProviders.length > 0 && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Transcription Providers</h3>
            <div className="grid gap-4">
              {transcriptionProviders.map((provider) => (
                <Card key={provider._id.toString()} className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{provider.name}</h3>
                        <Badge variant="secondary">{provider.type}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {provider.baseUrl}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Link to={`/settings/providers/${provider._id.toString()}`}>
                        <Button variant="outline" size="sm">
                          <Settings className="w-4 h-4" />
                        </Button>
                      </Link>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDelete(provider._id.toString())}
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

        {providers.length === 0 && (
          <div className="border rounded-lg p-8 text-center">
            <Server className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">
              No providers configured. Add a provider to get started.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ProvidersSettingsPage;



