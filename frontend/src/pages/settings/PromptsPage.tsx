import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ObjectId } from "bson";
import { z } from "zod";
import { callResource } from "@/lib/api";
import type { Prompt, ServerConfig } from "@/types/config";
import { zPrompt, zServerConfig, zServerConfigPrompts, PROMPT_TASK_LABELS } from "@interfaces/config.ts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Settings, Trash2, FileText } from "lucide-react";

const SERVER_CONFIG_ID = "000000000000000000000000";

const PromptsPage = () => {
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [configData, promptsData] = await Promise.all([
          callResource("mongo", {
            action: "findOne",
            collection: "configs",
            query: { _id: { $oid: SERVER_CONFIG_ID } },
          }),
          callResource("mongo", {
            action: "find",
            collection: "prompts",
            query: {},
            options: { sort: { name: 1 } },
          }),
        ]);

        const parsedConfig = zServerConfig.parse(configData);
        const parsedPrompts = z.array(zPrompt).parse(promptsData);
        
        setConfig(parsedConfig);
        setPrompts(parsedPrompts);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to fetch server config",
        );
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const handlePromptAssignment = async (taskKey: keyof ServerConfig["prompts"], promptId: string) => {
    if (!config) return;

    const previousConfig = config;
    const promptObjectId = new ObjectId(promptId);

    const newConfig = {
        ...config,
        prompts: {
            ...config.prompts,
            [taskKey]: promptObjectId
        }
    };
    setConfig(newConfig);

    try {
      await callResource("mongo", {
        action: "updateOne",
        collection: "configs",
        query: { _id: { $oid: SERVER_CONFIG_ID } },
        update: {
          $set: {
            [`prompts.${taskKey}`]: { $oid: promptId },
            updatedAt: new Date(),
          },
        },
      });
    } catch (err) {
      setConfig(previousConfig);
      console.error("Failed to update prompt assignment", err);
    }
  };
  
  const handleDeletePrompt = async (promptId: string) => {
    // Check if prompt is in use
    if (config && Object.values(config.prompts).some(id => id.toString() === promptId)) {
        alert("Cannot delete a prompt that is currently assigned to a task. Please reassign the task first.");
        return;
    }

    if (!confirm("Are you sure you want to delete this prompt?")) {
      return;
    }

    try {
      await callResource("mongo", {
        action: "deleteOne",
        collection: "prompts",
        query: { _id: { $oid: promptId } },
      });
      setPrompts(prompts.filter((p) => p._id.toString() !== promptId));
    } catch (err) {
      console.error("Failed to delete prompt", err);
      alert("Failed to delete prompt");
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-semibold mb-2">Prompts</h2>
        <div className="border rounded-lg p-8 text-center">
          <p className="text-muted-foreground">Loading prompts...</p>
        </div>
      </div>
    );
  }

  if (error || !config) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-semibold mb-2">Prompts</h2>
        <div className="border rounded-lg p-8 text-center">
          <p className="text-red-500">Error: {error || "Configuration not found"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold mb-2">Prompts</h2>
        <p className="text-muted-foreground">
          Manage system prompts and assign them to tasks.
        </p>
      </div>

      {/* Assignments Section */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">Prompt Assignments</h3>
        <div className="space-y-4">
          {Object.keys(zServerConfigPrompts.shape).map((taskKey) => {
             const currentPromptId = config.prompts[taskKey as keyof ServerConfig["prompts"]];
            return (
            <div key={taskKey} className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
              <div className="md:col-span-2">
                <div className="font-medium">{PROMPT_TASK_LABELS[taskKey as keyof typeof PROMPT_TASK_LABELS] || taskKey}</div>
                <div className="text-sm text-muted-foreground">
                  {zServerConfigPrompts.shape[taskKey as keyof typeof zServerConfigPrompts.shape].description}
                </div>
              </div>
              <div className="md:col-span-1">
                <Select
                  value={currentPromptId?.toString()}
                  onValueChange={(val) => handlePromptAssignment(taskKey as keyof ServerConfig["prompts"], val)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a prompt" />
                  </SelectTrigger>
                  <SelectContent>
                    {prompts.map((prompt) => (
                      <SelectItem key={prompt._id.toString()} value={prompt._id.toString()}>
                        {prompt.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            );
          })}
        </div>
      </Card>

      {/* Library Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Prompt Library</h3>
          <Link to="/settings/prompts/new">
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              New Prompt
            </Button>
          </Link>
        </div>
        
        <div className="grid gap-4">
          {prompts.map((prompt) => (
            <Card key={prompt._id.toString()} className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <FileText className="w-4 h-4 text-muted-foreground" />
                    <h4 className="font-semibold truncate">{prompt.name}</h4>
                  </div>
                  {prompt.description && (
                    <p className="text-sm text-muted-foreground mb-2 line-clamp-1">
                      {prompt.description}
                    </p>
                  )}
                  <div className="bg-muted p-2 rounded text-xs font-mono text-muted-foreground line-clamp-2">
                    {prompt.text}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Link to={`/settings/prompts/${prompt._id.toString()}`}>
                    <Button variant="outline" size="sm">
                      <Settings className="w-4 h-4" />
                    </Button>
                  </Link>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDeletePrompt(prompt._id.toString())}
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
    </div>
  );
};

export default PromptsPage;

