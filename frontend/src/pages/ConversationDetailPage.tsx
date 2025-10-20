import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { callResource } from '@/lib/api';
import type { Conversation, TimeRange, Participant } from '@/types/conversations';
import type { Person } from '@/types/people';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Trash2, PlusIcon, X, Copy, Share2, UserPlus } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { SmartDateInput } from '@/components/forms/SmartDateInput';
import { EmojiPickerButton } from '@/components/ui/emoji-picker';
import { IconDisplay } from '@/components/IconDisplay';
import { MultiSelect, type MultiSelectOption } from '@/components/ui/multi-select';
import { ObjectId } from 'bson';
import { formatTime } from '@/lib/formatTime';

const ConversationDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);
  const [rangeTranscripts, setRangeTranscripts] = useState<Record<number, { loading: boolean; error: string | null; segments: { time: Date; endTime: Date; text: string }[]; visible: boolean }>>({});
  const [summaryDraft, setSummaryDraft] = useState<string>('');
  const summaryInitializedRef = useRef(false);
  const summaryDebounceRef = useRef<number | null>(null);

  useEffect(() => {
    const fetchConversation = async () => {
      try {
        const result = await callResource("tech.mycelia.mongo", {
          action: "findOne",
          collection: "conversations",
          query: { _id: { $oid: id } },
        });
        if (result) {
          setConversation(result);
        } else {
          setError("Conversation not found");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch conversation');
      } finally {
        setLoading(false);
      }
    };

    if (id) {
      fetchConversation();
    }
  }, [id]);

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

  // Initialize summary draft once when conversation loads
  useEffect(() => {
    if (conversation && !summaryInitializedRef.current) {
      setSummaryDraft(conversation.summary || '');
      summaryInitializedRef.current = true;
    }
  }, [conversation]);

  useEffect(() => {
    return () => {
      if (summaryDebounceRef.current) {
        clearTimeout(summaryDebounceRef.current);
      }
    };
  }, []);

  const autoSave = async (updates: Partial<Conversation>) => {
    if (!conversation) return;

    setSaving(true);
    try {
      const updateDoc: any = {
        $set: {
          ...updates,
          updatedAt: new Date(),
        },
      };

      await callResource("tech.mycelia.mongo", {
        action: "updateOne",
        collection: "conversations",
        query: { _id: conversation._id },
        update: updateDoc,
      });

      setConversation({ ...conversation, ...updates });
    } catch (err) {
      console.error('Auto-save failed:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleSummaryChange: React.ChangeEventHandler<HTMLTextAreaElement> = (e) => {
    const next = e.target.value;
    setSummaryDraft(next);
    if (summaryDebounceRef.current) {
      clearTimeout(summaryDebounceRef.current);
    }
    summaryDebounceRef.current = window.setTimeout(() => {
      autoSave({ summary: next || undefined });
    }, 500);
  };

  const handleDelete = async () => {
    if (!conversation) return;
    const confirmed = globalThis.confirm ? globalThis.confirm("Delete this conversation?") : true;
    if (!confirmed) return;

    try {
      await callResource("tech.mycelia.mongo", {
        action: "deleteOne",
        collection: "conversations",
        query: { _id: conversation._id },
      });
      navigate('/conversations');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete conversation');
    }
  };

  const addTimeRange = () => {
    if (!conversation) return;
    const newRange: TimeRange = {
      start: new Date(),
      end: new Date(Date.now() + 3600000),
    };
    autoSave({ timeRanges: [...conversation.timeRanges, newRange] });
  };

  const updateTimeRange = (index: number, field: 'start' | 'end', value: Date) => {
    if (!conversation) return;
    const newRanges = [...conversation.timeRanges];
    newRanges[index] = { ...newRanges[index], [field]: value };
    autoSave({ timeRanges: newRanges });
  };

  const removeTimeRange = (index: number) => {
    if (!conversation) return;
    const newRanges = conversation.timeRanges.filter((_, i) => i !== index);
    autoSave({ timeRanges: newRanges });
  };

  async function fetchSegmentsRange(rangeStart: Date, rangeEnd: Date) {
    const docs: Array<{ start: Date; end: Date; segments: Array<{ start: number; end: number; text: string }> }> = await callResource("tech.mycelia.mongo", {
      action: "find",
      collection: "transcriptions",
      query: {
        start: { $lt: rangeEnd },
        end: { $gt: rangeStart },
      },
      options: { sort: { start: 1 }, limit: 10000 },
    });

    const rendered: { time: Date; endTime: Date; text: string }[] = [];
    for (const doc of docs) {
      for (const s of doc.segments || []) {
        const absStart = new Date(new Date(doc.start).getTime() + s.start * 1000);
        const absEnd = new Date(new Date(doc.start).getTime() + s.end * 1000);
        if (absEnd > rangeStart && absStart < rangeEnd) {
          rendered.push({ time: absStart, endTime: absEnd, text: (s.text || '').replace(/\n/g, ' ') });
        }
      }
    }
    rendered.sort((a, b) => a.time.getTime() - b.time.getTime());
    return rendered;
  }

  const toggleShowTranscript = async (index: number, start: Date, end?: Date) => {
    const rangeEnd = end ?? new Date(start.getTime() + 60 * 60 * 1000);
    setRangeTranscripts((prev) => ({
      ...prev,
      [index]: { loading: true, error: null, segments: prev[index]?.segments || [], visible: !prev[index]?.visible }
    }));

    // If becoming visible and no segments loaded yet, fetch them
    const current = rangeTranscripts[index];
    const becomingVisible = !(current && current.visible);
    if (becomingVisible && (!current || current.segments.length === 0)) {
      try {
        const segs = await fetchSegmentsRange(start, rangeEnd);
        setRangeTranscripts((prev) => ({
          ...prev,
          [index]: { loading: false, error: null, segments: segs, visible: true }
        }));
      } catch (err) {
        setRangeTranscripts((prev) => ({
          ...prev,
          [index]: { loading: false, error: err instanceof Error ? err.message : 'Failed to load transcript', segments: [], visible: false }
        }));
      }
    } else {
      // Just toggle visibility without refetch
      setRangeTranscripts((prev) => ({
        ...prev,
        [index]: { ...(prev[index] || { loading: false, error: null, segments: [] }), loading: false, visible: !current?.visible }
      }));
    }
  };

  const toggleShare = async () => {
    if (!conversation) return;

    if (!conversation.isShared) {
      const shareLink = `${window.location.origin}/shared/conversations/${conversation._id.toString()}`;
      autoSave({ isShared: true, shareLink });
    } else {
      autoSave({ isShared: false, shareLink: undefined });
    }
  };

  const copyShareLink = () => {
    if (conversation?.shareLink) {
      navigator.clipboard.writeText(conversation.shareLink);
    }
  };

  const participantOptions: MultiSelectOption[] = people.map(person => ({
    label: person.name,
    value: person._id.toString(),
    icon: () => <IconDisplay icon={person.icon} className="text-base" fallback="👤" />,
  }));

  const handleParticipantsChange = (participantIds: string[]) => {
    if (!conversation) return;

    // Convert string IDs back to ObjectIds for participants that exist
    const newParticipants: Participant[] = participantIds.map(id => {
      const person = people.find(p => p._id.toString() === id);
      if (!person) {
        // This shouldn't happen, but handle gracefully
        const existingParticipant = conversation.participants.find(p => p.id.toString() === id);
        return existingParticipant || { id: new ObjectId(id), name: 'Unknown' };
      }
      return { id: person._id, name: person.name };
    });

    autoSave({ participants: newParticipants });
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
      if (conversation) {
        const newParticipant: Participant = {
          id: newPerson._id,
          name: newPerson.name,
        };
        const updatedParticipants = [...conversation.participants, newParticipant];
        autoSave({ participants: updatedParticipants });
      }
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
          <p className="text-muted-foreground">Loading conversation...</p>
        </div>
      </div>
    );
  }

  if (error || !conversation) {
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
          <p className="text-red-500">Error: {error || 'Conversation not found'}</p>
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
            Back to Conversations
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
        <div className="space-y-4">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0">
              <Label className="text-sm font-medium">Icon</Label>
              <div className="mt-1">
                <EmojiPickerButton
                  value={conversation.icon}
                  onChange={(icon) => autoSave({ icon })}
                />
              </div>
            </div>

            <div className="flex-1">
              <Label htmlFor="title" className="text-sm font-medium">Title</Label>
              <Input
                id="title"
                value={conversation.title}
                onChange={(e) => autoSave({ title: e.target.value })}
                placeholder="Conversation title"
                className="mt-1"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="summary">Summary</Label>
            <textarea
              id="summary"
              value={summaryDraft}
              onChange={handleSummaryChange}
              onBlur={() => autoSave({ summary: summaryDraft || undefined })}
              placeholder="Optional summary of the conversation"
              className="flex min-h-[100px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
        </div>

        <Separator />

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>Time Ranges</Label>
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

          {conversation.timeRanges.length === 0 ? (
            <p className="text-sm text-muted-foreground">No time ranges yet. Add one above.</p>
          ) : (
            <div className="space-y-4">
              {conversation.timeRanges.map((range, index) => (
                <div key={index} className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Range {index + 1}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeTimeRange(index)}
                      title="Remove range"
                    >
                      <X className="w-4 h-4" />
                    </Button>
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

                  <div className="pt-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => toggleShowTranscript(index, range.start, range.end)}
                      disabled={rangeTranscripts[index]?.loading}
                    >
                      {rangeTranscripts[index]?.visible ? 'Hide transcript' : 'Show transcript'}
                    </Button>
                  </div>

                  {rangeTranscripts[index]?.visible && (
                    <div className="mt-3 border rounded-md">
                      {rangeTranscripts[index]?.loading ? (
                        <div className="p-4 text-sm text-muted-foreground">Loading transcript…</div>
                      ) : rangeTranscripts[index]?.error ? (
                        <div className="p-4 text-sm text-red-500">Error: {rangeTranscripts[index]?.error}</div>
                      ) : rangeTranscripts[index]?.segments.length === 0 ? (
                        <div className="p-4 text-sm text-muted-foreground">No utterances in this range</div>
                      ) : (
                        <div className="divide-y">
                          {rangeTranscripts[index]?.segments.map((seg, i) => (
                            <div key={i} className="p-3">
                              <div className="text-xs text-muted-foreground mb-1">{formatTime(seg.time)}</div>
                              <div className="text-sm whitespace-pre-wrap leading-relaxed">{seg.text}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <Separator />

        <div className="space-y-4">
          <Label>Participants</Label>

          <MultiSelect
            options={participantOptions}
            defaultValue={conversation.participants ? conversation.participants.map(p => p.id.toString()) : []}
            onValueChange={handleParticipantsChange}
            placeholder="Select participants"
            maxCount={5}
            searchable={true}
            emptyIndicator={(searchValue) => <CreatePersonEmptyIndicator searchValue={searchValue} />}
          />


        </div>

        <Separator />

        <div className="space-y-4">
          <Label>Sharing</Label>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant={conversation.isShared ? "default" : "outline"}
              onClick={toggleShare}
            >
              <Share2 className="w-4 h-4 mr-2" />
              {conversation.isShared ? "Shared" : "Share"}
            </Button>
            {conversation.isShared && conversation.shareLink && (
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={copyShareLink}
                title="Copy share link"
              >
                <Copy className="w-4 h-4" />
              </Button>
            )}
          </div>
          {conversation.isShared && conversation.shareLink && (
            <p className="text-xs text-muted-foreground break-all">
              Share link: {conversation.shareLink}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default ConversationDetailPage;
