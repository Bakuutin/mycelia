import type { APObject } from "@/types/activitypub";

export const OBJECT_TYPES = {
  PERSON: "Person",
  NOTE: "Note", 
  AUDIO: "Audio",
  EVENT: "Event",
  PLACE: "Place",
  EDGE: "Edge",
} as const;

export type ObjectType = typeof OBJECT_TYPES[keyof typeof OBJECT_TYPES];

export interface FieldConfig {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'datetime' | 'number' | 'select' | 'reference' | 'emoji';
  required?: boolean;
  description?: string;
  options?: string[];
  placeholder?: string;
}

export interface ObjectSchema {
  type: ObjectType;
  label: string;
  description: string;
  icon: string;
  fields: FieldConfig[];
}

export const OBJECT_SCHEMAS: Record<ObjectType, ObjectSchema> = {
  [OBJECT_TYPES.PERSON]: {
    type: OBJECT_TYPES.PERSON,
    label: "Person",
    description: "A person in your timeline",
    icon: "👤",
    fields: [
      { key: "name", label: "Name", type: "text", required: true, description: "Full name of the person" },
      { key: "summary", label: "Summary", type: "textarea", description: "Brief description of the person" },
      { key: "preferredUsername", label: "Username", type: "text", description: "Username or handle" },
      { key: "mycelia:icon", label: "Icon", type: "emoji", description: "Emoji icon for this person" },
      { key: "image", label: "Image", type: "text", description: "URL to profile image" },
    ]
  },
  
  [OBJECT_TYPES.NOTE]: {
    type: OBJECT_TYPES.NOTE,
    label: "Note",
    description: "A text note or thought",
    icon: "📝",
    fields: [
      { key: "name", label: "Title", type: "text", description: "Title of the note" },
      { key: "content", label: "Content", type: "textarea", required: true, description: "Main content of the note" },
      { key: "published", label: "Published", type: "datetime", description: "When this note was published" },
      { key: "attributedTo", label: "Author", type: "reference", description: "Who wrote this note" },
      { key: "inReplyTo", label: "In Reply To", type: "reference", description: "Note this is replying to" },
    ]
  },
  
  [OBJECT_TYPES.AUDIO]: {
    type: OBJECT_TYPES.AUDIO,
    label: "Audio",
    description: "An audio recording or file",
    icon: "🎵",
    fields: [
      { key: "name", label: "Title", type: "text", description: "Title of the audio" },
      { key: "summary", label: "Summary", type: "textarea", description: "Description of the audio content" },
      { key: "published", label: "Published", type: "datetime", description: "When this audio was published" },
      { key: "startTime", label: "Start Time", type: "datetime", description: "When the audio starts" },
      { key: "endTime", label: "End Time", type: "datetime", description: "When the audio ends" },
      { key: "attributedTo", label: "Speaker", type: "reference", description: "Who is speaking" },
      { key: "attachment", label: "Audio File", type: "text", description: "URL to audio file" },
    ]
  },
  
  [OBJECT_TYPES.EVENT]: {
    type: OBJECT_TYPES.EVENT,
    label: "Event",
    description: "Something that happened at a specific time",
    icon: "📅",
    fields: [
      { key: "name", label: "Event Name", type: "text", required: true, description: "Name of the event" },
      { key: "summary", label: "Description", type: "textarea", description: "What happened at this event" },
      { key: "startTime", label: "Start Time", type: "datetime", required: true, description: "When the event started" },
      { key: "endTime", label: "End Time", type: "datetime", description: "When the event ended" },
      { key: "location", label: "Location", type: "reference", description: "Where this event took place" },
      { key: "attributedTo", label: "Organizer", type: "reference", description: "Who organized this event" },
    ]
  },
  
  [OBJECT_TYPES.PLACE]: {
    type: OBJECT_TYPES.PLACE,
    label: "Place",
    description: "A physical location",
    icon: "📍",
    fields: [
      { key: "name", label: "Place Name", type: "text", required: true, description: "Name of the place" },
      { key: "summary", label: "Description", type: "textarea", description: "Description of the place" },
      { key: "latitude", label: "Latitude", type: "number", description: "Latitude coordinate" },
      { key: "longitude", label: "Longitude", type: "number", description: "Longitude coordinate" },
    ]
  },
  
  [OBJECT_TYPES.EDGE]: {
    type: OBJECT_TYPES.EDGE,
    label: "Edge",
    description: "A connection between two objects",
    icon: "🔗",
    fields: [
      { key: "subject", label: "From", type: "reference", required: true, description: "Source object" },
      { key: "object", label: "To", type: "reference", required: true, description: "Target object" },
      { key: "relationship", label: "Relationship", type: "text", required: true, description: "Type of relationship" },
      { key: "startTime", label: "Start Time", type: "datetime", description: "When this relationship started" },
      { key: "endTime", label: "End Time", type: "datetime", description: "When this relationship ended" },
    ]
  }
};

export function getSchemaForType(type: ObjectType): ObjectSchema {
  return OBJECT_SCHEMAS[type];
}

export function getSchemaForObject(object: APObject): ObjectSchema {
  const objectType = Array.isArray(object.type) ? object.type[0] : object.type;
  return getSchemaForType(objectType as ObjectType);
}

export function getDefaultObjectForType(type: ObjectType): Partial<APObject> {
  return {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      {
        "mycelia": "https://mycelia.tech/ns/"
      }
    ],
    type: type,
    id: "",
  };
}
