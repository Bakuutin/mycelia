import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { callResource } from "@/lib/api";
import { z } from "zod";
import { zServerConfig, zPrompt } from "@myceliasdk/config.ts";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ModelSelector } from "@/components/ModelSelector";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import type { Prompt } from "@/types/config";

const SERVER_CONFIG_ID = "000000000000000000000000";

interface SummarizeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  startDate: Date;
  endDate: Date;
  objectId?: string;
  title?: string;
  description?: string;
  defaultModel?: string;
}

export function SummarizeDialog({
  open,
  onOpenChange,
  startDate,
  endDate,
  objectId,
  title = "Summarize Range",
  description = "Create a summary of all conversations within the selected time range.",
  defaultModel = "medium",
}: SummarizeDialogProps) {
  const [summarizePrompt, setSummarizePrompt] = useState("");
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>(defaultModel);
  const [selectedPromptId, setSelectedPromptId] = useState<string>("custom");
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      const fetchData = async () => {
        // Reset model to defaultModel at the start, before async operations
        // This ensures deterministic order: reset first, then override with prompt's model if found
        setSelectedModel(defaultModel);

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

          const config = configData ? zServerConfig.parse(configData) : null;
          const parsedPrompts = z.array(zPrompt).parse(promptsData);
          setPrompts(parsedPrompts);

          const defaultId = config?.prompts?.summarization_system?.toString();
          if (defaultId) {
            const defaultPrompt = parsedPrompts.find((p) => p._id.toString() === defaultId);
            if (defaultPrompt) {
              setSelectedPromptId(defaultId);
              setSummarizePrompt(defaultPrompt.text);
              // If the default prompt has a model configured, use it
              if (defaultPrompt.model) {
                setSelectedModel(defaultPrompt.model);
              }
            }
          }
        } catch (e) {
          console.error("Failed to fetch prompts or config", e);
          setError("Failed to load prompts");
        }
      };
      fetchData();
    } else {
      resetDialog();
    }
  }, [open, defaultModel]);

  const resetDialog = () => {
    setJobStatus(null);
    setError(null);
    setSummarizePrompt("");
    setSelectedPromptId("custom");
  };

  const handlePromptChange = (promptId: string) => {
    setSelectedPromptId(promptId);
    if (promptId === "custom") {
      setSummarizePrompt("");
    } else {
      const prompt = prompts.find((p) => p._id.toString() === promptId);
      if (prompt) {
        setSummarizePrompt(prompt.text);
        // If the prompt has a model configured, use it
        if (prompt.model) {
          setSelectedModel(prompt.model);
        }
      }
    }
  };

  const handleSubmit = async () => {
    setJobStatus("starting");
    setError(null);

    // Get the selected prompt's name for tracking
    const selectedPrompt = prompts.find((p) => p._id.toString() === selectedPromptId);
    const promptName = selectedPrompt?.name || (selectedPromptId === "custom" ? "Custom" : undefined);

    try {
      const response = await callResource("jobs", {
        action: "enqueue",
        data: {
          type: "summarization",
          start: startDate,
          end: endDate,
          prompt: summarizePrompt || undefined,
          promptName: promptName,
          model: selectedModel || undefined,
          objectId: objectId || undefined,
        },
        trigger: {
          type: "manual",
          reason: `Manual summarization from ${objectId ? "conversation" : "timeline"}`,
        },
      }) as { jobId?: string; jobType?: string };

      const jobId = response.jobId;
      if (!jobId) {
        throw new Error("No job ID returned");
      }

      // Job enqueued successfully - close dialog immediately and show toast
      toast.success("Summarization job queued", {
        description: "Check Jobs page to track progress.",
        duration: 5000,
      });
      onOpenChange(false);
    } catch (e) {
      console.error("Failed to start summarization", e);
      setError("Failed to start summarization job");
      setJobStatus(null);
    }
  };

  const getButtonText = () => {
    switch (jobStatus) {
      case "starting":
        return "Starting...";
      case "waiting":
        return "Waiting...";
      case "active":
        return "Processing...";
      case "delayed":
        return "Delayed...";
      case "completed":
        return "Completed";
      case "failed":
        return "Failed";
      default:
        return "Start Job";
    }
  };

  const isJobInProgress = jobStatus && ["starting", "waiting", "active", "delayed"].includes(jobStatus);
  const isJobComplete = jobStatus === "completed";
  const isJobFailed = jobStatus === "failed";
  const isButtonDisabled = isJobInProgress || isJobComplete;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="grid w-full gap-4 py-4">
          {error && (
            <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              <XCircle className="h-4 w-4" />
              {error}
            </div>
          )}

          <div className="grid gap-2">
            <Label>Model</Label>
            <ModelSelector
              value={selectedModel}
              onChange={setSelectedModel}
              disabled={isJobInProgress || isJobComplete}
              placeholder="Select model..."
            />
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="prompt-select">Prompt Template</Label>
              <Link
                to="/settings/prompts"
                className="text-xs text-primary hover:underline"
                onClick={() => onOpenChange(false)}
              >
                Manage Prompts
              </Link>
            </div>
            <Select
              value={selectedPromptId}
              onValueChange={handlePromptChange}
              disabled={isJobInProgress || isJobComplete}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select prompt" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="custom">Custom / None</SelectItem>
                {prompts.map((prompt) => (
                  <SelectItem
                    key={prompt._id.toString()}
                    value={prompt._id.toString()}
                  >
                    {prompt.name}
                    {prompt.model && (
                      <span className="ml-2 text-muted-foreground text-xs">
                        ({prompt.model})
                      </span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="prompt">System Prompt</Label>
            <Textarea
              id="prompt"
              placeholder="You are a helpful assistant..."
              value={summarizePrompt}
              onChange={(e) => {
                setSummarizePrompt(e.target.value);
                if (selectedPromptId !== "custom") setSelectedPromptId("custom");
              }}
              className="min-h-[100px]"
              disabled={isJobInProgress || isJobComplete}
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={isButtonDisabled}>
            {isJobInProgress && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            {isJobComplete && (
              <CheckCircle2 className="mr-2 h-4 w-4" />
            )}
            {isJobFailed && (
              <XCircle className="mr-2 h-4 w-4" />
            )}
            {getButtonText()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


