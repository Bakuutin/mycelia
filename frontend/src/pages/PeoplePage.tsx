import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { callResource } from '@/lib/api';
import type { Person } from '@/types/people';
import { Button } from '@/components/ui/button';
import { Users } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { IconDisplay } from '@/components/IconDisplay';

const PeoplePage = () => {
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchPeople = async () => {
      try {
        const result = await callResource("tech.mycelia.mongo", {
          action: "find",
          collection: "people",
          query: {},
          options: { sort: { name: 1 } }
        });
        setPeople(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch people');
      } finally {
        setLoading(false);
      }
    };

    fetchPeople();
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">People</h1>
        <div className="border rounded-lg p-8 text-center">
          <p className="text-muted-foreground">Loading people...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">People</h1>
        <div className="border rounded-lg p-8 text-center">
          <p className="text-red-500">Error: {error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">People</h1>
      </div>

      {people.length === 0 ? (
        <Card className="p-8 text-center">
          <Users className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <p className="text-muted-foreground">
            No people found. People are created automatically when you add participants to conversations.
          </p>
        </Card>
      ) : (
        <div className="grid gap-4">
          {people.map((person) => (
            <Link
              key={person._id.toString()}
              to={`/people/${person._id.toString()}`}
            >
              <Card className="p-4 hover:border-primary transition-colors">
                <div className="flex items-start gap-4">
                  <IconDisplay icon={person.icon} fallback="👤" />
                  <div className="flex-1 space-y-1">
                    <h3 className="font-semibold">{person.name}</h3>
                    {person.details && (
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {person.details}
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

export default PeoplePage;
