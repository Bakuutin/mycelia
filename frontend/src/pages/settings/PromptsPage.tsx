import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ObjectId } from "bson";
import { z } from "zod";
import { callResource } from "@/lib/api";
import type { Prompt, ServerConfig } from "@/types/config";
import { zPrompt, zServerConfig, zServerConfigPrompts, PROMPT_TASK_LABELS } from "@myceliasdk/config.ts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Settings, Trash2, FileText, CheckCircle2, Bot, MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

const SERVER_CONFIG_ID = "000000000000000000000000";

// Group prompt tasks by category for clearer UI
const PROMPT_CATEGORIES = {
  "Conversation Processing": {
    icon: MessageSquare,
    description: "Used by the conversation_extractor and summarization workers to process audio transcripts.",
    tasks: ["segmentation_system", "segmentation_guidance", "summarization_system", "summarization_guidance"],
  },
  "Chat Assistant": {
    icon: Bot,
    description: "Used by the AI chat assistant when you interact with it.",
    tasks: ["chat_system"],
  },
} as const;

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
          Configure which prompts are used by different parts of the system.
        </p>
      </div>

      {/* Assignments by Category */}
      {Object.entries(PROMPT_CATEGORIES).map(([categoryName, category]) => {
        const CategoryIcon = category.icon;
        return (
          <Card key={categoryName} className="p-6">
            <div className="flex items-center gap-2 mb-2">
              <CategoryIcon className="w-5 h-5 text-primary" />
              <h3 className="text-lg font-semibold">{categoryName}</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              {category.description}
            </p>
            <div className="space-y-4">
              {category.tasks.map((taskKey) => {
                const currentPromptId = config.prompts[taskKey as keyof ServerConfig["prompts"]];
                const currentPrompt = prompts.find(p => p._id.toString() === currentPromptId?.toString());
                return (
                  <div key={taskKey} className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start border-l-2 border-muted pl-4">
                    <div className="md:col-span-2">
                      <div className="font-medium text-sm">{PROMPT_TASK_LABELS[taskKey as keyof typeof PROMPT_TASK_LABELS] || taskKey}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {zServerConfigPrompts.shape[taskKey as keyof typeof zServerConfigPrompts.shape].description}
                      </div>
                    </div>
                    <div className="md:col-span-1">
                      <Select
                        value={currentPromptId?.toString()}
                        onValueChange={(val) => handlePromptAssignment(taskKey as keyof ServerConfig["prompts"], val)}
                      >
                        <SelectTrigger className={!currentPromptId ? "border-amber-500/50" : ""}>
                          <SelectValue placeholder="⚠️ Not configured" />
                        </SelectTrigger>
                        <SelectContent>
                          {prompts.map((prompt) => (
                            <SelectItem key={prompt._id.toString()} value={prompt._id.toString()}>
                              {prompt.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {currentPrompt && (
                        <p className="text-xs text-muted-foreground mt-1 truncate" title={currentPrompt.text}>
                          {currentPrompt.text.slice(0, 60)}...
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        );
      })}

      {/* Library Section */}
      <Separator />
      
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">Prompt Library</h3>
            <p className="text-sm text-muted-foreground">
              All available prompts. Edit or create new ones to customize system behavior.
            </p>
          </div>
          <Link to="/settings/prompts/new">
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              New Prompt
            </Button>
          </Link>
        </div>
        
        <div className="grid gap-3">
          {prompts.map((prompt) => {
            // Find which tasks this prompt is assigned to
            const assignedTasks = Object.entries(config.prompts)
              .filter(([_, promptId]) => promptId?.toString() === prompt._id.toString())
              .map(([taskKey]) => PROMPT_TASK_LABELS[taskKey as keyof typeof PROMPT_TASK_LABELS] || taskKey);
            const isInUse = assignedTasks.length > 0;
            
            return (
              <Card key={prompt._id.toString()} className={`p-3 ${isInUse ? "border-green-500/30 bg-green-500/5" : "opacity-60"}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    {isInUse ? (
                      <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                    ) : (
                      <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium text-sm truncate">{prompt.name}</h4>
                        {isInUse && (
                          <div className="flex gap-1 flex-wrap">
                            {assignedTasks.map((task) => (
                              <Badge key={task} variant="secondary" className="text-xs bg-green-500/10 text-green-700 dark:text-green-400">
                                {task}
                              </Badge>
                            ))}
                          </div>
                        )}
                        {!isInUse && (
                          <Badge variant="outline" className="text-xs text-muted-foreground">
                            unused
                          </Badge>
                        )}
                      </div>
                      {prompt.description && (
                        <p className="text-xs text-muted-foreground truncate">
                          {prompt.description}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Link to={`/settings/prompts/${prompt._id.toString()}`}>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                        <Settings className="w-4 h-4" />
                      </Button>
                    </Link>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-red-500 hover:text-red-700 hover:bg-red-500/10"
                      onClick={() => handleDeletePrompt(prompt._id.toString())}
                      disabled={isInUse}
                      title={isInUse ? "Unassign this prompt before deleting" : "Delete prompt"}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default PromptsPage;

