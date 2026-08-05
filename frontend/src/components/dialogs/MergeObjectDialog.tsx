import { useEffect, useMemo, useState } from "react";
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
import { ObjectSelectionDropdown } from "@/components/ObjectSelectionDropdown";
import { useMergeObjects, useObject } from "@/hooks/useObjectQueries";
import type { Object as ObjectModel } from "@/types/objects";
import { Combine, Loader2 } from "lucide-react";

interface MergeObjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentObject: ObjectModel;
  /** Pre-select the other object (e.g. from a duplicate suggestion) */
  initialOtherId?: string;
}

function objectLabel(object: ObjectModel | undefined): string {
  if (!object) return "";
  const icon = object.icon && "text" in object.icon ? object.icon.text : "";
  return icon ? `${icon} ${object.name ?? "Unnamed"}` : object.name ?? "Unnamed";
}

export function MergeObjectDialog({
  open,
  onOpenChange,
  currentObject,
  initialOtherId,
}: MergeObjectDialogProps) {
  const navigate = useNavigate();
  const mergeMutation = useMergeObjects();

  const currentId = currentObject._id.toString();
  const [otherId, setOtherId] = useState(initialOtherId ?? "");
  const [keepCurrent, setKeepCurrent] = useState(true);
  const [canonicalName, setCanonicalName] = useState(currentObject.name ?? "");

  const { data: otherObject } = useObject(otherId || undefined);

  useEffect(() => {
    if (open) {
      setOtherId(initialOtherId ?? "");
      setKeepCurrent(true);
      setCanonicalName(currentObject.name ?? "");
    }
  }, [open, initialOtherId, currentObject.name]);

  // Default the canonical name to the survivor's name whenever survivor changes
  useEffect(() => {
    const winner = keepCurrent ? currentObject : otherObject;
    if (winner?.name) setCanonicalName(winner.name);
  }, [keepCurrent, otherObject, currentObject]);

  const winner = keepCurrent ? currentObject : otherObject;
  const loser = keepCurrent ? otherObject : currentObject;

  const aliasPreview = useMemo(() => {
    if (!winner || !loser) return [];
    const seen = new Set<string>();
    const result: string[] = [];
    const canonical = (canonicalName || winner.name || "").toLowerCase();
    for (
      const alias of [
        ...(winner.aliases ?? []),
        ...(winner.name && winner.name.toLowerCase() !== canonical
          ? [winner.name]
          : []),
        ...(loser.name ? [loser.name] : []),
        ...(loser.aliases ?? []),
      ]
    ) {
      const key = alias.toLowerCase();
      if (!alias || key === canonical || seen.has(key)) continue;
      seen.add(key);
      result.push(alias);
    }
    return result;
  }, [winner, loser, canonicalName]);

  const canMerge = Boolean(
    otherId && otherObject && canonicalName.trim() &&
      !mergeMutation.isPending,
  );

  const handleMerge = () => {
    if (!winner || !loser) return;
    const winnerId = keepCurrent ? currentId : otherId;
    const loserId = keepCurrent ? otherId : currentId;

    mergeMutation.mutate(
      {
        winnerId,
        loserIds: [loserId],
        canonicalName: canonicalName.trim(),
        version: keepCurrent ? currentObject.version : otherObject?.version,
      },
      {
        onSuccess: () => {
          toast.success(
            `Merged "${loser.name ?? "Unnamed"}" into "${canonicalName.trim()}"`,
          );
          onOpenChange(false);
          if (!keepCurrent) {
            navigate(`/objects/${winnerId}`);
          }
        },
        onError: (error: any) => {
          if (error?.code === 409) {
            toast.error("Object changed in the meantime — reload and retry");
          } else {
            toast.error(`Merge failed: ${error?.message ?? String(error)}`);
          }
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Combine className="w-5 h-5" />
            Merge objects
          </DialogTitle>
          <DialogDescription>
            Combine two objects that represent the same real-world thing. Names
            and aliases are united, and all relationships are re-pointed to the
            surviving object.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Merge with</Label>
            <ObjectSelectionDropdown
              value={otherId}
              onChange={setOtherId}
              placeholder="Search for the duplicate object..."
            />
          </div>

          {otherObject && (
            <>
              <div className="space-y-2">
                <Label>Keep</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={keepCurrent ? "default" : "outline"}
                    size="sm"
                    onClick={() => setKeepCurrent(true)}
                    className="flex-1 justify-start"
                  >
                    {objectLabel(currentObject)}
                  </Button>
                  <Button
                    type="button"
                    variant={!keepCurrent ? "default" : "outline"}
                    size="sm"
                    onClick={() => setKeepCurrent(false)}
                    className="flex-1 justify-start"
                  >
                    {objectLabel(otherObject)}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="canonical-name">Final name</Label>
                <Input
                  id="canonical-name"
                  value={canonicalName}
                  onChange={(e) => setCanonicalName(e.target.value)}
                />
              </div>

              {aliasPreview.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Aliases after merge: {aliasPreview.join(", ")}
                </p>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!canMerge}
            onClick={handleMerge}
          >
            {mergeMutation.isPending && (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            )}
            Merge — deletes "{loser?.name ?? "…"}"
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
