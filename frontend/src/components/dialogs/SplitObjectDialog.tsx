import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getRelationships, useSplitObject } from "@/hooks/useObjectQueries";
import type { Object as ObjectModel } from "@/types/objects";
import { Loader2, Scissors } from "lucide-react";

interface SplitObjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceObject: ObjectModel;
}

export function SplitObjectDialog({
  open,
  onOpenChange,
  sourceObject,
}: SplitObjectDialogProps) {
  const navigate = useNavigate();
  const splitMutation = useSplitObject();
  const sourceId = sourceObject._id.toString();

  const { data: relationships = [] } = getRelationships(open ? sourceId : undefined);

  const [newName, setNewName] = useState("");
  const [selectedEdges, setSelectedEdges] = useState<Set<string>>(new Set());
  const [selectedAliases, setSelectedAliases] = useState<Set<string>>(
    new Set(),
  );

  useEffect(() => {
    if (open) {
      setNewName("");
      setSelectedEdges(new Set());
      setSelectedAliases(new Set());
    }
  }, [open]);

  const toggleEdge = (id: string) => {
    setSelectedEdges((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAlias = (alias: string) => {
    setSelectedAliases((prev) => {
      const next = new Set(prev);
      if (next.has(alias)) next.delete(alias);
      else next.add(alias);
      return next;
    });
  };

  const handleSplit = () => {
    splitMutation.mutate(
      {
        sourceId,
        newObject: { name: newName.trim() },
        edgeIdsToMove: [...selectedEdges],
        aliasesToMove: [...selectedAliases],
        version: sourceObject.version,
      },
      {
        onSuccess: (result: any) => {
          toast.success(`Created "${newName.trim()}" from split`);
          onOpenChange(false);
          if (result?.newId) {
            navigate(`/objects/${result.newId.toString()}`);
          }
        },
        onError: (error: any) => {
          if (error?.code === 409) {
            toast.error("Object changed in the meantime — reload and retry");
          } else {
            toast.error(`Split failed: ${error?.message ?? String(error)}`);
          }
        },
      },
    );
  };

  const aliases = sourceObject.aliases ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scissors className="w-5 h-5" />
            Split object
          </DialogTitle>
          <DialogDescription>
            Create a second object out of "{sourceObject.name ?? "Unnamed"}" —
            for example when two different people were mixed under one name.
            Selected relationships and aliases move to the new object.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="split-new-name">New object name</Label>
            <Input
              id="split-new-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder='e.g. "Igor (from work)"'
            />
          </div>

          {relationships.length > 0 && (
            <div className="space-y-2">
              <Label>Relationships to move</Label>
              <ScrollArea className="max-h-56 rounded-md border p-2">
                <div className="space-y-1">
                  {relationships.map(({ relationship, other }) => {
                    const edgeId = relationship._id.toString();
                    return (
                      <label
                        key={edgeId}
                        className="flex items-center gap-2 text-sm py-1 cursor-pointer"
                      >
                        <Checkbox
                          checked={selectedEdges.has(edgeId)}
                          onCheckedChange={() => toggleEdge(edgeId)}
                        />
                        <span className="text-muted-foreground">
                          {relationship.name ?? "related to"}
                        </span>
                        <span className="font-medium truncate">
                          {other?.name ?? "Unnamed"}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>
          )}

          {aliases.length > 0 && (
            <div className="space-y-2">
              <Label>Aliases to move</Label>
              <div className="flex flex-wrap gap-3">
                {aliases.map((alias) => (
                  <label
                    key={alias}
                    className="flex items-center gap-2 text-sm cursor-pointer"
                  >
                    <Checkbox
                      checked={selectedAliases.has(alias)}
                      onCheckedChange={() => toggleAlias(alias)}
                    />
                    {alias}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!newName.trim() || splitMutation.isPending}
            onClick={handleSplit}
          >
            {splitMutation.isPending && (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            )}
            Split
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
