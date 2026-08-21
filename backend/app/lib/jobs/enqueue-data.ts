/**
 * Normalize fields whose old schemas remain accepted only for restart
 * compatibility. Conversation chunk creation is deterministic grouping and
 * must never inherit or persist inference routing metadata.
 */
export function sanitizeEnqueueData<T extends Record<string, any>>(data: T): T {
  if (data.type !== "conversation_chunk_creator") return data;
  const sanitized = { ...data };
  delete sanitized.model;
  delete sanitized.fallbackModel;
  delete sanitized.providerProfileId;
  delete sanitized.routingContext;
  return sanitized;
}
