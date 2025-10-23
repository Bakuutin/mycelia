import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { callResource } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Save } from 'lucide-react';
import { Link } from 'react-router-dom';

const createModelSchema = z.object({
  alias: z.string().min(1, 'Alias is required').max(50, 'Alias must be less than 50 characters'),
  name: z.string(),
  provider: z.string().optional(),
  baseUrl: z.string().url('Must be a valid URL'),
  apiKey: z.string().optional(),
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
      alias: '',
      name: '',
      provider: '',
      baseUrl: '',
      apiKey: '',
    },
  });

  // Handle pre-filling form from URL parameters (for duplication)
  useEffect(() => {
    const alias = searchParams.get('alias');
    const name = searchParams.get('name');
    const provider = searchParams.get('provider');
    const baseUrl = searchParams.get('baseUrl');
    const apiKey = searchParams.get('apiKey');

    if (alias || name || provider || baseUrl || apiKey) {
      form.reset({
        alias: alias || '',
        name: name || '',
        provider: provider || '',
        baseUrl: baseUrl || '',
        apiKey: apiKey || '',
      });
    }
  }, [searchParams, form]);

  const onSubmit = async (data: CreateModelData) => {
    try {
      setSaving(true);
      setError(null);

      const result = await callResource("tech.mycelia.mongo", {
        action: "insertOne",
        collection: "llm_models",
        doc: {
          alias: data.alias,
          name: data.name,
          provider: data.provider,
          baseUrl: data.baseUrl,
          apiKey: data.apiKey,
        }
      });

      if (result.insertedId) {
        navigate('/settings/llms');
      } else {
        setError('Failed to create model');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create model');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link to="/settings/llms">
          <Button variant="outline" size="sm">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
        </Link>
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
                {...form.register('alias')}
                placeholder="e.g., small, medium, large, or custom name"
                className={form.formState.errors.alias ? 'border-red-500' : ''}
              />
              <p className="text-sm text-muted-foreground">
                Use predefined aliases (small, medium, large) or create a custom one
              </p>
              {form.formState.errors.alias && (
                <p className="text-sm text-red-500">{form.formState.errors.alias.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">Model Name *</Label>
              <Input
                id="name"
                {...form.register('name')}
                placeholder="e.g., gpt-4-turbo-preview"
                className={form.formState.errors.name ? 'border-red-500' : ''}
              />
              {form.formState.errors.name && (
                <p className="text-sm text-red-500">{form.formState.errors.name.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="provider">Provider *</Label>
              <Input
                id="provider"
                {...form.register('provider')}
                placeholder="e.g., OpenAI, Anthropic, etc."
                className={form.formState.errors.provider ? 'border-red-500' : ''}
              />
              {form.formState.errors.provider && (
                <p className="text-sm text-red-500">{form.formState.errors.provider.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="baseUrl">Base URL *</Label>
              <Input
                id="baseUrl"
                {...form.register('baseUrl')}
                placeholder="https://api.openai.com/v1"
                className={form.formState.errors.baseUrl ? 'border-red-500' : ''}
              />
              {form.formState.errors.baseUrl && (
                <p className="text-sm text-red-500">{form.formState.errors.baseUrl.message}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="apiKey">API Key *</Label>
            <Input
              id="apiKey"
              type="password"
              {...form.register('apiKey')}
              placeholder="Enter your API key"
              className={form.formState.errors.apiKey ? 'border-red-500' : ''}
            />
            {form.formState.errors.apiKey && (
              <p className="text-sm text-red-500">{form.formState.errors.apiKey.message}</p>
            )}
          </div>

          <div className="flex justify-end gap-4">
            <Link to="/settings/llms">
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Link>
            <Button type="submit" disabled={saving}>
              {saving ? (
                'Creating...'
              ) : (
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
