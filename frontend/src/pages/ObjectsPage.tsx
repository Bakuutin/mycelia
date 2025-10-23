import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { callResource } from "@/lib/api";
import type { APObject } from "@/types/activitypub";
import { getObjectName, getObjectTypes, getProperty } from "@/types/activitypub";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { TypeBadges } from "@/components/activitypub/TypeBadges";
import { Plus, Search, Package } from "lucide-react";
import { format } from "date-fns";

const ObjectsPage = () => {
  const [objects, setObjects] = useState<APObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<string>("");
  
  useEffect(() => {
    fetchObjects();
  }, [filterType]);
  
  const fetchObjects = async () => {
    try {
      setLoading(true);
      const filters: any = {};
      if (filterType) {
        filters.type = filterType;
      }
      
      const result = await callResource("tech.mycelia.mongo", {
        action: "find",
        collection: "objects",
        query: filters,
        options: { 
          sort: { "_internal.created": -1 },
          limit: 100,
        },
      });
      
      setObjects(result || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch objects");
    } finally {
      setLoading(false);
    }
  };
  
  const filteredObjects = objects.filter((obj) => {
    if (!searchQuery) return true;
    const name = getObjectName(obj).toLowerCase();
    const summary = typeof obj.summary === 'string' ? obj.summary.toLowerCase() : '';
    const types = getObjectTypes(obj).join(' ').toLowerCase();
    return name.includes(searchQuery.toLowerCase()) || 
           summary.includes(searchQuery.toLowerCase()) ||
           types.includes(searchQuery.toLowerCase());
  });
  
  const typeOptions = Array.from(
    new Set(objects.flatMap(obj => getObjectTypes(obj)))
  ).sort();
  
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
          <Button className="mt-4" onClick={fetchObjects}>
            Retry
          </Button>
        </div>
      </div>
    );
  }
  
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Objects</h1>
        <Link to="/objects/new">
          <Button>
            <Plus className="w-4 h-4 mr-2" />
            Create Object
          </Button>
        </Link>
      </div>
      
      <div className="flex gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search objects..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        
        <select
          className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
        >
          <option value="">All Types</option>
          {typeOptions.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </div>
      
      {filteredObjects.length === 0 ? (
        <Card className="p-8 text-center">
          <Package className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <p className="text-muted-foreground mb-4">
            {objects.length === 0 
              ? "No objects found. Create your first ActivityPub object."
              : "No objects match your search criteria."}
          </p>
          {objects.length === 0 && (
            <Link to="/objects/new">
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                Create Object
              </Button>
            </Link>
          )}
        </Card>
      ) : (
        <div className="grid gap-4">
          {filteredObjects.map((object) => {
            const name = getObjectName(object);
            const icon = getProperty<string>(object, "mycelia:icon");
            const summary = typeof object.summary === 'string' ? object.summary : undefined;
            const objectId = object._id?.toString();
            
            return (
              <Link
                key={objectId || object.id}
                to={`/objects/${objectId}`}
              >
                <Card className="p-4 hover:border-primary transition-colors">
                  <div className="flex items-start gap-4">
                    {icon && (
                      <span className="text-2xl" role="img" aria-label="icon">
                        {icon}
                      </span>
                    )}
                    <div className="flex-1 space-y-2">
                      <div className="flex items-start justify-between gap-4">
                        <h3 className="font-semibold text-lg">{name}</h3>
                        <TypeBadges object={object} />
                      </div>
                      
                      {summary && (
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {summary}
                        </p>
                      )}
                      
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        {object._internal?.created && (
                          <span>
                            Created {format(new Date(object._internal.created), 'PPp')}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
      
      {filteredObjects.length > 0 && (
        <div className="text-center text-sm text-muted-foreground">
          Showing {filteredObjects.length} of {objects.length} objects
        </div>
      )}
    </div>
  );
};

export default ObjectsPage;

