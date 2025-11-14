import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { callResource } from "@/lib/api";
import type { Object } from "@/types/objects";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ArrowLeftRight, ArrowRight, Package, Plus } from "lucide-react";
import { Card } from "@/components/ui/card";

function escapeRegex(source: string) {
  return source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderHighlightedText(text: string, query: string) {
  const words = query
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);
  if (words.length === 0) return text;
  const pattern = `(${words.map(escapeRegex).join("|")})`;
  const splitRe = new RegExp(pattern, "gi");
  const checkRe = new RegExp(pattern, "i");
  const parts = text.split(splitRe);
  return (
    <>
      {parts.map((part, idx) =>
        checkRe.test(part)
          ? (
            <mark key={idx} className="bg-yellow-200">
              {part}
            </mark>
          )
          : <span key={idx}>{part}</span>
      )}
    </>
  );
}

function renderIcon(icon: any) {
  if (!icon) return "";
  if (typeof icon === "string") return icon;
  if (icon.text) return icon.text;
  if (icon.base64) return "📷";
  return "";
}

interface ObjectCardProps {
  object: Object & { subjectObject?: Object; objectObject?: Object };
  searchQuery: string;
}

function ObjectCard({ object, searchQuery }: ObjectCardProps) {
  const isRelationship = object.isRelationship;
  const hasRelationshipData = object.relationship && object.subjectObject &&
    object.objectObject;

  return (
    <Link to={`/objects/${object._id.toString()}`}>
      <Card className="p-4 hover:border-primary transition-colors">
        {isRelationship && hasRelationshipData
          ? (
            <div className="space-y-2">
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-lg flex-shrink-0">
                  {renderIcon(object.icon)}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">
                    {searchQuery.trim() && object.name
                      ? renderHighlightedText(object.name, searchQuery.trim())
                      : object.name}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground pl-7">
                <div className="flex items-center gap-1">
                  <span>{renderIcon(object.subjectObject?.icon)}</span>
                  <span className="truncate">{object.subjectObject?.name}</span>
                </div>
                {object.relationship?.symmetrical
                  ? <ArrowLeftRight className="w-4 h-4 flex-shrink-0" />
                  : <ArrowRight className="w-4 h-4 flex-shrink-0" />}
                <div className="flex items-center gap-1">
                  <span>{renderIcon(object.objectObject?.icon)}</span>
                  <span className="truncate">{object.objectObject?.name}</span>
                </div>
              </div>
              {object.details && (
                <div className="text-sm text-muted-foreground line-clamp-2 pl-7">
                  {object.details}
                </div>
              )}
            </div>
          )
          : (
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-lg flex-shrink-0">
                {renderIcon(object.icon)}
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">
                  {searchQuery.trim() && object.name
                    ? renderHighlightedText(object.name, searchQuery.trim())
                    : object.name}
                </div>
                {object.details && (
                  <div className="text-sm text-muted-foreground line-clamp-2 mt-1">
                    {object.details}
                  </div>
                )}
              </div>
            </div>
          )}
      </Card>
    </Link>
  );
}

const ObjectsPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [objects, setObjects] = useState<
    (Object & { subjectObject?: Object; objectObject?: Object })[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const q = searchParams.get("q") || "";
  const isEvent = searchParams.get("isEvent") === "true";
  const isPerson = searchParams.get("isPerson") === "true";
  const isRelationship = searchParams.get("isRelationship") === "true";
  const isPromise = searchParams.get("isPromise") === "true";

  const [localQ, setLocalQ] = useState(q);

  function updateFilters(
    newQ: string,
    newIsEvent: boolean,
    newIsPerson: boolean,
    newIsRelationship: boolean,
    newIsPromise: boolean,
  ) {
    const newSearchParams = new URLSearchParams();

    if (newQ.trim()) {
      newSearchParams.set("q", newQ.trim());
    }

    if (newIsEvent) {
      newSearchParams.set("isEvent", "true");
    }

    if (newIsPerson) {
      newSearchParams.set("isPerson", "true");
    }

    if (newIsRelationship) {
      newSearchParams.set("isRelationship", "true");
    }

    if (newIsPromise) {
      newSearchParams.set("isPromise", "true");
    }

    setSearchParams(newSearchParams);
  }

  useEffect(() => {
    const buildQuery = () => {
      const query: Record<string, unknown> = {};

      if (isEvent) {
        query.isEvent = true;
      }

      if (isPerson) {
        query.isPerson = true;
      }

      if (isRelationship) {
        query.isRelationship = true;
      }

      if (isPromise) {
        query.isPromise = true;
      }

      const searchQuery = q.trim();
      if (searchQuery) {
        query.$text = { $search: searchQuery };
      }

      return query;
    };

    const fetchObjects = async () => {
      setLoading(true);
      setError(null);
      try {
        const query = buildQuery();
        const pipeline: unknown[] = [
          { $match: query },
          {
            $lookup: {
              from: "objects",
              localField: "relationship.subject",
              foreignField: "_id",
              as: "subjectObject",
            },
          },
          {
            $lookup: {
              from: "objects",
              localField: "relationship.object",
              foreignField: "_id",
              as: "objectObject",
            },
          },
          {
            $unwind: {
              path: "$subjectObject",
              preserveNullAndEmptyArrays: true,
            },
          },
          {
            $unwind: {
              path: "$objectObject",
              preserveNullAndEmptyArrays: true,
            },
          },
          // Sort by text score if searching, otherwise by _id
          ...(q.trim()
            ? [{ $sort: { score: { $meta: "textScore" }, _id: 1 } }]
            : [{ $sort: { _id: 1 } }]),
          { $limit: 100 },
        ];

        const result = await callResource("tech.mycelia.mongo", {
          action: "aggregate",
          collection: "objects",
          pipeline,
        });
        setObjects(result);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to fetch objects",
        );
      } finally {
        setLoading(false);
      }
    };

    fetchObjects();
  }, [q, isEvent, isPerson, isRelationship, isPromise]);

  useEffect(() => {
    setLocalQ(q);
  }, [q]);

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
        <Button asChild>
          <Link to="/objects/create">
            <Plus className="w-4 h-4 mr-2" />
            Create Object
          </Link>
        </Button>
      </div>

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          updateFilters(localQ, isEvent, isPerson, isRelationship, isPromise);
        }}
      >
        <div className="flex gap-2">
          <Input
            value={localQ}
            onChange={(e) => setLocalQ(e.target.value)}
            placeholder="Search by name, aliases, or details..."
            className="flex-1"
          />
          <Button type="submit" disabled={loading}>
            Search
          </Button>
        </div>

        <div className="flex flex-wrap gap-6">
          <div className="flex items-center space-x-2">
            <Checkbox
              id="isEvent"
              checked={isEvent}
              onCheckedChange={(checked) =>
                updateFilters(
                  q,
                  checked === true,
                  isPerson,
                  isRelationship,
                  isPromise,
                )}
            />
            <Label
              htmlFor="isEvent"
              className="text-sm font-medium cursor-pointer"
            >
              Is Event
            </Label>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="isPerson"
              checked={isPerson}
              onCheckedChange={(checked) =>
                updateFilters(
                  q,
                  isEvent,
                  checked === true,
                  isRelationship,
                  isPromise,
                )}
            />
            <Label
              htmlFor="isPerson"
              className="text-sm font-medium cursor-pointer"
            >
              Is Person
            </Label>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="isRelationship"
              checked={isRelationship}
              onCheckedChange={(checked) =>
                updateFilters(
                  q,
                  isEvent,
                  isPerson,
                  checked === true,
                  isPromise,
                )}
            />
            <Label
              htmlFor="isRelationship"
              className="text-sm font-medium cursor-pointer"
            >
              Is Relationship
            </Label>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="isPromise"
              checked={isPromise}
              onCheckedChange={(checked) =>
                updateFilters(
                  q,
                  isEvent,
                  isPerson,
                  isRelationship,
                  checked === true,
                )}
            />
            <Label
              htmlFor="isPromise"
              className="text-sm font-medium cursor-pointer"
            >
              Is Promise
            </Label>
          </div>
        </div>
      </form>

      {objects.length === 0
        ? (
          <Card className="p-8 text-center">
            <Package className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">
              No objects
              found{q.trim() || isEvent || isPerson || isRelationship ||
                  isPromise
                ? " matching your filters"
                : ""}. Objects are created through the application.
            </p>
          </Card>
        )
        : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-stretch gap-4">
              {objects.map((object) => (
                <div
                  key={object._id.toString()}
                  className="flex-1 min-w-0"
                  style={{ minWidth: "300px", maxWidth: "500px" }}
                >
                  <ObjectCard object={object} searchQuery={q} />
                </div>
              ))}
            </div>
            {objects.length === 100 && (
              <div className="text-sm text-muted-foreground text-center">
                Showing first 100 results. Use filters to narrow down your
                search.
              </div>
            )}
          </div>
        )}
    </div>
  );
};

export default ObjectsPage;
