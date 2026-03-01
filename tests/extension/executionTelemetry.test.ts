import { describe, expect, it } from "vitest";
import {
  aggregateExecutionTelemetryEvents,
  type ExecutionTelemetryEvent,
} from "../../extension/tx/executionTelemetry";

function makeEvent(
  overrides: Partial<ExecutionTelemetryEvent> = {},
): ExecutionTelemetryEvent {
  return {
    id: `evt_${Math.random().toString(36).slice(2, 8)}`,
    runId: "run_default",
    channel: "manual",
    stage: "build",
    status: "ok",
    ts: Date.now(),
    network: "mainnet",
    txId: null,
    txState: null,
    backendSource: null,
    backendReason: null,
    backendEndpoint: null,
    error: null,
    context: {},
    ...overrides,
  };
}

describe("execution telemetry aggregation", () => {
  it("aggregates by channel + stage and enforces window filtering", () => {
    const now = 1_700_000_000_000;
    const events: ExecutionTelemetryEvent[] = [
      makeEvent({ id: "1", runId: "run_a", channel: "manual", stage: "build", status: "ok", ts: now - 20_000 }),
      makeEvent({ id: "2", runId: "run_a", channel: "manual", stage: "validate", status: "ok", ts: now - 18_000 }),
      makeEvent({ id: "3", runId: "run_a", channel: "manual", stage: "sign", status: "failed", ts: now - 16_000 }),
      makeEvent({ id: "4", runId: "run_b", channel: "swap", stage: "build", status: "ok", ts: now - 14_000 }),
      makeEvent({ id: "5", runId: "run_b", channel: "swap", stage: "validate", status: "ok", ts: now - 12_000 }),
      makeEvent({ id: "6", runId: "run_b", channel: "swap", stage: "sign", status: "ok", ts: now - 10_000 }),
      makeEvent({ id: "7", runId: "run_b", channel: "swap", stage: "broadcast", status: "ok", ts: now - 8_000 }),
      makeEvent({ id: "8", runId: "run_b", channel: "swap", stage: "reconcile", status: "ok", ts: now - 6_000 }),
      makeEvent({ id: "old", runId: "run_old", channel: "agent", stage: "build", status: "failed", ts: now - 120_000 }),
    ];

    const summary = aggregateExecutionTelemetryEvents(events, {
      nowTs: now,
      windowMs: 60_000,
      sloTargetPct: 80,
      sloMinSamples: 1,
    });

    expect(summary.totalEvents).toBe(8);
    expect(summary.uniqueRuns).toBe(2);
    expect(summary.overall.ok).toBe(7);
    expect(summary.overall.failed).toBe(1);
    expect(summary.byChannel.manual.total).toBe(3);
    expect(summary.byChannel.manual.failed).toBe(1);
    expect(summary.byChannel.swap.total).toBe(5);
    expect(summary.byStage.sign.total).toBe(2);
    expect(summary.byStage.sign.failed).toBe(1);
    expect(summary.byChannelStage.manual.sign.failed).toBe(1);
    expect(summary.byChannelStage.swap.reconcile.ok).toBe(1);
    expect(summary.sloEligible).toBe(true);
    expect(summary.sloMet).toBe(true);
  });

  it("marks SLO miss when success rate is below target with enough samples", () => {
    const now = 1_700_000_000_000;
    const events: ExecutionTelemetryEvent[] = [];
    for (let i = 0; i < 9; i += 1) {
      events.push(makeEvent({
        id: `ok_${i}`,
        runId: "run_ok",
        channel: "manual",
        stage: "reconcile",
        status: "ok",
        ts: now - (i * 500),
      }));
    }
    events.push(makeEvent({
      id: "fail_1",
      runId: "run_fail",
      channel: "manual",
      stage: "reconcile",
      status: "failed",
      ts: now - 100,
    }));

    const summary = aggregateExecutionTelemetryEvents(events, {
      nowTs: now,
      windowMs: 60_000,
      sloTargetPct: 95,
      sloMinSamples: 5,
    });

    expect(summary.totalEvents).toBe(10);
    expect(summary.overall.successRatePct).toBeLessThan(95);
    expect(summary.sloEligible).toBe(true);
    expect(summary.sloMet).toBe(false);
  });

  it("marks SLO as ineligible when sample floor is not reached", () => {
    const now = 1_700_000_000_000;
    const events: ExecutionTelemetryEvent[] = [
      makeEvent({ id: "single", runId: "run_1", channel: "agent", stage: "build", status: "ok", ts: now - 500 }),
    ];

    const summary = aggregateExecutionTelemetryEvents(events, {
      nowTs: now,
      windowMs: 60_000,
      sloTargetPct: 99,
      sloMinSamples: 10,
    });

    expect(summary.totalEvents).toBe(1);
    expect(summary.sloEligible).toBe(false);
    expect(summary.sloMet).toBe(false);
  });
});
