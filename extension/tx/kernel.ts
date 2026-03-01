import { buildBatchTransaction, buildTransaction } from "./builder";
import { broadcastTransaction } from "./broadcast";
import { dryRunValidate } from "./dryRun";
import { signTransaction } from "./signer";
import { addPendingTx, updatePendingTx } from "./store";
import type { PendingTx } from "./types";
import { waitForKaspaConfirmation } from "./receiptReconciler";
import {
  appendExecutionTelemetryEvent,
  createExecutionRunId,
  type ExecutionTelemetryChannel,
} from "./executionTelemetry";

export type DeterministicKernelStage =
  | "build"
  | "validate"
  | "sign"
  | "broadcast"
  | "reconcile";

export interface KaspaExecutionRecipient {
  address: string;
  amountKas: number;
}

export interface KaspaExecutionIntent {
  fromAddress: string;
  network: string;
  recipients: KaspaExecutionRecipient[];
  agentJobId?: string;
  opReturnHex?: string;
}

export interface DeterministicKernelUpdate {
  stage: DeterministicKernelStage;
  tx: PendingTx;
}

export interface SignBroadcastReconcileOptions {
  awaitConfirmation?: boolean;
  confirmTimeoutMs?: number;
  confirmPollIntervalMs?: number;
  onUpdate?: (update: DeterministicKernelUpdate) => void | Promise<void>;
  telemetry?: {
    channel: ExecutionTelemetryChannel;
    runId?: string;
    context?: Record<string, unknown>;
  };
}

export interface ExecuteKaspaIntentOptions extends SignBroadcastReconcileOptions {}

export interface BuildAndValidateKaspaIntentOptions {
  onUpdate?: (update: DeterministicKernelUpdate) => void | Promise<void>;
  telemetry?: {
    channel: ExecutionTelemetryChannel;
    runId?: string;
    context?: Record<string, unknown>;
  };
}

export class DeterministicExecutionError extends Error {
  stage: DeterministicKernelStage;
  tx: PendingTx | null;
  details: string[];

  constructor(stage: DeterministicKernelStage, message: string, tx: PendingTx | null = null, details: string[] = []) {
    super(message);
    this.name = "DeterministicExecutionError";
    this.stage = stage;
    this.tx = tx;
    this.details = details;
  }
}

export interface DeterministicExecutionKernelDeps {
  buildTransaction: typeof buildTransaction;
  buildBatchTransaction: typeof buildBatchTransaction;
  dryRunValidate: typeof dryRunValidate;
  signTransaction: typeof signTransaction;
  broadcastTransaction: typeof broadcastTransaction;
  addPendingTx: typeof addPendingTx;
  updatePendingTx: typeof updatePendingTx;
  waitForKaspaConfirmation: typeof waitForKaspaConfirmation;
  appendExecutionTelemetryEvent: typeof appendExecutionTelemetryEvent;
}

const DEFAULT_DEPS: DeterministicExecutionKernelDeps = {
  buildTransaction,
  buildBatchTransaction,
  dryRunValidate,
  signTransaction,
  broadcastTransaction,
  addPendingTx,
  updatePendingTx,
  waitForKaspaConfirmation,
  appendExecutionTelemetryEvent,
};

export function createDeterministicExecutionKernel(
  deps: Partial<DeterministicExecutionKernelDeps> = {},
) {
  const d: DeterministicExecutionKernelDeps = { ...DEFAULT_DEPS, ...deps };

  const emit = async (
    cb: SignBroadcastReconcileOptions["onUpdate"],
    stage: DeterministicKernelStage,
    tx: PendingTx,
  ): Promise<void> => {
    if (!cb) return;
    await cb({ stage, tx });
  };

  const emitTelemetry = async (
    telemetry: SignBroadcastReconcileOptions["telemetry"] | undefined,
    stage: DeterministicKernelStage,
    status: "ok" | "failed",
    network: string,
    tx: PendingTx | null,
    error: string | null = null,
  ): Promise<void> => {
    if (!telemetry) return;
    try {
      await d.appendExecutionTelemetryEvent({
        runId: telemetry.runId || createExecutionRunId(telemetry.channel),
        channel: telemetry.channel,
        stage,
        status,
        network,
        tx,
        error,
        context: telemetry.context,
      });
    } catch {
      // Telemetry is best-effort and must never break execution.
    }
  };

  const normalizeBuildOptions = (
    input?: BuildAndValidateKaspaIntentOptions | ((update: DeterministicKernelUpdate) => void | Promise<void>),
  ): BuildAndValidateKaspaIntentOptions => {
    if (!input) return {};
    if (typeof input === "function") return { onUpdate: input };
    return input;
  };

  const buildAndValidateKaspaIntent = async (
    intent: KaspaExecutionIntent,
    optionsInput?: BuildAndValidateKaspaIntentOptions | ((update: DeterministicKernelUpdate) => void | Promise<void>),
  ): Promise<PendingTx> => {
    const options = normalizeBuildOptions(optionsInput);
    const telemetry = options.telemetry
      ? {
        ...options.telemetry,
        runId: options.telemetry.runId || createExecutionRunId(options.telemetry.channel),
      }
      : undefined;
    if (!intent.recipients || intent.recipients.length === 0) {
      await emitTelemetry(
        telemetry,
        "build",
        "failed",
        intent.network,
        null,
        "INTENT_EMPTY: at least one recipient is required.",
      );
      throw new DeterministicExecutionError("build", "INTENT_EMPTY: at least one recipient is required.");
    }

    let built: PendingTx;
    try {
      if (intent.recipients.length === 1) {
        const [recipient] = intent.recipients;
        built = await d.buildTransaction(
          intent.fromAddress,
          recipient.address,
          recipient.amountKas,
          intent.network,
        );
        if (intent.agentJobId || intent.opReturnHex) {
          built = {
            ...built,
            agentJobId: intent.agentJobId,
            opReturnHex: intent.opReturnHex,
          };
        }
      } else {
        built = await d.buildBatchTransaction(
          intent.fromAddress,
          intent.recipients,
          intent.network,
          { agentJobId: intent.agentJobId, opReturnHex: intent.opReturnHex },
        );
      }
      await d.addPendingTx(built);
      await emit(options.onUpdate, "build", built);
      await emitTelemetry(telemetry, "build", "ok", intent.network, built, null);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await emitTelemetry(telemetry, "build", "failed", intent.network, null, msg);
      throw new DeterministicExecutionError("build", msg, null);
    }

    let dryRun;
    try {
      dryRun = await d.dryRunValidate(built);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await emitTelemetry(telemetry, "validate", "failed", intent.network, built, msg);
      throw new DeterministicExecutionError("validate", msg, built);
    }

    if (!dryRun.valid) {
      const failed = { ...built, state: "DRY_RUN_FAIL" as const, error: dryRun.errors.join("; ") };
      await d.updatePendingTx(failed);
      await emitTelemetry(
        telemetry,
        "validate",
        "failed",
        intent.network,
        failed,
        `KERNEL_DRY_RUN_FAILED: ${dryRun.errors.join("; ")}`,
      );
      throw new DeterministicExecutionError(
        "validate",
        `KERNEL_DRY_RUN_FAILED: ${dryRun.errors.join("; ")}`,
        failed,
        dryRun.errors,
      );
    }

    const validated: PendingTx = {
      ...built,
      state: "DRY_RUN_OK",
      fee: dryRun.estimatedFee,
    };
    await d.updatePendingTx(validated);
    await emit(options.onUpdate, "validate", validated);
    await emitTelemetry(telemetry, "validate", "ok", intent.network, validated, null);
    return validated;
  };

  const signBroadcastAndReconcileKaspaTx = async (
    tx: PendingTx,
    options: SignBroadcastReconcileOptions = {},
  ): Promise<PendingTx> => {
    const awaitConfirmation = options.awaitConfirmation !== false;
    const telemetry = options.telemetry
      ? {
        ...options.telemetry,
        runId: options.telemetry.runId || createExecutionRunId(options.telemetry.channel),
      }
      : undefined;

    let signed: PendingTx;
    try {
      signed = await d.signTransaction(tx);
      await d.updatePendingTx(signed);
      await emit(options.onUpdate, "sign", signed);
      await emitTelemetry(telemetry, "sign", "ok", tx.network, signed, null);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await emitTelemetry(telemetry, "sign", "failed", tx.network, tx, msg);
      throw new DeterministicExecutionError("sign", msg, tx);
    }

    let confirming: PendingTx;
    try {
      confirming = await d.broadcastTransaction(signed);
      await d.updatePendingTx(confirming);
      await emit(options.onUpdate, "broadcast", confirming);
      await emitTelemetry(telemetry, "broadcast", "ok", tx.network, confirming, null);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await emitTelemetry(telemetry, "broadcast", "failed", tx.network, signed, msg);
      throw new DeterministicExecutionError("broadcast", msg, signed);
    }

    if (!awaitConfirmation) {
      await emitTelemetry(telemetry, "reconcile", "ok", tx.network, confirming, null);
      return confirming;
    }

    try {
      let probeAttempts = 0;
      const reconciled = await d.waitForKaspaConfirmation(confirming, {
        timeoutMs: options.confirmTimeoutMs,
        pollIntervalMs: options.confirmPollIntervalMs,
        onProbe: async (probe) => {
          probeAttempts += 1;
          const pendingProbeUpdate: PendingTx = {
            ...confirming,
            receiptCheckedAt: probe.checkedAt,
            receiptProbeAttempts: probeAttempts,
            receiptSourceBackend: probe.backend.source,
            receiptSourceReason: probe.backend.reason,
            receiptSourceEndpoint: probe.backend.activeEndpoint,
            acceptingBlockHash: probe.acceptingBlockHash,
          };
          await d.updatePendingTx(pendingProbeUpdate);
          await emit(options.onUpdate, "reconcile", pendingProbeUpdate);
        },
      });
      await d.updatePendingTx(reconciled);
      await emit(options.onUpdate, "reconcile", reconciled);
      if (reconciled.state === "FAILED") {
        await emitTelemetry(
          telemetry,
          "reconcile",
          "failed",
          tx.network,
          reconciled,
          reconciled.error || "Receipt reconciliation failed.",
        );
        throw new DeterministicExecutionError(
          "reconcile",
          reconciled.error || "Receipt reconciliation failed.",
          reconciled,
        );
      }
      await emitTelemetry(telemetry, "reconcile", "ok", tx.network, reconciled, null);
      return reconciled;
    } catch (error) {
      if (error instanceof DeterministicExecutionError) throw error;
      const msg = error instanceof Error ? error.message : String(error);
      await emitTelemetry(telemetry, "reconcile", "failed", tx.network, confirming, msg);
      throw new DeterministicExecutionError("reconcile", msg, confirming);
    }
  };

  const executeKaspaIntent = async (
    intent: KaspaExecutionIntent,
    options: ExecuteKaspaIntentOptions = {},
  ): Promise<PendingTx> => {
    const validated = await buildAndValidateKaspaIntent(intent, {
      onUpdate: options.onUpdate,
      telemetry: options.telemetry,
    });
    return signBroadcastAndReconcileKaspaTx(validated, options);
  };

  return {
    buildAndValidateKaspaIntent,
    signBroadcastAndReconcileKaspaTx,
    executeKaspaIntent,
  };
}

const kernel = createDeterministicExecutionKernel();

export const buildAndValidateKaspaIntent = kernel.buildAndValidateKaspaIntent;
export const signBroadcastAndReconcileKaspaTx = kernel.signBroadcastAndReconcileKaspaTx;
export const executeKaspaIntent = kernel.executeKaspaIntent;
