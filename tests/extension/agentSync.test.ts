import { describe, expect, it } from "vitest";

import {
  AGENTS_SYNC_MAX_ITEMS,
  emptyAgentsSnapshot,
  sanitizeAgentsSnapshot,
} from "../../extension/shared/agentSync";

describe("agentSync sanitizeAgentsSnapshot", () => {
  it("accepts array input and returns serialized snapshot", () => {
    const snapshot = sanitizeAgentsSnapshot([
      { agentId: "a1", name: "One" },
      { agentId: "a2", name: "Two" },
    ]);

    expect(snapshot).not.toBeNull();
    expect(snapshot?.count).toBe(2);
    expect(JSON.parse(snapshot?.json || "[]")).toHaveLength(2);
  });

  it("accepts json string input", () => {
    const snapshot = sanitizeAgentsSnapshot('[{"agentId":"x1"}]');
    expect(snapshot?.count).toBe(1);
  });

  it("drops non-object records", () => {
    const snapshot = sanitizeAgentsSnapshot([1, "bad", null, { agentId: "ok" }]);
    expect(snapshot?.count).toBe(1);
    expect(JSON.parse(snapshot?.json || "[]")[0].agentId).toBe("ok");
  });

  it("caps list length to max items", () => {
    const oversized = Array.from({ length: AGENTS_SYNC_MAX_ITEMS + 10 }, (_, i) => ({ agentId: `a${i}` }));
    const snapshot = sanitizeAgentsSnapshot(oversized);
    expect(snapshot?.count).toBe(AGENTS_SYNC_MAX_ITEMS);
    const decoded = JSON.parse(snapshot?.json || "[]");
    expect(decoded).toHaveLength(AGENTS_SYNC_MAX_ITEMS);
    expect(decoded[0].agentId).toBe("a10");
  });

  it("returns null for invalid json", () => {
    expect(sanitizeAgentsSnapshot("{bad_json")).toBeNull();
  });

  it("returns empty snapshot helper", () => {
    const snapshot = emptyAgentsSnapshot();
    expect(snapshot.count).toBe(0);
    expect(snapshot.json).toBe("[]");
  });
});
