import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { callResource } from "@/lib/api";
import { PREDICATES, type Edge, type APObject, getObjectName } from "@/types/activitypub";
import { Plus, Trash2, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import { ObjectId } from "bson";

interface EdgesEditorProps {
  objectId: ObjectId;
  className?: string;
}

export function EdgesEditor({ objectId, className }: EdgesEditorProps) {
  const [edges, setEdges] = useState<Edge[]>([]);
  const [relatedObjects, setRelatedObjects] = useState<Map<string, APObject>>(new Map());
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [availableObjects, setAvailableObjects] = useState<APObject[]>([]);
  const [objectOptions, setObjectOptions] = useState<ComboboxOption[]>([]);
  
  const [newEdge, setNewEdge] = useState({
    predicate: "",
    targetId: "",
    direction: "outgoing" as "outgoing" | "incoming",
  });
  
  useEffect(() => {
    loadEdges();
    loadAvailableObjects();
  }, [objectId]);
  
  const loadEdges = async () => {
    try {
      setLoading(true);
      const result = await callResource("tech.mycelia.mongo", {
        action: "find",
        collection: "objects",
        query: {
          type: "Edge",
          $or: [
            { subject: objectId },
            { object: objectId }
          ]
        },
      });
      
      setEdges(result || []);
      
      const relatedIds = new Set<ObjectId>();
      (result || []).forEach((edge: Edge) => {
        if (edge.subject.toString() !== objectId.toString()) relatedIds.add(edge.subject);
        if (edge.object.toString() !== objectId.toString()) relatedIds.add(edge.object);
      });
      
      if (relatedIds.size > 0) {
        const relatedObjs = await callResource("tech.mycelia.mongo", {
          action: "find",
          collection: "objects",
          query: { _id: { $in: Array.from(relatedIds) } },
        });
        
        const objectsMap = new Map<string, APObject>();
        (relatedObjs || []).forEach((obj: APObject) => {
          if (obj._id) {
            objectsMap.set(obj._id.toString(), obj);
          }
        });
        setRelatedObjects(objectsMap);
      }
    } catch (error) {
      console.error("Failed to load edges:", error);
    } finally {
      setLoading(false);
    }
  };
  
  const loadAvailableObjects = async () => {
    try {
      const result = await callResource("tech.mycelia.mongo", {
        action: "find",
        collection: "objects",
        query: { _id: { $ne: objectId } },
        options: { 
          sort: { "_internal.created": -1 },
          limit: 100,
        },
      });
      setAvailableObjects(result || []);
      
      const options: ComboboxOption[] = (result || []).map((obj: APObject) => ({
        value: obj._id?.toString() || "",
        label: `${getObjectName(obj)} (${obj._id?.toString()})`,
      }));
      setObjectOptions(options);
    } catch (error) {
      console.error("Failed to load available objects:", error);
    }
  };
  
  const addEdge = async () => {
    try {
      const newId = new ObjectId();
      const targetObjectId = new ObjectId(newEdge.targetId);
      const edge = {
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Edge",
        _id: newId,
        id: `https://mycelia.tech/objects/${newId.toString()}`,
        subject: newEdge.direction === "outgoing" ? objectId : targetObjectId,
        object: newEdge.direction === "outgoing" ? targetObjectId : objectId,
        relationship: newEdge.predicate,
        _internal: {
          created: new Date(),
          updated: new Date(),
        },
      };
      
      await callResource("tech.mycelia.mongo", {
        action: "insertOne",
        collection: "objects",
        doc: edge,
      });
      
      setNewEdge({ predicate: "", targetId: "", direction: "outgoing" });
      setShowAddForm(false);
      loadEdges();
    } catch (error) {
      console.error("Failed to create edge:", error);
    }
  };
  
  const deleteEdge = async (edgeId: string) => {
    if (!confirm("Are you sure you want to delete this edge?")) return;
    
    try {
      await callResource("tech.mycelia.mongo", {
        action: "deleteOne",
        collection: "objects",
        query: { _id: new ObjectId(edgeId) },
      });
      
      loadEdges();
    } catch (error) {
      console.error("Failed to delete edge:", error);
    }
  };
  
  const getRelatedObjectName = (objId: ObjectId): string => {
    const obj = relatedObjects.get(objId.toString());
    if (!obj) return objId.toString();
    
    if (typeof obj.name === 'string') return obj.name;
    if (typeof obj.name === 'object' && obj.name !== null) {
      return obj.name.en || Object.values(obj.name)[0] || 'Untitled';
    }
    return 'Untitled';
  };
  
  const outgoingEdges = edges.filter(e => e.subject.toString() === objectId.toString());
  const incomingEdges = edges.filter(e => e.object.toString() === objectId.toString());
  
  return (
    <Card className={`p-4 ${className || ''}`}>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Edges</h3>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowAddForm(!showAddForm)}
          >
            <Plus className="w-4 h-4 mr-1" />
            Add Edge
          </Button>
        </div>
        
        {showAddForm && (
          <Card className="p-4 bg-muted">
            <div className="space-y-3">
              <div>
                <Label htmlFor="direction">Direction</Label>
                <div className="flex gap-2 mt-1">
                  <Button
                    size="sm"
                    variant={newEdge.direction === "outgoing" ? "default" : "outline"}
                    onClick={() => setNewEdge({ ...newEdge, direction: "outgoing" })}
                  >
                    Outgoing (this → target)
                  </Button>
                  <Button
                    size="sm"
                    variant={newEdge.direction === "incoming" ? "default" : "outline"}
                    onClick={() => setNewEdge({ ...newEdge, direction: "incoming" })}
                  >
                    Incoming (target → this)
                  </Button>
                </div>
              </div>
              
              <div>
                <Label htmlFor="predicate">Predicate</Label>
                <select
                  id="predicate"
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm mt-1"
                  value={newEdge.predicate}
                  onChange={(e) => setNewEdge({ ...newEdge, predicate: e.target.value })}
                >
                  <option value="">Select predicate...</option>
                  {Object.entries(PREDICATES).map(([key, value]) => (
                    <option key={value} value={value}>
                      {key.toLowerCase().replace(/_/g, ' ')} ({value})
                    </option>
                  ))}
                </select>
              </div>
              
              <div>
                <Label htmlFor="targetId">Target Object</Label>
                <Combobox
                  options={objectOptions}
                  value={newEdge.targetId || undefined}
                  onValueChange={(value) => setNewEdge({ ...newEdge, targetId: value || "" })}
                  placeholder="Select target object..."
                  searchPlaceholder="Search objects..."
                  emptyText="No objects found."
                  className="mt-1"
                />
              </div>
              
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={addEdge}
                  disabled={!newEdge.predicate || !newEdge.targetId}
                >
                  Create Edge
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setShowAddForm(false);
                    setNewEdge({ predicate: "", targetId: "", direction: "outgoing" });
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </Card>
        )}
        
        {loading ? (
          <div className="text-center py-4 text-muted-foreground">
            Loading edges...
          </div>
        ) : (
          <div className="space-y-4">
            {outgoingEdges.length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-2">Outgoing</h4>
                <div className="space-y-2">
                  {outgoingEdges.map((edge) => (
                    <div
                      key={edge._id?.toString()}
                      className="flex items-center justify-between p-2 border rounded-md"
                    >
                      <div className="flex items-center gap-2 flex-1">
                        <Badge variant="outline">{edge.relationship}</Badge>
                        <span className="text-sm">→</span>
                        <Link
                          to={`/objects/${edge.object.toString()}`}
                          className="text-sm hover:underline flex items-center gap-1"
                        >
                          {getRelatedObjectName(edge.object)}
                          <ExternalLink className="w-3 h-3" />
                        </Link>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => edge._id && deleteEdge(edge._id.toString())}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {incomingEdges.length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-2">Incoming</h4>
                <div className="space-y-2">
                  {incomingEdges.map((edge) => (
                    <div
                      key={edge._id?.toString()}
                      className="flex items-center justify-between p-2 border rounded-md"
                    >
                      <div className="flex items-center gap-2 flex-1">
                        <Link
                          to={`/objects/${edge.subject.toString()}`}
                          className="text-sm hover:underline flex items-center gap-1"
                        >
                          {getRelatedObjectName(edge.subject)}
                          <ExternalLink className="w-3 h-3" />
                        </Link>
                        <span className="text-sm">→</span>
                        <Badge variant="outline">{edge.relationship}</Badge>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => edge._id && deleteEdge(edge._id.toString())}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {outgoingEdges.length === 0 && incomingEdges.length === 0 && (
              <div className="text-center py-4 text-muted-foreground text-sm">
                No edges found. Click "Add Edge" to create one.
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

