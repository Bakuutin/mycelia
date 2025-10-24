import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { callResource } from '@/lib/api';
import type { Object } from '@/types/objects';
import { Button } from '@/components/ui/button';
import { Package } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { IconDisplay } from '@/components/IconDisplay';

const ObjectsPage = () => {
  const [objects, setObjects] = useState<Object[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchObjects = async () => {
      try {
        const result = await callResource("tech.mycelia.mongo", {
          action: "find",
          collection: "objects",
          query: {},
          options: { sort: { name: 1 } }
        });
        setObjects(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch objects');
      } finally {
        setLoading(false);
      }
    };

    fetchObjects();
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Objects</h1>
        <div className="border rounded-lg p-8 text-center">
          <p className="text-muted-foreground">Loading objects...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Objects</h1>
        <div className="border rounded-lg p-8 text-center">
          <p className="text-red-500">Error: {error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Objects</h1>
      </div>

      {objects.length === 0 ? (
        <Card className="p-8 text-center">
          <Package className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <p className="text-muted-foreground">
            No objects found. Objects are created through the application.
          </p>
        </Card>
      ) : (
        <div className="grid gap-4">
          {objects.map((object) => (
            <Link
              key={object._id.toString()}
              to={`/objects/${object._id.toString()}`}
            >
              <Card className="p-4 hover:border-primary transition-colors">
                <div className="flex items-start gap-4">
                  <IconDisplay icon={object.icon} fallback="📦" />
                  <div className="flex-1 space-y-1">
                    <h3 className="font-semibold">{object.name}</h3>
                    {object.details && (
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {object.details}
                      </p>
                    )}
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
};

export default ObjectsPage;

