import { useEffect, useState } from "react";
import { api, callResource } from "@/lib/api";
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
import type { Model } from "@/types/llm";
import type { Prompt } from "@/types/config";

interface SummarizeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSummarize: (prompt?: string, model?: string) => Promise<void>;
  title?: string;
  description?: string;
}

export function SummarizeDialog({
  open,
  onOpenChange,
  onSummarize,
  title = "Summarize Range",
  description = "Create a summary of all conversations within the selected time range.",
}: SummarizeDialogProps) {
  const [summarizePrompt, setSummarizePrompt] = useState("");
  const [models, setModels] = useState<Model[]>([]);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [selectedPromptId, setSelectedPromptId] = useState<string>("custom");
  const [loading, setLoading] = useState(false);

  // Fetch Models and Prompts when Dialog opens
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

          // Set default model if available
          if (modelsData.length > 0 && !selectedModel) {
            const defaultModel =
              modelsData.find((m: any) => m.alias === "medium") ||
              modelsData[0];
            if (defaultModel) setSelectedModel(defaultModel.alias);
          }
        } catch (e) {
          console.error("Failed to fetch models or prompts", e);
        }
      };
      fetchData();
    }
  }, [open]);

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
    setLoading(true);
    try {
      await onSummarize(summarizePrompt, selectedModel);
      setSummarizePrompt("");
      setSelectedPromptId("custom");
      onOpenChange(false);
    } catch (e) {
      console.error("Summarization failed", e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="grid w-full gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="model">Model</Label>
            <Select value={selectedModel} onValueChange={setSelectedModel}>
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
            <Select value={selectedPromptId} onValueChange={handlePromptChange}>
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
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? "Starting..." : "Start Job"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

