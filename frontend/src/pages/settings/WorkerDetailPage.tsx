import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { callResource } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  ArrowLeft,
  Save,
  RotateCcw,
  CheckCircle2,
  XCircle,
  Loader2,
  Plus,
  Trash2,
  Info,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface SchemaProperty {
  type?: string;
  default?: unknown;
  description?: string;
  enum?: unknown[];
}

interface WorkerEntry {
  _id: string;
  name: string;
  discovered: boolean;
  inputSchema: {
    type?: string;
    properties?: Record<string, SchemaProperty>;
    required?: string[];
  };
  outputSchema: Record<string, unknown>;
  defaultOverrides?: Record<string, unknown>;
  lastSeen: string;
}

interface WorkerDefaults {
  workerType: string;
  defaults: Record<string, unknown>;
}

const getTypeString = (value: unknown): string => {
  if (value === null || value === undefined) return "unknown";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (Array.isArray(value)) {
    if (value.length === 0) return "array";
    const firstType = getTypeString(value[0]);
    return `${firstType}[]`;
  }
  if (typeof value === "object") return "object";
  return "unknown";
};

const valuesEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a === "object" && a !== null && b !== null) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
};

const WorkerDetailPage = () => {
  const { workerType } = useParams<{ workerType: string }>();
  const navigate = useNavigate();

  const [worker, setWorker] = useState<WorkerEntry | null>(null);
  const [overrides, setOverrides] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [showAddField, setShowAddField] = useState(false);
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldValue, setNewFieldValue] = useState("");
  const [newFieldType, setNewFieldType] = useState<"string" | "number" | "boolean">("string");

  useEffect(() => {
    const fetchWorker = async () => {
      if (!workerType) return;

      try {
        setLoading(true);
        const [workersResult, defaultsResult] = await Promise.all([
          callResource("jobs", { action: "list_workers" }),
          callResource("jobs", { action: "get_worker_defaults", workerType }),
        ]);

        const foundWorker = (workersResult.workers as WorkerEntry[])?.find(
          (w) => w.name === workerType
        );

        if (!foundWorker) {
          setError(`Worker "${workerType}" not found`);
          return;
        }

        setWorker(foundWorker);
        setOverrides((defaultsResult as WorkerDefaults).defaults || {});
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch worker");
      } finally {
        setLoading(false);
      }
    };

    fetchWorker();
  }, [workerType]);

  const handleSave = async () => {
    if (!workerType) return;

    setSaving(true);
    setSaveSuccess(false);

    try {
      await callResource("jobs", {
        action: "update_worker_defaults",
        workerType,
        defaults: overrides,
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save defaults");
    } finally {
      setSaving(false);
    }
  };

  const handleResetAll = () => {
    setOverrides({});
  };

  const handleFieldChange = (fieldName: string, value: unknown) => {
    setOverrides((prev) => ({
      ...prev,
      [fieldName]: value,
    }));
  };

  const handleResetToSchemaDefault = (fieldName: string, schemaDefault: unknown) => {
    if (schemaDefault === undefined) {
      setOverrides((prev) => {
        const next = { ...prev };
        delete next[fieldName];
        return next;
      });
    } else {
      setOverrides((prev) => {
        const next = { ...prev };
        delete next[fieldName];
        return next;
      });
    }
  };

  const handleDeleteField = (fieldName: string) => {
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[fieldName];
      return next;
    });
  };

  const handleAddCustomField = () => {
    if (!newFieldName.trim()) return;

    let value: string | number | boolean;
    if (newFieldType === "number") {
      value = parseFloat(newFieldValue) || 0;
    } else if (newFieldType === "boolean") {
      value = newFieldValue.toLowerCase() === "true";
    } else {
      value = newFieldValue;
    }

    handleFieldChange(newFieldName, value);
    setNewFieldName("");
    setNewFieldValue("");
    setNewFieldType("string");
    setShowAddField(false);
  };

  const getSchemaFields = (): Array<{
    name: string;
    schema: SchemaProperty;
    isRequired: boolean;
  }> => {
    if (!worker?.inputSchema) return [];
    
    // Handle different JSON Schema structures
    // Zod's toJSONSchema may produce nested structures
    const schema = worker.inputSchema as Record<string, unknown>;
    
    // Debug: log the schema structure
    console.log("[WorkerDetailPage] inputSchema:", JSON.stringify(schema, null, 2));
    
    // Try to find properties at various levels
    let properties: Record<string, SchemaProperty> | undefined;
    let required: string[] = [];
    
    if (schema.properties && typeof schema.properties === "object") {
      properties = schema.properties as Record<string, SchemaProperty>;
      required = (schema.required as string[]) || [];
    } else if (schema.$defs || schema.definitions) {
      // Some JSON Schema generators nest under $defs or definitions
      const defs = (schema.$defs || schema.definitions) as Record<string, unknown>;
      const mainDef = Object.values(defs)[0] as Record<string, unknown> | undefined;
      if (mainDef?.properties) {
        properties = mainDef.properties as Record<string, SchemaProperty>;
        required = (mainDef.required as string[]) || [];
      }
    }
    
    if (!properties) {
      console.log("[WorkerDetailPage] No properties found in schema");
      return [];
    }
    
    console.log("[WorkerDetailPage] Found properties:", Object.keys(properties));

    return Object.entries(properties)
      .filter(([name]) => name !== "type")
      .map(([name, schemaProp]) => ({
        name,
        schema: schemaProp as SchemaProperty,
        isRequired: required.includes(name),
      }));
  };

  const getExtraFields = (): Array<[string, unknown]> => {
    const schemaFields = getSchemaFields();
    const schemaFieldNames = new Set(schemaFields.map(f => f.name));
    
    return Object.entries(overrides).filter(
      ([key]) => !schemaFieldNames.has(key) && key !== "type"
    );
  };

  const renderFieldInput = (
    fieldName: string,
    schema: SchemaProperty,
    currentValue: unknown,
    schemaDefault: unknown,
    isOverridden: boolean
  ) => {
    const displayValue = isOverridden ? currentValue : schemaDefault;

    if (schema.type === "boolean") {
      return (
        <div className="flex items-center gap-2">
          <Switch
            checked={Boolean(displayValue)}
            onCheckedChange={(checked) => handleFieldChange(fieldName, checked)}
          />
          <span className="text-sm text-muted-foreground">
            {displayValue ? "true" : "false"}
          </span>
        </div>
      );
    }

    if (schema.type === "number" || schema.type === "integer") {
      return (
        <Input
          type="number"
          step={schema.type === "integer" ? "1" : "any"}
          value={displayValue !== undefined ? String(displayValue) : ""}
          onChange={(e) => {
            const val = e.target.value;
            if (val === "" && schemaDefault === undefined) {
              handleDeleteField(fieldName);
            } else {
              handleFieldChange(
                fieldName,
                schema.type === "integer" ? parseInt(val, 10) : parseFloat(val)
              );
            }
          }}
          placeholder={schemaDefault !== undefined ? String(schemaDefault) : ""}
          className={isOverridden ? "border-amber-500" : "border-blue-500"}
        />
      );
    }

    if (schema.enum) {
      return (
        <select
          value={displayValue !== undefined ? String(displayValue) : ""}
          onChange={(e) => handleFieldChange(fieldName, e.target.value)}
          className={`flex h-10 w-full rounded-md border bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            isOverridden ? "border-amber-500" : "border-blue-500"
          }`}
        >
          {schemaDefault === undefined && (
            <option value="">Select a value</option>
          )}
          {schema.enum.map((opt) => (
            <option key={String(opt)} value={String(opt)}>
              {String(opt)}
            </option>
          ))}
        </select>
      );
    }

    const stringValue = displayValue !== undefined ? String(displayValue) : "";
    const isLongText = stringValue.length > 100 || stringValue.includes("\n");

    if (isLongText || schema.description?.toLowerCase().includes("prompt")) {
      return (
        <Textarea
          value={stringValue}
          onChange={(e) => {
            if (e.target.value === "" && schemaDefault === undefined) {
              handleDeleteField(fieldName);
            } else {
              handleFieldChange(fieldName, e.target.value);
            }
          }}
          placeholder={schemaDefault !== undefined ? String(schemaDefault) : ""}
          className={`min-h-[100px] ${isOverridden ? "border-amber-500" : "border-blue-500"}`}
        />
      );
    }

    return (
      <Input
        type="text"
        value={stringValue}
        onChange={(e) => {
          if (e.target.value === "" && schemaDefault === undefined) {
            handleDeleteField(fieldName);
          } else {
            handleFieldChange(fieldName, e.target.value);
          }
        }}
        placeholder={schemaDefault !== undefined ? String(schemaDefault) : ""}
        className={isOverridden ? "border-amber-500" : "border-blue-500"}
      />
    );
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => navigate("/settings/workers")}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Workers
        </Button>
        <div className="border rounded-lg p-8 text-center">
          <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
          <p className="text-muted-foreground">Loading worker configuration...</p>
        </div>
      </div>
    );
  }

  if (error || !worker) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => navigate("/settings/workers")}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Workers
        </Button>
        <div className="border rounded-lg p-8 text-center">
          <XCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
          <p className="text-red-500">{error || "Worker not found"}</p>
        </div>
      </div>
    );
  }

  const schemaFields = getSchemaFields();
  const hasOverrides = Object.keys(overrides).length > 0;
  const extraFields = getExtraFields();

  return (
    <TooltipProvider>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => navigate("/settings/workers")}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Workers
          </Button>
          <div className="flex items-center gap-2">
            {hasOverrides && (
              <Button variant="outline" onClick={handleResetAll}>
                <RotateCcw className="w-4 h-4 mr-2" />
                Reset All
              </Button>
            )}
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : saveSuccess ? (
                <>
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  Saved
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  Save Changes
                </>
              )}
            </Button>
          </div>
        </div>

        <div>
          <div className="flex items-center gap-3 mb-2">
            <h2 className="text-2xl font-semibold">{worker.name}</h2>
            {worker.discovered ? (
              <Badge className="bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30">
                Active
              </Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">
                Unavailable
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground">
            Configure default values for this worker. Values set here will be used
            when jobs don't specify them explicitly.
          </p>
        </div>

        {saveSuccess && (
          <div className="p-4 rounded-md bg-green-50 border border-green-200 text-green-700 dark:bg-green-950 dark:border-green-800 dark:text-green-400 flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5" />
            <span>Configuration saved successfully!</span>
          </div>
        )}

        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Configuration Fields</h3>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-1">
                <span>📋</span>
                <span>Using default</span>
              </div>
              <div className="flex items-center gap-1">
                <span>✏️</span>
                <span>Custom value</span>
              </div>
            </div>
          </div>

          {schemaFields.length === 0 && !hasOverrides ? (
            <p className="text-muted-foreground text-center py-8">
              This worker has no schema-defined fields. Add custom fields below.
            </p>
          ) : (
            <div className="space-y-6">
              {schemaFields.map(({ name, schema, isRequired }) => {
                const schemaDefault = schema.default;
                const currentValue = overrides[name];
                const isOverridden = name in overrides;
                const isUsingDefault = !isOverridden || valuesEqual(currentValue, schemaDefault);

                return (
                  <div key={name} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span title={isUsingDefault ? "Using schema default" : "Custom override"}>
                          {isUsingDefault ? "📋" : "✏️"}
                        </span>
                        <Label htmlFor={name} className="text-sm font-medium">
                          {name}
                        </Label>
                        <Badge variant="outline" className="text-xs">
                          {schema.type || "any"}
                        </Badge>
                        {isRequired && (
                          <Badge
                            variant="outline"
                            className="text-xs text-amber-600 border-amber-500/50"
                          >
                            required
                          </Badge>
                        )}
                        {schema.description && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Info className="w-4 h-4 text-muted-foreground cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent className="max-w-sm">
                              <p>{schema.description}</p>
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                      {isOverridden && !valuesEqual(currentValue, schemaDefault) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleResetToSchemaDefault(name, schemaDefault)}
                          className="text-xs h-7"
                        >
                          <RotateCcw className="w-3 h-3 mr-1" />
                          Reset to default
                        </Button>
                      )}
                    </div>

                    {renderFieldInput(name, schema, currentValue, schemaDefault, isOverridden)}

                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      {schemaDefault !== undefined && (
                        <span>
                          Schema default:{" "}
                          <code className="bg-muted px-1 rounded">
                            {typeof schemaDefault === "string" && schemaDefault.length > 50
                              ? `${schemaDefault.substring(0, 50)}...`
                              : JSON.stringify(schemaDefault)}
                          </code>
                        </span>
                      )}
                      {!isOverridden ? (
                        <span className="text-blue-600 dark:text-blue-400 font-medium">
                          Using schema default
                        </span>
                      ) : valuesEqual(currentValue, schemaDefault) ? (
                        <span className="text-blue-600 dark:text-blue-400 font-medium">
                          Value matches default
                        </span>
                      ) : (
                        <span className="text-amber-600 dark:text-amber-400 font-medium">
                          Custom override
                        </span>
                      )}
                    </div>

                    <Separator className="mt-4" />
                  </div>
                );
              })}
            </div>
          )}

          {extraFields.length > 0 && (
            <>
              {schemaFields.length > 0 && <Separator className="my-6" />}
              <div className="space-y-4">
                <h4 className="text-sm font-medium text-muted-foreground">Custom Fields (not in schema)</h4>
                <div className="border rounded-lg divide-y">
                  {extraFields.map(([key, value]) => {
                    const valueType = getTypeString(value);
                    const isBoolean = valueType === "boolean";
                    const isNumber = valueType === "number";

                    return (
                      <div
                        key={key}
                        className="p-3 grid grid-cols-[auto_auto_1fr_auto] gap-3 items-center"
                      >
                        <span title="Custom field">✏️</span>
                        <div className="font-mono text-sm font-medium">{key}</div>
                        {isBoolean ? (
                          <select
                            value={String(value)}
                            onChange={(e) => {
                              handleFieldChange(key, e.target.value === "true");
                            }}
                            className="flex h-9 w-full rounded-md border border-amber-500 bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          >
                            <option value="true">true</option>
                            <option value="false">false</option>
                          </select>
                        ) : isNumber ? (
                          <Input
                            type="number"
                            step="any"
                            value={value !== undefined ? String(value) : ""}
                            onChange={(e) => {
                              const numValue =
                                e.target.value === "" ? 0 : parseFloat(e.target.value);
                              handleFieldChange(key, numValue);
                            }}
                            className="text-sm border-amber-500"
                          />
                        ) : (
                          <Input
                            value={typeof value === "string" ? value : JSON.stringify(value)}
                            onChange={(e) => {
                              handleFieldChange(key, e.target.value);
                            }}
                            className="text-sm border-amber-500"
                          />
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteField(key)}
                          className="h-8 w-8 p-0"
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          <Separator className="my-6" />

          {showAddField ? (
            <div className="border rounded-lg p-4 space-y-3 bg-muted/50">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="new-field-name" className="text-xs">
                    Field Name
                  </Label>
                  <Input
                    id="new-field-name"
                    value={newFieldName}
                    onChange={(e) => setNewFieldName(e.target.value)}
                    placeholder="fieldName"
                    className="mt-1 font-mono"
                  />
                </div>
                <div>
                  <Label htmlFor="new-field-type" className="text-xs">
                    Type
                  </Label>
                  <select
                    id="new-field-type"
                    value={newFieldType}
                    onChange={(e) =>
                      setNewFieldType(e.target.value as "string" | "number" | "boolean")
                    }
                    className="mt-1 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="string">string</option>
                    <option value="number">number</option>
                    <option value="boolean">boolean</option>
                  </select>
                </div>
              </div>
              <div>
                <Label htmlFor="new-field-value" className="text-xs">
                  Value
                </Label>
                {newFieldType === "boolean" ? (
                  <select
                    id="new-field-value"
                    value={newFieldValue}
                    onChange={(e) => setNewFieldValue(e.target.value)}
                    className="mt-1 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                ) : (
                  <Input
                    id="new-field-value"
                    type={newFieldType === "number" ? "number" : "text"}
                    value={newFieldValue}
                    onChange={(e) => setNewFieldValue(e.target.value)}
                    placeholder={newFieldType === "number" ? "0" : "value"}
                    className="mt-1"
                  />
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handleAddCustomField}
                  disabled={!newFieldName.trim()}
                >
                  Add Field
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowAddField(false);
                    setNewFieldName("");
                    setNewFieldValue("");
                    setNewFieldType("string");
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setShowAddField(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Add Custom Field
            </Button>
          )}
        </Card>

        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">Priority Order</h3>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <Badge className="w-6 h-6 flex items-center justify-center rounded-full">
                1
              </Badge>
              <span>
                <strong>Job Data</strong> — Explicit values in the job payload
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Badge
                variant="secondary"
                className="w-6 h-6 flex items-center justify-center rounded-full bg-amber-500/10 text-amber-700"
              >
                2
              </Badge>
              <span>
                <strong>Default Overrides</strong> — Custom values configured on this page
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className="w-6 h-6 flex items-center justify-center rounded-full bg-blue-500/10 text-blue-700 border-blue-500/30"
              >
                3
              </Badge>
              <span>
                <strong>Schema Defaults</strong> — Default values defined in worker code
              </span>
            </div>
          </div>
        </Card>
      </div>
    </TooltipProvider>
  );
};

export default WorkerDetailPage;
