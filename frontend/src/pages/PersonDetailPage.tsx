import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { callResource } from '@/lib/api';
import type { Person } from '@/types/people';
import type { Conversation } from '@/types/conversations';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { ConversationCard } from '@/components/ConversationCard';
import { EmojiPickerButton } from '@/components/ui/emoji-picker';

const PersonDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [person, setPerson] = useState<Person | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const fetchPerson = async () => {
      try {
        const result = await callResource("tech.mycelia.mongo", {
          action: "findOne",
          collection: "people",
          query: { _id: { $oid: id } },
        });
        if (result) {
          setPerson(result);
        } else {
          setError("Person not found");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch person');
      } finally {
        setLoading(false);
      }
    };

    if (id) {
      fetchPerson();
    }
  }, [id]);

  useEffect(() => {
    const fetchConversations = async () => {
      if (!id) return;

      try {
        const result = await callResource("tech.mycelia.mongo", {
          action: "find",
          collection: "conversations",
          query: { "participants.id": { $oid: id } },
          options: { sort: { updatedAt: -1 } },
        });
        setConversations(result);
      } catch (err) {
        console.error('Failed to fetch conversations:', err);
      }
    };

    if (id) {
      fetchConversations();
    }
  }, [id]);

  const autoSave = async (updates: Partial<Person>) => {
    if (!person) return;

    setSaving(true);
    try {
      await callResource("tech.mycelia.mongo", {
        action: "updateOne",
        collection: "people",
        query: { _id: person._id },
        update: {
          $set: {
            ...updates,
            updatedAt: new Date(),
          },
        },
      });

      setPerson({ ...person, ...updates });
    } catch (err) {
      console.error('Auto-save failed:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!person) return;
    const confirmed = globalThis.confirm ? globalThis.confirm("Delete this person?") : true;
    if (!confirmed) return;

    try {
      await callResource("tech.mycelia.mongo", {
        action: "deleteOne",
        collection: "people",
        query: { _id: person._id },
      });
      navigate('/conversations');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete person');
    }
  };

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <Link to="/conversations">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
          </Link>
        </div>
        <div className="border rounded-lg p-8 text-center">
          <p className="text-muted-foreground">Loading person...</p>
        </div>
      </div>
    );
  }

  if (error || !person) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <Link to="/conversations">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
          </Link>
        </div>
        <div className="border rounded-lg p-8 text-center">
          <p className="text-red-500">Error: {error || 'Person not found'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <Link to="/conversations">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
        </Link>
        <div className="flex items-center gap-2">
          {saving && <span className="text-xs text-muted-foreground">Saving...</span>}
          <Button variant="destructive" size="sm" onClick={handleDelete}>
            <Trash2 className="w-4 h-4 mr-2" />
            Delete
          </Button>
        </div>
      </div>

      <div className="border rounded-lg p-6 space-y-6">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0">
            <Label className="text-sm font-medium">Icon</Label>
            <div className="mt-1">
              <EmojiPickerButton
                value={person.icon}
                onChange={(icon) => autoSave({ icon })}
              />
            </div>
          </div>

          <div className="flex-1">
            <Label htmlFor="name" className="text-sm font-medium">Name</Label>
            <Input
              id="name"
              value={person.name}
              onChange={(e) => autoSave({ name: e.target.value })}
              placeholder="Person name"
              className="mt-1"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="details">Details</Label>
          <textarea
            id="details"
            value={person.details || ""}
            onChange={(e) => autoSave({ details: e.target.value || undefined })}
            placeholder="Optional details about this person"
            className="flex min-h-[100px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
      </div>

      {conversations.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Conversations</h2>
          <div className="grid gap-4">
            {conversations.map((conversation) => (
              <ConversationCard
                key={conversation._id.toString()}
                conversation={conversation}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default PersonDetailPage;
