import {
  executeKaspaIntent,
  type ExecuteKaspaIntentOptions,
  type KaspaExecutionIntent,
} from "./kernel";
import { createExecutionRunId } from "./executionTelemetry";
import type { PendingTx } from "./types";

export interface AgentExecutionIntent extends KaspaExecutionIntent {
  agentId: string;
  executionRunId?: string;
  context?: Record<string, unknown>;
}

type ExecuteKaspaIntentFn = typeof executeKaspaIntent;

export function createAgentExecutionDispatcher(executeIntent: ExecuteKaspaIntentFn = executeKaspaIntent) {
  return async function dispatchAgentKaspaIntent(
    intent: AgentExecutionIntent,
    options: Omit<ExecuteKaspaIntentOptions, "telemetry"> = {},
  ): Promise<PendingTx> {
    const runId = String(intent.executionRunId || "").trim() || createExecutionRunId(`agent_${intent.agentId}`);
    return executeIntent(
      {
        fromAddress: intent.fromAddress,
        network: intent.network,
        recipients: intent.recipients,
        agentJobId: intent.agentJobId,
        opReturnHex: intent.opReturnHex,
      },
      {
        ...options,
        telemetry: {
          channel: "agent",
          runId,
          context: {
            agentId: intent.agentId,
            agentJobId: intent.agentJobId || null,
            ...(intent.context || {}),
          },
        },
      },
    );
  };
}

export const dispatchAgentKaspaIntent = createAgentExecutionDispatcher();

