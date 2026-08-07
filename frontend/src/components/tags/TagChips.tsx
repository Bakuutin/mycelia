import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Tag as TagIcon, X } from "lucide-react";
import type { Object as ObjectModel } from "@/types/objects";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { getRelationships } from "@/hooks/useObjectQueries";
import {
  useAddTag,
  useAllTags,
  useCreateTag,
  useRemoveTag,
} from "@/hooks/useTagQueries";

const renderTagIcon = (icon: unknown): string => {
  if (!icon) return "";
  if (typeof icon === "string") return icon;
  const text = (icon as { text?: string }).text;
  return text ?? "";
};

/**
 * Tag chips for one object: shows its "tagged" edges as clickable chips
 * (chip → /objects filtered by that tag), removes a tag on ✕, and adds
 * tags — or creates a new one on the fly — from a searchable popover.
 */
export function TagChips({ object }: { object: ObjectModel }) {
  const objectId = object._id.toString();
  const { data: relationships = [] } = getRelationships(object._id);
  const { data: allTags = [] } = useAllTags();
  const addTagMutation = useAddTag();
  const removeTagMutation = useRemoveTag();
  const createTagMutation = useCreateTag();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");

  // This object's tags: "tagged" edges where the object is the subject.
  const appliedTags = useMemo(
    () =>
      relationships
        .filter(({ relationship }) =>
          relationship.name === "tagged" &&
          relationship.relationship?.subject?.toString() === objectId
        )
        .map(({ relationship, other }) => ({
          edgeId: relationship._id.toString(),
          tag: other,
        })),
    [relationships, objectId],
  );

  const appliedTagIds = useMemo(
    () => new Set(appliedTags.map(({ tag }) => tag._id.toString())),
    [appliedTags],
  );

  const availableTags = useMemo(
    () => allTags.filter((tag) => !appliedTagIds.has(tag._id.toString())),
    [allTags, appliedTagIds],
  );

  const trimmedQuery = query.trim();
  const hasExactMatch = allTags.some(
    (tag) => (tag.name ?? "").toLowerCase() === trimmedQuery.toLowerCase(),
  );

  const handleAdd = async (tagId: string) => {
    setPickerOpen(false);
    setQuery("");
    await addTagMutation.mutateAsync({ objectId, tagId });
  };

  const handleCreateAndAdd = async () => {
    if (!trimmedQuery) return;
    setPickerOpen(false);
    setQuery("");
    const tagId = await createTagMutation.mutateAsync({ name: trimmedQuery });
    await addTagMutation.mutateAsync({ objectId, tagId });
  };

  return (
    <div className="flex items-center gap-1 flex-wrap">
      <TagIcon className="w-3 h-3 text-muted-foreground" />
      {appliedTags.map(({ edgeId, tag }) => (
        <Badge
          key={edgeId}
          variant="secondary"
          className="text-xs py-0 pr-0.5 group/tag"
        >
          <Link
            to={`/objects?tag=${tag._id.toString()}`}
            className="hover:underline"
            title={`Show objects tagged "${tag.name}"`}
          >
            {renderTagIcon(tag.icon)} {tag.name}
          </Link>
          <button
            type="button"
            className="ml-0.5 rounded-sm p-0.5 opacity-0 group-hover/tag:opacity-60 hover:!opacity-100 transition-opacity"
            title={`Remove tag "${tag.name}"`}
            disabled={removeTagMutation.isPending}
            onClick={() => removeTagMutation.mutate({ edgeId, objectId })}
          >
            <X className="w-2.5 h-2.5" />
          </button>
        </Badge>
      ))}
      <Popover
        open={pickerOpen}
        onOpenChange={(open) => {
          setPickerOpen(open);
          if (!open) setQuery("");
        }}
      >
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0 text-muted-foreground"
            title="Add tag"
          >
            <Plus className="w-3 h-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-0" align="end">
          <Command>
            <CommandInput
              placeholder="Search tags..."
              value={query}
              onValueChange={setQuery}
            />
            <CommandList>
              <CommandEmpty>No tags found.</CommandEmpty>
              <CommandGroup>
                {availableTags.map((tag) => (
                  <CommandItem
                    key={tag._id.toString()}
                    value={tag.name ?? ""}
                    onSelect={() => handleAdd(tag._id.toString())}
                  >
                    <span className="mr-1">{renderTagIcon(tag.icon)}</span>
                    {tag.name}
                  </CommandItem>
                ))}
                {trimmedQuery && !hasExactMatch && (
                  <CommandItem
                    value={`__create__${trimmedQuery}`}
                    onSelect={handleCreateAndAdd}
                    disabled={createTagMutation.isPending}
                  >
                    <Plus className="w-3 h-3 mr-1" />
                    Create “{trimmedQuery}”
                  </CommandItem>
                )}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
