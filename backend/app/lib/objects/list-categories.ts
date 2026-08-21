export const OBJECT_LIST_CATEGORIES = [
  "person",
  "event",
  "relationship",
  "promise",
  "conversation",
  "tag",
  "place",
  "organization",
  "product",
  "project",
  "animal",
  "concept",
  "media",
  "other",
] as const;

export type ObjectListCategory = typeof OBJECT_LIST_CATEGORIES[number];

export const OBJECT_LIST_TYPE_FLAGS: ReadonlyArray<
  readonly [flag: string, category: Exclude<ObjectListCategory, "other">]
> = [
  ["isPerson", "person"],
  ["isEvent", "event"],
  ["isRelationship", "relationship"],
  ["isPromise", "promise"],
  ["isConversation", "conversation"],
  ["isTag", "tag"],
  ["isPlace", "place"],
  ["isOrganization", "organization"],
  ["isProduct", "product"],
  ["isProject", "project"],
  ["isAnimal", "animal"],
  ["isConcept", "concept"],
  ["isMedia", "media"],
];

/**
 * Materialized browse-section membership. This intentionally differs from a
 * display type: multi-flag objects belong to every matching section.
 */
export function deriveObjectListCategories(
  doc: Record<string, unknown>,
): ObjectListCategory[] {
  const categories: ObjectListCategory[] = [];
  let hasAnyTypeFlag = false;

  for (const [flag, category] of OBJECT_LIST_TYPE_FLAGS) {
    if (doc[flag] !== true) continue;
    hasAnyTypeFlag = true;
    if (
      category === "relationship" &&
      (doc.isPromise === true || doc.isTag === true)
    ) {
      continue;
    }
    categories.push(category);
  }

  if (!hasAnyTypeFlag) categories.push("other");
  return categories;
}

export function deriveEntityTypingPending(
  doc: Record<string, unknown>,
): boolean {
  const name = typeof doc.name === "string" ? doc.name.trim() : "";
  if (!name) return false;
  if (OBJECT_LIST_TYPE_FLAGS.some(([flag]) => flag in doc)) return false;
  const metadata = doc.metadata as Record<string, any> | undefined;
  return metadata?.aiProvenance?.entityTyping == null;
}

export function withObjectListCategories<T extends Record<string, unknown>>(
  doc: T,
): T & {
  _listCategories: ObjectListCategory[];
  _entityTypingPending: boolean;
} {
  return {
    ...doc,
    _listCategories: deriveObjectListCategories(doc),
    _entityTypingPending: deriveEntityTypingPending(doc),
  };
}

export function legacyObjectListMatch(
  category: ObjectListCategory,
): Record<string, unknown> {
  if (category === "other") {
    return Object.fromEntries(
      OBJECT_LIST_TYPE_FLAGS.map(([flag]) => [flag, { $ne: true }]),
    );
  }

  if (category === "relationship") {
    return {
      isRelationship: true,
      isPromise: { $ne: true },
      isTag: { $ne: true },
    };
  }

  const flag = OBJECT_LIST_TYPE_FLAGS.find(([, value]) => value === category)
    ?.[0];
  if (!flag) throw new Error(`Unknown object list category: ${category}`);
  return { [flag]: true };
}
