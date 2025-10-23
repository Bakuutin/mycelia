import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { callResource } from "@/lib/api";
import type { APObject } from "@/types/activitypub";
import { OBJECT_TYPES } from "@/types/activitypub";
import { SimpleObjectEditor } from "@/components/activitypub/SimpleObjectEditor";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Code, Eye, Copy, Check } from "lucide-react";
import { ObjectId, EJSON } from "bson";

const CreateObjectPage = () => {
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rawMode, setRawMode] = useState(false);
  const [rawJson, setRawJson] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  
  const [object, setObject] = useState<APObject>({
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      {
        "mycelia": "https://mycelia.tech/ns/",
        "foaf": "http://xmlns.com/foaf/0.1/",
        "schema": "http://schema.org/",
      }
    ],
    type: OBJECT_TYPES.NOTE,
    id: "",
    name: "",
    _internal: {
      created: new Date(),
      updated: new Date(),
      localId: new ObjectId(),
      indexed: false,
    },
  });

  // Initialize raw JSON when switching to raw mode
  const handleToggleRawMode = () => {
    if (!rawMode) {
      // Switching to raw mode - serialize current object
      try {
        const serialized = EJSON.stringify(object);
        setRawJson(JSON.stringify(JSON.parse(serialized), null, 2));
        setJsonError(null);
      } catch (err) {
        setJsonError("Failed to serialize object");
      }
    } else {
      // Switching from raw mode - parse JSON and update object
      try {
        const parsed = EJSON.parse(rawJson);
        setObject(parsed);
        setJsonError(null);
      } catch (err) {
        setJsonError("Invalid JSON format");
      }
    }
    setRawMode(!rawMode);
  };

  // Handle raw JSON changes
  const handleRawJsonChange = (value: string) => {
    setRawJson(value);
    setJsonError(null);
    
    try {
      const parsed = EJSON.parse(value);
      setObject(parsed);
    } catch (err) {
      setJsonError("Invalid JSON format");
    }
  };

  // Copy raw JSON to clipboard
  const handleCopyJson = async () => {
    try {
      await navigator.clipboard.writeText(rawJson);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy to clipboard:", err);
    }
  };
  
  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      
      
      const newId = new ObjectId();
      const objectToCreate = {
        ...object,
        _id: newId,
        id: `https://mycelia.tech/objects/${newId.toString()}`,
        published: object.published || new Date().toISOString(),
      };
      
      const result = await callResource("tech.mycelia.mongo", {
        action: "insertOne",
        collection: "objects",
        doc: objectToCreate,
      });
      
      const createdId = result._id?.toString();
      if (createdId) {
        navigate(`/objects/${createdId}`);
      } else {
        navigate("/objects");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create object");
    } finally {
      setSaving(false);
    }
  };
  
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link to="/objects">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Objects
          </Button>
        </Link>
        
        <div className="flex items-center gap-2">
          <Button
            variant={rawMode ? "default" : "outline"}
            size="sm"
            onClick={handleToggleRawMode}
          >
            {rawMode ? <Eye className="w-4 h-4 mr-2" /> : <Code className="w-4 h-4 mr-2" />}
            {rawMode ? "Form Mode" : "Raw EJSON"}
          </Button>
        </div>
      </div>
      
      {error && (
        <div className="bg-destructive/10 border border-destructive text-destructive px-4 py-3 rounded">
          {error}
        </div>
      )}
      
      {jsonError && (
        <div className="bg-destructive/10 border border-destructive text-destructive px-4 py-3 rounded">
          JSON Error: {jsonError}
        </div>
      )}
      
      {rawMode ? (
        <Card className="p-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold">Raw EJSON Editor</h2>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyJson}
                disabled={!rawJson}
              >
                {copied ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
                {copied ? "Copied!" : "Copy"}
              </Button>
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-medium">
                EJSON Object (supports MongoDB types like ObjectId, Date, etc.)
              </label>
              <Textarea
                value={rawJson}
                onChange={(e) => handleRawJsonChange(e.target.value)}
                className="font-mono text-sm min-h-[400px]"
                placeholder="Enter EJSON object..."
              />
            </div>
            
            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button
                variant="outline"
                onClick={() => navigate("/objects")}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving || !!jsonError}
              >
                {saving ? "Creating..." : "Create Object"}
              </Button>
            </div>
          </div>
        </Card>
      ) : (
        <SimpleObjectEditor
          object={object}
          onChange={setObject}
          onSave={handleSave}
          onCancel={() => navigate("/objects")}
        />
      )}
      
      {saving && (
        <div className="text-center text-muted-foreground">
          Creating object...
        </div>
      )}
    </div>
  );
};

export default CreateObjectPage;

