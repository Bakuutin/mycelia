export type ScopeAction = "read" | "write" | "modify" | "delete";

export type Scope = {
  filter: Record<string, any>;
  actions: ScopeAction[];
};

export type TypeConverter<T> = (value: any) => T;

export interface TypedObject {
  type: string;
  [key: string]: any;
}

export interface ConverterRegistry {
  [type: string]: TypeConverter<any>;
}

const converters: ConverterRegistry = {
  "isodate": (value: any) => new Date(value),
};

/**
 * Recursively converts {type: xxx, xxx: value} objects to instances of the given type.
 *
 * @param data - The data to process.
 * @returns The processed data.
 */
export function expandTypedObjects(data: any): any {
  if (data === null || data === undefined || typeof data !== "object") {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => expandTypedObjects(item));
  }

  if (isTypedObject(data) && converters[data.type]) {
    return converters[data.type](data[data.type]);
  }

  const result: Record<string, any> = {};

  for (const key in data) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      result[key] = expandTypedObjects(data[key]);
    }
  }

  return result;
}

function isTypedObject(obj: any): obj is TypedObject {
  return (
    obj !== null &&
    typeof obj === "object" &&
    typeof obj.type === "string" &&
    obj.type in obj &&
    obj[obj.type] !== undefined
  );
}
