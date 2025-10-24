import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { callResource } from '@/lib/api';
import type { Object } from '@/types/objects';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ObjectForm } from '@/components/ObjectForm';
import { ArrowLeft } from 'lucide-react';

const CreateObjectPage = () => {
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [object, setObject] = useState<Partial<Object>>({
    name: '',
    details: '',
    icon: { text: '📦' },
    aliases: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const handleUpdate = async (updates: Partial<Object>) => {
    setObject(prev => ({ ...prev, ...updates }));
  };

  const handleSubmit = async () => {
    if (!object.name?.trim()) {
      setError('Name is required');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const result = await callResource("tech.mycelia.mongo", {
        action: "insertOne",
        collection: "objects",
        doc: {
          ...object,
          name: object.name.trim(),
          createdAt: new Date(),
          updatedAt: new Date(),
        }
      });

      if (result.insertedId) {
        navigate(`/objects/${result.insertedId}`);
      } else {
        throw new Error('Failed to create object');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create object');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/objects')}
          className="flex items-center gap-2"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Objects
        </Button>
        <h1 className="text-3xl font-bold">Create Object</h1>
      </div>

      <Card className="p-6">
        <ObjectForm object={object as Object} onUpdate={handleUpdate} />
        
        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        <div className="flex gap-3 mt-6">
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || !object.name?.trim()}
            className="flex-1"
          >
            {isSubmitting ? 'Creating...' : 'Create Object'}
          </Button>
          <Button
            variant="outline"
            onClick={() => navigate('/objects')}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
        </div>
      </Card>
    </div>
  );
};

export default CreateObjectPage;
