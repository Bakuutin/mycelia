/**
 * Makes all fields in a JSON schema non-required and filters out fields
 * that do not have a default value.
 * @param schema The original JSON schema.
 * @returns A new JSON schema with all fields optional and filtered.
 */
export function makeSchemaOptionalAndFilterDefaults(schema: any): any {
  if (!schema || !schema.properties) {
    return schema;
  }

  const newProperties: Record<string, any> = {};
  const requiredFields = new Set(schema.required || []);
  for (const key in schema.properties) {
    const property = schema.properties[key];
    // Keep if it has a default value, or if it is a required field.
    // Otherwise, drop it from the schema entirely.
    if (property.default !== undefined || requiredFields.has(key)) {
      newProperties[key] = { ...property };
      delete newProperties[key].optional; // Ensure it's not marked as optional explicitly if it has a default
    }
  }

  const newSchema = {
    ...schema,
    properties: newProperties,
    required: [], // Explicitly make all fields non-required by default
  };

  return newSchema;
}
