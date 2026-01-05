import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { callResource } from "@/lib/api";
import type { Provider } from "@/types/llm";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Save } from "lucide-react";
import { SmartBackButton } from "@/components/SmartBackButton";

const createModelSchema = z.object({
  alias: z.string().min(1, "Alias is required").max(
    50,
    "Alias must be less than 50 characters",
  ),
  name: z.string().min(1, "Model name is required"),
});

type CreateModelData = z.infer<typeof createModelSchema>;

const CreateLLMPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<CreateModelData>({
    resolver: zodResolver(createModelSchema),
    defaultValues: {
      alias: "",
      name: "",
    },
  });

  useEffect(() => {
    const alias = searchParams.get("alias");
    const name = searchParams.get("name");

    if (alias || name) {
      form.reset({
        alias: alias || "",
        name: name || "",
      });
    }
  }, [searchParams, form]);

  const onSubmit = async (data: CreateModelData) => {
    try {
      setSaving(true);
      setError(null);

      const result = await callResource("mongo", {
        action: "insertOne",
        collection: "llm_models",
        doc: {
          alias: data.alias,
          name: data.name,
        },
      });

      if (result.insertedId) {
        navigate("/settings/inference");
      } else {
        setError("Failed to create model");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create model");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <SmartBackButton defaultPath="/settings/inference" variant="outline" />
        <h2 className="text-2xl font-semibold">Add LLM Model</h2>
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
                placeholder="e.g., small, medium, large, or custom name"
                className={form.formState.errors.alias ? "border-red-500" : ""}
              />
              <p className="text-sm text-muted-foreground">
                Use predefined aliases (small, medium, large) or create a custom
                one
              </p>
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
                placeholder="e.g., gpt-4-turbo-preview"
                className={form.formState.errors.name ? "border-red-500" : ""}
              />
              {form.formState.errors.name && (
                <p className="text-sm text-red-500">
                  {form.formState.errors.name.message}
                </p>
              )}
            </div>

            <div className="space-y-2 md:col-span-2">
              <div className="p-3 bg-muted rounded-md">
                <p className="text-sm text-muted-foreground">
                  Models use the inference provider configured in{" "}
                  <Link to="/settings/inference" className="text-primary underline">
                    Inference settings
                  </Link>
                  .
                </p>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-4">
            <Link to="/settings/inference">
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Link>
            <Button type="submit" disabled={saving}>
              {saving
                ? (
                  "Creating..."
                )
                : (
                  <>
                    <Save className="w-4 h-4 mr-2" />
                    Create Model
                  </>
                )}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
};

export default CreateLLMPage;
