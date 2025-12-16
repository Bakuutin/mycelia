import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { api, callResource } from "@/lib/api";
import { subscribeToJob } from "@/lib/jobs";
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
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import type { Model } from "@/types/llm";
import type { Prompt } from "@/types/config";

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
  const navigate = useNavigate();
  const [summarizePrompt, setSummarizePrompt] = useState("");
  const [models, setModels] = useState<Model[]>([]);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [selectedPromptId, setSelectedPromptId] = useState<string>("custom");
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (open) {
      const fetchData = async () => {
        try {
          const [modelsData, promptsData] = await Promise.all([
            callResource("mongo", {
              action: "find",
              collection: "llm_models",
              query: {},
              options: { sort: { alias: 1 } },
            }),
            callResource("mongo", {
              action: "find",
              collection: "prompts",
              query: {},
              options: { sort: { name: 1 } },
            }),
          ]);

          setModels(modelsData);
          setPrompts(promptsData);

          if (modelsData.length > 0 && !selectedModel) {
            const defaultModel =
              modelsData.find((m: any) => m.alias === "medium") ||
              modelsData[0];
            if (defaultModel) setSelectedModel(defaultModel.alias);
          }
        } catch (e) {
          console.error("Failed to fetch models or prompts", e);
          setError("Failed to load models and prompts");
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
      const response = await api.post("/api/jobs", {
        type: "summarization",
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        prompt: summarizePrompt || undefined,
        model: selectedModel || undefined,
        objectId: objectId || undefined,
      }) as { jobId?: string; jobType?: string };

      const jobId = response.jobId;
      if (!jobId) {
        throw new Error("No job ID returned");
      }

      setJobStatus("waiting");

      unsubscribeRef.current = subscribeToJob(jobId, (update) => {
        setJobStatus(update.state);

        if (update.state === "completed") {
          setTimeout(() => {
            onOpenChange(false);
            if (objectId) {
              navigate(`/objects/${objectId}`);
            }
          }, 1500);
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

          {isJobComplete && (
            <div className="flex items-center gap-2 rounded-md bg-green-500/10 p-3 text-sm text-green-600 dark:text-green-400">
              <CheckCircle2 className="h-4 w-4" />
              Summary completed successfully
            </div>
          )}

          <div className="grid gap-2">
            <Label htmlFor="model">Model</Label>
            <Select 
              value={selectedModel} 
              onValueChange={setSelectedModel}
              disabled={isJobInProgress || isJobComplete}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select model" />
              </SelectTrigger>
              <SelectContent>
                {models.map((model) => (
                  <SelectItem key={model._id.toString()} value={model.alias}>
                    {model.alias} ({model.name})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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


