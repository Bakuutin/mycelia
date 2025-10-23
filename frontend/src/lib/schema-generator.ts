import type { APObject } from "@/types/activitypub";
import { OBJECT_TYPES } from "@/types/activitypub";

export interface JSONSchema {
  type: string;
  properties: Record<string, any>;
  required?: string[];
  additionalProperties?: boolean;
}

export function generateObjectSchema(object: APObject): JSONSchema {
  const baseSchema: JSONSchema = {
    type: "object",
    properties: {
      "@context": {
        type: "array",
        items: {
          oneOf: [
            { type: "string" },
            { type: "object" }
          ]
        },
        default: [
          "https://www.w3.org/ns/activitystreams",
          {
            "mycelia": "https://mycelia.tech/ns/",
            "foaf": "http://xmlns.com/foaf/0.1/",
            "schema": "http://schema.org/"
          }
        ]
      },
      type: {
        type: "array",
        items: {
          type: "string",
          enum: Object.values(OBJECT_TYPES)
        },
        default: ["Note"]
      },
      id: {
        type: "string",
        format: "uri"
      },
      name: {
        oneOf: [
          { type: "string" },
          { type: "object", additionalProperties: { type: "string" } }
        ]
      },
      summary: {
        oneOf: [
          { type: "string" },
          { type: "object", additionalProperties: { type: "string" } }
        ]
      },
      content: {
        oneOf: [
          { type: "string" },
          { type: "object", additionalProperties: { type: "string" } }
        ]
      },
      published: {
        type: "string",
        format: "date-time"
      },
      updated: {
        type: "string",
        format: "date-time"
      },
      icon: {
        oneOf: [
          { type: "string" },
          { type: "object" }
        ]
      },
      image: {
        oneOf: [
          { type: "string" },
          { type: "object" }
        ]
      },
      attachment: {
        type: "array",
        items: {
          type: "object"
        }
      },
      attributedTo: {
        oneOf: [
          { type: "string" },
          { type: "array", items: { type: "string" } },
          { type: "object" },
          { type: "array", items: { type: "object" } }
        ]
      },
      inReplyTo: {
        oneOf: [
          { type: "string" },
          { type: "array", items: { type: "string" } },
          { type: "object" },
          { type: "array", items: { type: "object" } }
        ]
      },
      replies: {
        oneOf: [
          { type: "string" },
          { type: "object" }
        ]
      },
      followers: {
        oneOf: [
          { type: "string" },
          { type: "object" }
        ]
      },
      following: {
        oneOf: [
          { type: "string" },
          { type: "object" }
        ]
      },
      likes: {
        oneOf: [
          { type: "string" },
          { type: "object" }
        ]
      },
      shares: {
        oneOf: [
          { type: "string" },
          { type: "object" }
        ]
      },
      startTime: {
        type: "string",
        format: "date-time"
      },
      endTime: {
        type: "string",
        format: "date-time"
      },
      to: {
        oneOf: [
          { type: "string" },
          { type: "array", items: { type: "string" } }
        ]
      },
      cc: {
        oneOf: [
          { type: "string" },
          { type: "array", items: { type: "string" } }
        ]
      },
      bto: {
        oneOf: [
          { type: "string" },
          { type: "array", items: { type: "string" } }
        ]
      },
      bcc: {
        oneOf: [
          { type: "string" },
          { type: "array", items: { type: "string" } }
        ]
      },
      audience: {
        oneOf: [
          { type: "string" },
          { type: "array", items: { type: "string" } }
        ]
      },
      latitude: {
        type: "number"
      },
      longitude: {
        type: "number"
      },
      preferredUsername: {
        type: "string"
      },
      "mycelia:icon": {
        type: "string",
        title: "Icon (Emoji)"
      }
    },
    required: ["type", "id"],
    additionalProperties: true
  };

  return baseSchema;
}

export function generateUISchema(object: APObject): Record<string, any> {
  const types = Array.isArray(object.type) ? object.type : [object.type];
  const isPerson = types.includes("Person");
  const isNote = types.includes("Note");
  const isEvent = types.includes("Event");
  const isPlace = types.includes("Place");

  const uiSchema: Record<string, any> = {
    "@context": {
      "ui:widget": "textarea",
      "ui:help": "ActivityPub context definitions"
    },
    type: {
      "ui:widget": "checkboxes",
      "ui:help": "Select one or more object types"
    },
    id: {
      "ui:widget": "uri",
      "ui:help": "Unique identifier for this object"
    },
    name: {
      "ui:widget": "textarea",
      "ui:help": "Display name for this object"
    },
    summary: {
      "ui:widget": "textarea",
      "ui:help": "Brief summary or description"
    },
    content: {
      "ui:widget": "textarea",
      "ui:help": "Main content (supports HTML)"
    },
    published: {
      "ui:widget": "datetime-local",
      "ui:help": "When this object was published"
    },
    updated: {
      "ui:widget": "datetime-local",
      "ui:help": "When this object was last updated"
    },
    startTime: {
      "ui:widget": "datetime-local",
      "ui:help": "Start time for events"
    },
    endTime: {
      "ui:widget": "datetime-local",
      "ui:help": "End time for events"
    },
    latitude: {
      "ui:widget": "updown",
      "ui:help": "Latitude for places"
    },
    longitude: {
      "ui:widget": "updown",
      "ui:help": "Longitude for places"
    },
    preferredUsername: {
      "ui:help": "Username for person objects"
    },
    "mycelia:icon": {
      "ui:help": "Emoji icon for this object"
    }
  };

  return uiSchema;
}

export function getDefaultFormData(object: APObject): any {
  return {
    "@context": object["@context"] || [
      "https://www.w3.org/ns/activitystreams",
      {
        "mycelia": "https://mycelia.tech/ns/",
        "foaf": "http://xmlns.com/foaf/0.1/",
        "schema": "http://schema.org/"
      }
    ],
    type: Array.isArray(object.type) ? object.type : [object.type],
    id: object.id || "",
    name: object.name || "",
    summary: object.summary || "",
    content: object.content || "",
    published: object.published || "",
    updated: object.updated || "",
    icon: object.icon || "",
    image: object.image || "",
    attachment: object.attachment || [],
    attributedTo: object.attributedTo || "",
    inReplyTo: object.inReplyTo || "",
    replies: object.replies || "",
    followers: object.followers || "",
    following: object.following || "",
    likes: object.likes || "",
    shares: object.shares || "",
    startTime: object.startTime || "",
    endTime: object.endTime || "",
    to: object.to || "",
    cc: object.cc || "",
    bto: object.bto || "",
    bcc: object.bcc || "",
    audience: object.audience || "",
    latitude: object.latitude || "",
    longitude: object.longitude || "",
    preferredUsername: object.preferredUsername || "",
    "mycelia:icon": object["mycelia:icon"] || ""
  };
}
