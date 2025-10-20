import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { callResource } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, PlusIcon, X, UserPlus } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { SmartDateInput } from '@/components/forms/SmartDateInput';
import { IconDisplay } from '@/components/IconDisplay';
import { MultiSelect, type MultiSelectOption } from '@/components/ui/multi-select';
import { ObjectId } from 'bson';
import type { TimeRange, Participant } from '@/types/conversations';
import type { Person } from '@/types/people';

const CreateConversationPage = () => {
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);
  const [formData, setFormData] = useState({
    title: '',
    summary: '',
    timeRanges: [{
      start: new Date(),
      end: new Date(Date.now() + 3600000),
    }] as TimeRange[],
    participants: [] as Participant[],
  });

  useEffect(() => {
    const fetchPeople = async () => {
      try {
        const result = await callResource("tech.mycelia.mongo", {
          action: "find",
          collection: "people",
          query: {},
          options: { sort: { name: 1 } },
        });
        setPeople(result);
      } catch (err) {
        console.error('Failed to fetch people:', err);
      }
    };

    fetchPeople();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      const now = new Date();
      const doc = {
        action: "insertOne",
        collection: "conversations",
        doc: {
          title: formData.title || undefined,
          summary: formData.summary || undefined,
          timeRanges: formData.timeRanges,
          participants: formData.participants,
          isShared: false,
          createdAt: now,
          updatedAt: now,
        },
      } as const;

      await callResource("tech.mycelia.mongo", doc);
      navigate('/conversations');
    } catch (err) {
      console.error('Failed to create conversation:', err);
    } finally {
      setSaving(false);
    }
  };

  const addTimeRange = () => {
    setFormData({
      ...formData,
      timeRanges: [
        ...formData.timeRanges,
        {
          start: new Date(),
          end: new Date(Date.now() + 3600000),
        },
      ],
    });
  };

  const updateTimeRange = (index: number, field: 'start' | 'end', value: Date) => {
    const newRanges = [...formData.timeRanges];
    newRanges[index] = { ...newRanges[index], [field]: value };
    setFormData({ ...formData, timeRanges: newRanges });
  };

  const removeTimeRange = (index: number) => {
    if (formData.timeRanges.length === 1) return;
    const newRanges = formData.timeRanges.filter((_, i) => i !== index);
    setFormData({ ...formData, timeRanges: newRanges });
  };


  const participantOptions: MultiSelectOption[] = people.map(person => ({
    label: person.name,
    value: person._id.toString(),
    icon: () => <IconDisplay icon={person.icon} className="text-base" fallback="👤" />,
  }));


  const handleParticipantsChange = (participantIds: string[]) => {
    // Convert string IDs back to ObjectIds for participants that exist
    const newParticipants: Participant[] = participantIds.map(id => {
      const person = people.find(p => p._id.toString() === id);
      if (!person) {
        // This shouldn't happen, but handle gracefully
        return { id: new ObjectId(id), name: 'Unknown' };
      }
      return { id: person._id, name: person.name };
    });

    setFormData({ ...formData, participants: newParticipants });
  };

  const handleCreatePersonFromSearch = async (personName: string) => {
    if (!personName.trim()) return;

    try {
      const now = new Date();
      const result = await callResource("tech.mycelia.mongo", {
        action: "insertOne",
        collection: "people",
        doc: {
          name: personName.trim(),
          createdAt: now,
          updatedAt: now,
        },
      });

      const newPerson = {
        _id: result.insertedId,
        name: personName.trim(),
        createdAt: now,
        updatedAt: now,
      };

      setPeople([...people, newPerson]);

      // Add the new person to participants
      const newParticipant: Participant = {
        id: newPerson._id,
        name: newPerson.name,
      };
      const updatedParticipants = [...formData.participants, newParticipant];
      setFormData({ ...formData, participants: updatedParticipants });
    } catch (err) {
      console.error('Failed to create person:', err);
    }
  };

  const CreatePersonEmptyIndicator = ({ searchValue }: { searchValue: string }) => {
    if (!searchValue?.trim()) {
      return <div className="py-6 text-center text-sm text-muted-foreground">No results found.</div>;
    }

    return (
      <div className="py-6 text-center">
        <p className="text-sm text-muted-foreground mb-3">No results found for "{searchValue}"</p>
        <button
          type="button"
          onClick={() => handleCreatePersonFromSearch(searchValue)}
          className="inline-flex items-center gap-2 px-3 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
        >
          <UserPlus className="w-4 h-4" />
          Create "{searchValue}"
        </button>
      </div>
    );
  };


  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link to="/conversations">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Conversations
          </Button>
        </Link>
      </div>

      <h1 className="text-3xl font-bold">Create Conversation</h1>

      <form onSubmit={handleSubmit} className="border rounded-lg p-6 space-y-6">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder="Conversation title"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="summary">Summary</Label>
            <textarea
              id="summary"
              value={formData.summary}
              onChange={(e) => setFormData({ ...formData, summary: e.target.value })}
              placeholder="Optional summary of the conversation"
              className="flex min-h-[100px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
        </div>

        <Separator />

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>Time Ranges *</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addTimeRange}
            >
              <PlusIcon className="w-4 h-4 mr-2" />
              Add Range
            </Button>
          </div>

          <div className="space-y-4">
            {formData.timeRanges.map((range, index) => (
              <div key={index} className="border rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Range {index + 1}</span>
                  {formData.timeRanges.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeTimeRange(index)}
                      title="Remove range"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`range-${index}-start`}>Start</Label>
                  <SmartDateInput
                    id={`range-${index}-start`}
                    value={range.start}
                    onChange={(date) => date && updateTimeRange(index, 'start', date)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`range-${index}-end`}>End</Label>
                  <SmartDateInput
                    id={`range-${index}-end`}
                    value={range.end}
                    onChange={(date) => date && updateTimeRange(index, 'end', date)}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <Separator />

        <div className="space-y-4">
          <Label>Participants</Label>

          <MultiSelect
            options={participantOptions}
            defaultValue={formData.participants.filter(p => p.id).map(p => p.id!.toString())}
            onValueChange={handleParticipantsChange}
            placeholder="Select participants"
            maxCount={5}
            searchable={true}
            emptyIndicator={(searchValue) => <CreatePersonEmptyIndicator searchValue={searchValue} />}
          />


        </div>

        <div className="flex justify-end gap-2 pt-4">
          <Link to="/conversations">
            <Button type="button" variant="outline" disabled={saving}>
              Cancel
            </Button>
          </Link>
          <Button type="submit" disabled={saving}>
            {saving ? "Creating..." : "Create Conversation"}
          </Button>
        </div>
      </form>
    </div>
  );
};

export default CreateConversationPage;
