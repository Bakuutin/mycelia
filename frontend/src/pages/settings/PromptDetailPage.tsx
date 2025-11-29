import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { callResource } from "@/lib/api";
import { zPrompt, zPromptForm, type PromptFormData } from "@interfaces/config.ts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Save, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils.ts";
import { SmartBackButton } from "@/components/SmartBackButton";

const PromptDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const isNew = !id || id === "new";
  const navigate = useNavigate();
  
  const [loading, setLoading] = useState(!isNew);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const form = useForm<PromptFormData>({
    resolver: zodResolver(zPromptForm),
    defaultValues: {
      name: "",
      description: "",
      text: "",
    },
  });

  useEffect(() => {
    const fetchPrompt = async () => {
      if (isNew) return;

      try {
        setLoading(true);
        const result = await callResource("tech.mycelia.mongo", {
          action: "findOne",
          collection: "prompts",
          query: { _id: { $oid: id } },
        });

        if (result) {
          const parsedPrompt = zPrompt.parse(result);
          form.reset({
            name: parsedPrompt.name,
            description: parsedPrompt.description || "",
            text: parsedPrompt.text,
          });
        } else {
          setError("Prompt not found");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch prompt");
      } finally {
        setLoading(false);
      }
    };

    fetchPrompt();
  }, [id, isNew, form]);

  const onSubmit = async (data: PromptFormData) => {
    try {
      setSaving(true);
      setError(null);

      if (isNew) {
        const result = await callResource("tech.mycelia.mongo", {
          action: "insertOne",
          collection: "prompts",
          doc: {
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
        if (result.insertedId) {
            navigate("/settings/prompts");
        }
      } else {
        await callResource("tech.mycelia.mongo", {
          action: "updateOne",
          collection: "prompts",
          query: { _id: { $oid: id } },
          update: {
            $set: {
              ...data,
              updatedAt: new Date(),
            },
          },
        });
        navigate("/settings/prompts");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save prompt");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
             <SmartBackButton defaultPath="/settings/prompts" variant="outline" />
             <h2 className="text-2xl font-semibold">Loading...</h2>
        </div>
      </div>
    );
  }

  if (error && !isNew) {
     return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
             <SmartBackButton defaultPath="/settings/prompts" variant="outline" />
             <h2 className="text-2xl font-semibold">Error</h2>
        </div>
        <div className="border rounded-lg p-8 text-center">
          <p className="text-red-500">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <SmartBackButton defaultPath="/settings/prompts" variant="outline" />
        <h2 className="text-2xl font-semibold">
            {isNew ? "Create New Prompt" : "Edit Prompt"}
        </h2>
      </div>

      <Card className="p-6">
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-md">
              <p className="text-red-600">{error}</p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="name">Name *</Label>
            <Input
              id="name"
              {...form.register("name")}
              placeholder="e.g., Concise Summarization System"
              className={form.formState.errors.name ? "border-red-500" : ""}
            />
            {form.formState.errors.name && (
              <p className="text-sm text-red-500">
                {form.formState.errors.name.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Input
              id="description"
              {...form.register("description")}
              placeholder="Optional description of what this prompt does"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="text">Prompt Text *</Label>
            <Textarea
              id="text"
              {...form.register("text")}
              placeholder="Enter the prompt text..."
              className={cn(
                  "min-h-[300px] font-mono text-sm",
                  form.formState.errors.text ? "border-red-500" : ""
              )}
            />
            {form.formState.errors.text && (
              <p className="text-sm text-red-500">
                {form.formState.errors.text.message}
              </p>
            )}
          </div>

          <div className="flex justify-end gap-4">
            <Link to="/settings/prompts">
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Link>
            <Button type="submit" disabled={saving}>
              {saving ? (
                  "Saving..."
              ) : (
                  <>
                    <Save className="w-4 h-4 mr-2" />
                    {isNew ? "Create Prompt" : "Save Changes"}
                  </>
              )}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
};

export default PromptDetailPage;

