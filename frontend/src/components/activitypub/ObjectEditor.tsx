import { useState, useEffect } from "react";
import { RJSFSchema, UiSchema } from "@rjsf/utils";
import { Form } from "@rjsf/core";
import validator from "@rjsf/validator-ajv8";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TypeBadges } from "./TypeBadges";
import { 
  APObject, 
  OBJECT_TYPES, 
  VISIBILITY_OPTIONS,
  hasType,
  getObjectName,
  getProperty 
} from "@/types/activitypub";
import { jsonldSchemaGenerator } from "@/lib/jsonld-schema-generator";
import { X, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface ObjectEditorProps {
  object: APObject;
  onChange: (updated: APObject) => void;
  onSave?: () => void;
  onCancel?: () => void;
}

export function ObjectEditor({ object, onChange, onSave, onCancel }: ObjectEditorProps) {
  const [formData, setFormData] = useState(() => jsonldSchemaGenerator.getDefaultFormData(object));
  const [errors, setErrors] = useState<any[]>([]);
  const [schema, setSchema] = useState<any>(null);
  const [uiSchema, setUiSchema] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const generateSchemas = async () => {
      try {
        setLoading(true);
        const generatedSchema = await jsonldSchemaGenerator.generateSchemaFromObject(object);
        const resolvedContext = await jsonldSchemaGenerator.resolveContext(object["@context"]);
        const generatedUISchema = jsonldSchemaGenerator.generateUISchema(object, resolvedContext);
        
        setSchema(generatedSchema);
        setUiSchema(generatedUISchema);
      } catch (error) {
        console.error('Failed to generate schemas:', error);
        // Fallback to basic schema
        setSchema({
          type: "object",
          properties: {},
          additionalProperties: true
        });
        setUiSchema({});
      } finally {
        setLoading(false);
      }
    };

    generateSchemas();
  }, [object]);

  const handleFormChange = ({ formData: newFormData, errors: newErrors }: any) => {
    setFormData(newFormData);
    setErrors(newErrors);
    
    const updatedObject = {
      ...object,
      ...newFormData,
      type: Array.isArray(newFormData.type) && newFormData.type.length === 1 
        ? newFormData.type[0] 
        : newFormData.type,
    };
    
    onChange(updatedObject);
  };

  const handleSubmit = ({ formData: submittedData }: any) => {
    const updatedObject = {
      ...object,
      ...submittedData,
      type: Array.isArray(submittedData.type) && submittedData.type.length === 1 
        ? submittedData.type[0] 
        : submittedData.type,
    };
    
    onChange(updatedObject);
    onSave?.();
  };

  const updateVisibility = (visibility: "private" | "unlisted" | "public") => {
    onChange({
      ...object,
      _internal: {
        ...object._internal,
        visibility,
        created: object._internal?.created || new Date(),
        updated: new Date(),
        localId: object._internal?.localId || null as any,
        indexed: object._internal?.indexed || false,
      },
    });
  };

  const customWidgets = {
    datetime: {
      component: (props: any) => (
        <input
          {...props}
          type="datetime-local"
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        />
      )
    },
    textarea: {
      component: (props: any) => (
        <textarea
          {...props}
          className="flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        />
      )
    },
    updown: {
      component: (props: any) => (
        <input
          {...props}
          type="number"
          step="any"
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        />
      )
    }
  };

  const customFields = {
    typeSelector: (props: any) => {
      const { schema, formData, onChange } = props;
      const selectedTypes = Array.isArray(formData) ? formData : [formData];
      
      return (
        <div className="space-y-2">
          <label className="text-sm font-medium">Types</label>
          <div className="flex flex-wrap gap-2">
            {Object.values(OBJECT_TYPES).map((type) => (
              <Badge
                key={type}
                variant={selectedTypes.includes(type) ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() => {
                  const newTypes = selectedTypes.includes(type)
                    ? selectedTypes.filter(t => t !== type)
                    : [...selectedTypes, type];
                  onChange(newTypes.length === 1 ? newTypes[0] : newTypes);
                }}
              >
                {type}
              </Badge>
            ))}
          </div>
        </div>
      );
    }
  };

  if (loading) {
    return (
      <Card className="p-6">
        <div className="space-y-6">
          <div>
            <h2 className="text-2xl font-bold mb-4">
              {object.id ? 'Edit Object' : 'Create Object'}
            </h2>
          </div>
          <div className="text-center py-8">
            <p className="text-muted-foreground">Loading schema...</p>
          </div>
        </div>
      </Card>
    );
  }

  if (!schema || !uiSchema) {
    return (
      <Card className="p-6">
        <div className="space-y-6">
          <div>
            <h2 className="text-2xl font-bold mb-4">
              {object.id ? 'Edit Object' : 'Create Object'}
            </h2>
          </div>
          <div className="text-center py-8">
            <p className="text-destructive">Failed to load schema</p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold mb-4">
            {object.id ? 'Edit Object' : 'Create Object'}
          </h2>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium">Visibility</label>
            <div className="flex gap-2 mt-2">
              {VISIBILITY_OPTIONS.map((option) => (
                <Button
                  key={option.value}
                  variant={object._internal?.visibility === option.value ? "default" : "outline"}
                  size="sm"
                  onClick={() => updateVisibility(option.value as any)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {VISIBILITY_OPTIONS.find(o => o.value === object._internal?.visibility)?.description}
            </p>
          </div>

          <Form
            schema={schema}
            uiSchema={uiSchema}
            formData={formData}
            onChange={handleFormChange}
            onSubmit={handleSubmit}
            widgets={customWidgets}
            fields={customFields}
            showErrorList={false}
            liveValidate={true}
            validator={validator}
          >
            <div className="flex justify-end gap-2 pt-4 border-t">
              {onCancel && (
                <Button variant="outline" onClick={onCancel}>
                  Cancel
                </Button>
              )}
              {onSave && (
                <Button type="submit">
                  Save Object
                </Button>
              )}
            </div>
          </Form>
        </div>
      </div>
    </Card>
  );
}

