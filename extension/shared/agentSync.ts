export const AGENTS_SYNC_MAX_ITEMS = 64;
export const AGENTS_SYNC_MAX_JSON_BYTES = 300_000;

export interface SanitizedAgentsSnapshot {
  json: string;
  count: number;
}

function parseRawAgents(input: unknown): unknown[] | null {
  if (Array.isArray(input)) return input;
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function sanitizeAgentRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

export function sanitizeAgentsSnapshot(input: unknown): SanitizedAgentsSnapshot | null {
  const parsed = parseRawAgents(input);
  if (!parsed) return null;

  const tail = parsed.slice(-AGENTS_SYNC_MAX_ITEMS);
  const normalized: Record<string, unknown>[] = [];
  for (const row of tail) {
    const record = sanitizeAgentRecord(row);
    if (record) normalized.push(record);
  }

  const json = JSON.stringify(normalized);
  if (json.length > AGENTS_SYNC_MAX_JSON_BYTES) return null;
  return { json, count: normalized.length };
}

export function emptyAgentsSnapshot(): SanitizedAgentsSnapshot {
  return { json: "[]", count: 0 };
}
