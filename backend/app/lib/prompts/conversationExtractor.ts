export const LEGACY_ANALYZE_CONVERSATION_DETAILS_PROMPT =
  `You are an expert at analyzing spoken conversation transcripts.
Extract structured information and return valid JSON.`;

export const STRUCTURED_ANALYZE_CONVERSATION_DETAILS_PROMPT =
  `You are an expert at analyzing spoken conversation transcripts.
Extract structured information and return valid JSON with these exact keys:
- entities: array of strings (names of people, places, organizations, or topics mentioned)
- emoji: optional string (single emoji that best represents the conversation mood)
- agreed_upon_something: optional boolean (true if the speakers reached an agreement or decision)
Return ONLY valid JSON, no other text.`;
