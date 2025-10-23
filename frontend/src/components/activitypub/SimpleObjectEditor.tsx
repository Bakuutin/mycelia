import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DateTimePicker } from "@/components/ui/datetime-picker";
import { 
  APObject, 
  OBJECT_TYPES
} from "@/types/activitypub";
import { OBJECT_SCHEMAS, getSchemaForType, getDefaultObjectForType, type ObjectType } from "@/lib/object-schemas";
import { useObjects } from "@/hooks/useObjects";
import { getObjectName, getObjectTypes } from "@/types/activitypub";
import { ObjectId } from "bson";

interface SimpleObjectEditorProps {
  object: APObject;
  onChange: (updated: APObject) => void;
  showActions?: boolean;
  onSave?: () => void;
  onCancel?: () => void;
}

interface ObjectIdSelectProps {
  value: string;
  onChange: (value: string) => void;
  field: string;
  filterType?: ObjectType;
}

function ObjectIdSelect({ value, onChange, field, filterType }: ObjectIdSelectProps) {
  const { data: objects, isLoading } = useObjects();

  const getObjectDisplayName = (obj: APObject) => {
    const name = getObjectName(obj);
    const types = getObjectTypes(obj);
    const id = obj._id?.toString() || obj.id || 'Unknown ID';
    return `${name} (${types.join(', ')}) - ${id}`;
  };

  const filteredObjects = objects?.filter(obj => {
    if (!filterType) return true;
    const objectTypes = getObjectTypes(obj);
    return objectTypes.includes(filterType);
  }) || [];

  if (isLoading) {
    return (
      <div className="mt-1 p-2 border rounded-md bg-muted">
        <span className="text-sm text-muted-foreground">Loading objects...</span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Select 
        value={value} 
        onValueChange={onChange}
      >
        <SelectTrigger className="mt-1">
          <SelectValue placeholder={`Select ${field}...`} />
        </SelectTrigger>
        <SelectContent>
          {filteredObjects.map((obj) => (
            <SelectItem key={obj._id?.toString() || obj.id} value={obj._id?.toString() || obj.id || ''}>
              <div className="flex flex-col">
                <span className="font-medium">{getObjectName(obj)}</span>
                <span className="text-xs text-muted-foreground">
                  {getObjectTypes(obj).join(', ')} - {obj._id?.toString() || obj.id}
                </span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      
      {/* Allow manual input as fallback */}
      <Input
        placeholder={`Or enter ${field} ID/URL manually...`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="text-sm"
      />
    </div>
  );
}

export function SimpleObjectEditor({ object, onChange, showActions = true, onSave, onCancel }: SimpleObjectEditorProps) {
  const [selectedType, setSelectedType] = useState<ObjectType>(
    (Array.isArray(object.type) ? object.type[0] : object.type) as ObjectType
  );
  const [formData, setFormData] = useState<Record<string, any>>({});

  const schema = getSchemaForType(selectedType);

  useEffect(() => {
    // Initialize form data from object
    const data: Record<string, any> = {};
    for (const field of schema.fields) {
      data[field.key] = object[field.key] || '';
    }
    setFormData(data);
  }, [selectedType, object]);

  const handleFieldChange = (fieldKey: string, value: any) => {
    const newFormData = { ...formData, [fieldKey]: value };
    setFormData(newFormData);
    
    // Update the object
    const updatedObject = {
      ...object,
      ...newFormData,
      type: selectedType,
    };
    
    onChange(updatedObject);
  };

  const handleTypeChange = (newType: ObjectType) => {
    setSelectedType(newType);
    const defaultObject = getDefaultObjectForType(newType);
    const newSchema = getSchemaForType(newType);
    
    // Reset form data for new type
    const data: Record<string, any> = {};
    for (const field of newSchema.fields) {
      data[field.key] = defaultObject[field.key] || '';
    }
    setFormData(data);
    
    // Update object with new type and reset fields
    const updatedObject = {
      ...object,
      ...defaultObject,
      ...data,
      type: newType,
    };
    
    onChange(updatedObject);
  };


  const renderField = (field: any) => {
    const value = formData[field.key] || '';
    
    if (field.type === 'textarea') {
      return (
        <Textarea
          value={value}
          onChange={(e) => handleFieldChange(field.key, e.target.value)}
          placeholder={field.placeholder}
          rows={3}
        />
      );
    }
    
    if (field.type === 'datetime') {
      return (
        <DateTimePicker
          value={value}
          onChange={(newValue) => handleFieldChange(field.key, newValue)}
          placeholder={field.placeholder || `Select ${field.label.toLowerCase()}`}
        />
      );
    }
    
    if (field.type === 'number') {
      return (
        <Input
          type="number"
          step="any"
          value={value}
          onChange={(e) => handleFieldChange(field.key, e.target.value ? parseFloat(e.target.value) : '')}
        />
      );
    }
    
    if (field.type === 'reference') {
      // Determine filter type based on field key
      let filterType: ObjectType | undefined;
      if (field.key === 'attributedTo') filterType = OBJECT_TYPES.PERSON;
      if (field.key === 'location') filterType = OBJECT_TYPES.PLACE;
      if (field.key === 'inReplyTo') filterType = OBJECT_TYPES.NOTE;
      
      return (
        <ObjectIdSelect
          value={value}
          onChange={(newValue) => handleFieldChange(field.key, newValue)}
          field={field.label}
          filterType={filterType}
        />
      );
    }
    
    if (field.type === 'emoji') {
      return (
        <div className="flex gap-2">
          <Input
            value={value}
            onChange={(e) => handleFieldChange(field.key, e.target.value)}
            placeholder="Enter emoji..."
            className="flex-1"
          />
          <div className="text-2xl">{value}</div>
        </div>
      );
    }
    
    return (
      <Input
        value={value}
        onChange={(e) => handleFieldChange(field.key, e.target.value)}
        placeholder={field.placeholder}
      />
    );
  };

  return (
    <Card className="p-6">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">
            {object.id ? 'Edit Object' : 'Create Object'}
          </h2>
        </div>

        <div className="space-y-4">
          {/* Type Selection */}
          <div>
            <Label className="text-sm font-medium">Object Type</Label>
            <Select value={selectedType} onValueChange={handleTypeChange}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Select object type..." />
              </SelectTrigger>
              <SelectContent>
                {Object.values(OBJECT_SCHEMAS).map((schema) => (
                  <SelectItem key={schema.type} value={schema.type}>
                    <div className="flex items-center gap-2">
                      <span>{schema.icon}</span>
                      <span>{schema.label}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              {schema.description}
            </p>
          </div>


          {/* Type-specific fields */}
          <div className="space-y-4">
            {schema.fields.map((field) => (
              <div key={field.key} className="space-y-2">
                <Label htmlFor={field.key} className="text-sm font-medium">
                  {field.label}
                  {field.required && <span className="text-red-500 ml-1">*</span>}
                </Label>
                {field.description && (
                  <p className="text-xs text-muted-foreground">{field.description}</p>
                )}
                {renderField(field)}
              </div>
            ))}
          </div>
        </div>

        {(onSave || onCancel) && (
          <div className="flex justify-end gap-2 pt-4 border-t">
            {onCancel && (
              <Button variant="outline" onClick={onCancel}>
                Cancel
              </Button>
            )}
            {onSave && (
              <Button onClick={onSave}>
                Save Object
              </Button>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
