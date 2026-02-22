import { AUDIT_HASH_ALGO, hashCanonical } from "./runQuantEngineAudit";
import { RUN_QUANT_ENGINE_CONFIG as CFG } from "./runQuantEngineConfig";
import { maybeAttachCryptographicAuditSignature } from "./runQuantEngineAuditSigner";
import { buildQuantFeatureSnapshot, buildQuantFeatureSnapshotExcerpt } from "./runQuantEnginePromptSnapshot";

async function attachDecisionAuditRecord(params: {
  decision: any;
  agent: any;
  kasData: any;
  quantCoreDecision: any;
  overlayPlanReason: string;
  enginePath: string;
  sanitizeDecision: (raw: any, agent: any) => any;
}) {
  const decision = params.decision || {};
  const quantSnapshot = buildQuantFeatureSnapshot(params.agent, params.kasData, params.quantCoreDecision);
  const quantFeatureSnapshotHash = await hashCanonical(quantSnapshot);
  const decisionForHash = {
    ...decision,
    audit_record: undefined,
  };
  const decisionHash = await hashCanonical(decisionForHash);
  const auditSig = await hashCanonical({
    decision_hash: decisionHash,
    quant_feature_snapshot_hash: quantFeatureSnapshotHash,
    prompt_version: CFG.aiPromptVersion,
    ai_response_schema_version: CFG.aiResponseSchemaVersion,
    overlay_plan_reason: params.overlayPlanReason,
    engine_path: params.enginePath,
  });
  return params.sanitizeDecision(
    {
      ...decision,
      audit_record: {
        audit_record_version: CFG.decisionAuditRecordVersion,
        hash_algo: AUDIT_HASH_ALGO,
        prompt_version: CFG.aiPromptVersion,
        ai_response_schema_version: CFG.aiResponseSchemaVersion,
        quant_feature_snapshot_hash: quantFeatureSnapshotHash,
        decision_hash: decisionHash,
        audit_sig: auditSig,
        overlay_plan_reason: params.overlayPlanReason,
        engine_path: params.enginePath,
        prompt_used: params.enginePath === "hybrid-ai" || params.enginePath === "ai",
        ai_transport_ready: CFG.aiTransportReady,
        created_ts: Date.now(),
        quant_feature_snapshot_excerpt: buildQuantFeatureSnapshotExcerpt(params.kasData, params.quantCoreDecision),
      },
    },
    params.agent
  );
}

export async function finalizeDecisionAuditRecord(params: {
  decision: any;
  agent: any;
  kasData: any;
  quantCoreDecision: any;
  overlayPlanReason: string;
  enginePath: string;
  sanitizeDecision: (raw: any, agent: any) => any;
}) {
  const withAudit = await attachDecisionAuditRecord(params);
  return maybeAttachCryptographicAuditSignature(withAudit);
}
