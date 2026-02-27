import { describe, expect, it } from "vitest";
import {
  countOriginRequests,
  dropRequestsForTab,
  emptyPendingRequestState,
  enqueueConnectRequest,
  enqueueSignRequest,
  normalizePendingRequestState,
  pendingRequestCount,
  pruneExpiredRequests,
  requestOriginKey,
  resolveActiveConnectRequest,
  resolveActiveSignRequest,
} from "../../extension/background/pendingRequests";

describe("pendingRequests queue model", () => {
  const now = 1_730_000_000_000;

  it("promotes first connect request to active and queues the rest", () => {
    let state = emptyPendingRequestState();
    state = enqueueConnectRequest(state, { requestId: "c1", tabId: 1, origin: "https://a.example", createdAt: now });
    state = enqueueConnectRequest(state, { requestId: "c2", tabId: 2, origin: "https://b.example", createdAt: now + 1 });
    state = enqueueConnectRequest(state, { requestId: "c3", tabId: 3, origin: "https://c.example", createdAt: now + 2 });

    expect(state.activeConnect?.requestId).toBe("c1");
    expect(state.connectQueue.map((r) => r.requestId)).toEqual(["c2", "c3"]);
    expect(pendingRequestCount(state)).toBe(3);
  });

  it("promotes next connect request on resolve and rejects stale approve/reject IDs", () => {
    let state = emptyPendingRequestState();
    state = enqueueConnectRequest(state, { requestId: "c1", tabId: 1, createdAt: now });
    state = enqueueConnectRequest(state, { requestId: "c2", tabId: 2, createdAt: now + 1 });

    const stale = resolveActiveConnectRequest(state, "other");
    expect(stale.stale).toBe(true);
    expect(stale.state.activeConnect?.requestId).toBe("c1");

    const resolved = resolveActiveConnectRequest(state, "c1");
    expect(resolved.stale).toBe(false);
    expect(resolved.resolved?.requestId).toBe("c1");
    expect(resolved.state.activeConnect?.requestId).toBe("c2");
    expect(resolved.state.connectQueue).toEqual([]);
  });

  it("tracks connect + sign queues independently and resolves in FIFO order", () => {
    let state = emptyPendingRequestState();
    state = enqueueSignRequest(state, { requestId: "s1", tabId: 1, message: "m1", createdAt: now });
    state = enqueueSignRequest(state, { requestId: "s2", tabId: 1, message: "m2", createdAt: now + 1 });
    state = enqueueConnectRequest(state, { requestId: "c1", tabId: 2, createdAt: now + 2 });

    expect(state.activeSign?.requestId).toBe("s1");
    expect(state.signQueue.map((r) => r.requestId)).toEqual(["s2"]);
    expect(state.activeConnect?.requestId).toBe("c1");
    expect(pendingRequestCount(state)).toBe(3);

    const signResolved = resolveActiveSignRequest(state, "s1");
    expect(signResolved.resolved?.requestId).toBe("s1");
    expect(signResolved.state.activeSign?.requestId).toBe("s2");

    const connectResolved = resolveActiveConnectRequest(signResolved.state, "c1");
    expect(connectResolved.resolved?.requestId).toBe("c1");
    expect(connectResolved.state.activeConnect).toBeNull();
  });

  it("normalizes malformed stored state into safe defaults", () => {
    const state = normalizePendingRequestState({
      activeConnect: { requestId: 123, tabId: "bad" },
      activeSign: { requestId: "s1", tabId: 2 },
      connectQueue: [{ requestId: "c1", tabId: 1, createdAt: now }, { requestId: "", tabId: 2 }],
      signQueue: [{ requestId: "s2", tabId: 3, message: "ok", createdAt: now + 1 }, { requestId: "s3", tabId: 4 }],
    }, now + 100);

    expect(state.activeConnect?.requestId).toBe("c1");
    expect(state.activeSign?.requestId).toBe("s2");
    expect(state.activeConnect?.createdAt).toBe(now);
    expect(state.activeSign?.createdAt).toBe(now + 1);
    expect(state.connectQueue).toEqual([]);
    expect(state.signQueue).toEqual([]);
  });

  it("counts per-origin requests across active + queued + connect/sign", () => {
    let state = emptyPendingRequestState();
    state = enqueueConnectRequest(state, { requestId: "c1", tabId: 1, origin: "https://forge-os.xyz", createdAt: now });
    state = enqueueConnectRequest(state, { requestId: "c2", tabId: 1, origin: "https://forge-os.xyz", createdAt: now + 1 });
    state = enqueueSignRequest(state, { requestId: "s1", tabId: 1, origin: "https://forge-os.xyz", message: "sig", createdAt: now + 2 });
    state = enqueueSignRequest(state, { requestId: "s2", tabId: 1, origin: "https://other.xyz", message: "sig", createdAt: now + 3 });

    expect(countOriginRequests(state, requestOriginKey("https://forge-os.xyz"))).toBe(3);
    expect(countOriginRequests(state, requestOriginKey("https://other.xyz"))).toBe(1);
    expect(countOriginRequests(state, requestOriginKey(undefined))).toBe(0);
  });

  it("prunes expired requests and promotes next valid queue item", () => {
    const state = normalizePendingRequestState({
      activeConnect: { requestId: "c-old", tabId: 1, createdAt: now - 5_000 },
      activeSign: { requestId: "s-keep", tabId: 2, message: "ok", createdAt: now - 500 },
      connectQueue: [{ requestId: "c-keep", tabId: 3, createdAt: now - 200 }],
      signQueue: [{ requestId: "s-old", tabId: 4, message: "old", createdAt: now - 5_000 }],
    }, now);

    const pruned = pruneExpiredRequests(state, now, 1_000);
    expect(pruned.expiredConnect.map((r) => r.requestId)).toEqual(["c-old"]);
    expect(pruned.expiredSign.map((r) => r.requestId)).toEqual(["s-old"]);
    expect(pruned.state.activeConnect?.requestId).toBe("c-keep");
    expect(pruned.state.activeSign?.requestId).toBe("s-keep");
    expect(pruned.state.connectQueue).toEqual([]);
    expect(pruned.state.signQueue).toEqual([]);
  });

  it("drops active + queued requests for a closed tab and promotes next item", () => {
    const state = normalizePendingRequestState({
      activeConnect: { requestId: "c1", tabId: 11, createdAt: now },
      activeSign: { requestId: "s1", tabId: 22, message: "ok", createdAt: now },
      connectQueue: [
        { requestId: "c2", tabId: 11, createdAt: now + 1 },
        { requestId: "c3", tabId: 33, createdAt: now + 2 },
      ],
      signQueue: [
        { requestId: "s2", tabId: 11, message: "old", createdAt: now + 3 },
        { requestId: "s3", tabId: 44, message: "ok", createdAt: now + 4 },
      ],
    }, now);

    const dropped = dropRequestsForTab(state, 11);
    expect(dropped.removedConnect.map((r) => r.requestId)).toEqual(["c1", "c2"]);
    expect(dropped.removedSign.map((r) => r.requestId)).toEqual(["s2"]);
    expect(dropped.state.activeConnect?.requestId).toBe("c3");
    expect(dropped.state.activeSign?.requestId).toBe("s1");
    expect(dropped.state.connectQueue).toEqual([]);
    expect(dropped.state.signQueue.map((r) => r.requestId)).toEqual(["s3"]);
  });
});
