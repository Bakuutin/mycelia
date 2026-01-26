import { useEffect, useState, useRef } from "react";
import { callResource } from "@/lib/api";
import { subscribeToJob } from "@/lib/jobs";
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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
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
}

export function SummarizeDialog({
  open,
  onOpenChange,
  startDate,
  endDate,
  objectId,
  title = "Summarize Range",
  description = "Create a summary of all conversations within the selected time range.",
}: SummarizeDialogProps) {
  const [summarizePrompt, setSummarizePrompt] = useState("");
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("medium");
  const [selectedPromptId, setSelectedPromptId] = useState<string>("custom");
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (open) {
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

          const config = configData ? zServerConfig.parse(configData) : null;
          const parsedPrompts = z.array(zPrompt).parse(promptsData);
          setPrompts(parsedPrompts);

          const defaultId = config?.prompts?.summarization_system?.toString();
          if (defaultId) {
            const defaultPrompt = parsedPrompts.find((p) => p._id.toString() === defaultId);
            if (defaultPrompt) {
              setSelectedPromptId(defaultId);
              setSummarizePrompt(defaultPrompt.text);
            }
          }

          if (!selectedModel) {
            setSelectedModel("medium");
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
  }, [open]);

  const resetDialog = () => {
    setJobStatus(null);
    setError(null);
    setSummarizePrompt("");
    setSelectedPromptId("custom");
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }
  };

  const handlePromptChange = (promptId: string) => {
    setSelectedPromptId(promptId);
    if (promptId === "custom") {
      setSummarizePrompt("");
    } else {
      const prompt = prompts.find((p) => p._id.toString() === promptId);
      if (prompt) {
        setSummarizePrompt(prompt.text);
      }
    }
  };

  const handleSubmit = async () => {
    setJobStatus("starting");
    setError(null);

    try {
      const response = await callResource("jobs", {
        action: "enqueue",
        data: {
          type: "summarization",
          start: startDate,
          end: endDate,
          prompt: summarizePrompt || undefined,
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

      setJobStatus("waiting");

      unsubscribeRef.current = subscribeToJob(jobId, (update) => {
        setJobStatus(update.state);

        if (update.state === "active" || update.state === "started") {
          toast.success("Summarization started", {
            description: "Check Jobs or the timeline when it's done.",
            duration: 5000,
          });
          if (unsubscribeRef.current) {
            unsubscribeRef.current();
            unsubscribeRef.current = null;
          }
          onOpenChange(false);
        } else if (update.state === "failed") {
          setError(update.failedReason || "Summarization job failed");
        }
      });
    } catch (e) {
      console.error("Failed to start summarization", e);
      setError("Failed to start summarization job");
      setJobStatus(null);
    }
  };

  useEffect(() => {
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
    };
  }, []);

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
            <Label htmlFor="model">Model</Label>
            <Input
              id="model"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              placeholder="e.g., gpt-4, gpt-3.5-turbo, medium"
              disabled={isJobInProgress || isJobComplete}
            />
            <p className="text-xs text-muted-foreground">
              Enter the model name to use for summarization
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="prompt-select">Prompt Template</Label>
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


