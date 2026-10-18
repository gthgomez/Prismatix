// scripts/reconcile-jobs.mjs
// Durable maintenance worker and cleanup utility for prismatix_internal.reconciliation_jobs.
// Accesses internal tables strictly through service-role-only RPCs (no direct PostgREST schema exposure).
//
// Usage:
//   node scripts/reconcile-jobs.mjs [--dry-run] [--limit 50] [--max-attempts 3] [--purge-days 30]

import { createClient } from '@supabase/supabase-js';

export async function processReconciliationBatch(supabase, options = {}) {
  const {
    dryRun = false,
    limit = 50,
    maxAttempts = 3,
    purgeDays = 30,
    logger = console,
  } = options;

  const summary = {
    scanned: 0,
    processed: 0,
    failed: 0,
    purged: 0,
  };

  // 1. Fetch pending jobs via service-role RPC
  let pendingJobs = [];
  if (typeof supabase?.rpc === 'function') {
    const { data: jobs, error: fetchErr } = await supabase.rpc('px03_get_pending_reconciliation_jobs', {
      p_limit: limit,
    });
    if (fetchErr) {
      logger.error?.('[reconcile-jobs] Failed to query pending jobs via px03_get_pending_reconciliation_jobs:', fetchErr.message);
      throw fetchErr;
    }
    pendingJobs = jobs ?? [];
  } else {
    logger.warn?.('[reconcile-jobs] supabase.rpc is not available.');
    return summary;
  }

  summary.scanned = pendingJobs?.length ?? 0;
  logger.log?.(`[reconcile-jobs] Found ${summary.scanned} pending reconciliation job(s).`);

  const updateJob = async (jobId, status, attempts, errorMsg = null) => {
    const { data, error } = await supabase.rpc('px03_update_reconciliation_job', {
      p_job_id: jobId,
      p_status: status,
      p_attempts: attempts,
      p_error: errorMsg,
    });
    if (error) {
      logger.error?.(`[reconcile-jobs] Failed to update job ${jobId} to ${status}:`, error.message);
      throw error;
    }
    return data;
  };

  const isTerminalExecution = (status) =>
    status === 'completed' || status === 'cancelled' || status === 'failed' || status === 'indeterminate';

  // 2. Process each pending job
  for (const job of pendingJobs ?? []) {
    const attempts = (job.attempts ?? 0) + 1;
    logger.log?.(`[reconcile-jobs] Inspecting job ${job.id} (kind: ${job.kind}, execution: ${job.execution_id})`);

    if (dryRun) {
      logger.log?.(`[reconcile-jobs] [DRY RUN] Would reconcile job ${job.id}`);
      summary.processed++;
      continue;
    }

    try {
      // Fetch target execution, reservation, and calls status via service-role RPC
      const { data: target, error: inspectErr } = await supabase.rpc('px03_inspect_reconciliation_target', {
        p_execution_id: job.execution_id,
      });

      if (inspectErr) {
        throw new Error(`inspect_target_failed: ${inspectErr.message}`);
      }

      if (!target || !target.execution) {
        logger.warn?.(`[reconcile-jobs] Target execution ${job.execution_id} not found.`);
        const status = attempts >= maxAttempts ? 'failed' : 'pending';
        await updateJob(job.id, status, attempts, 'execution_not_found');
        if (status === 'failed') summary.failed++;
        continue;
      }

      const execution = target.execution;
      const reservation = target.reservation;

      if (job.kind === 'receipt_projection_failed') {
        if (isTerminalExecution(execution.status)) {
          await updateJob(job.id, 'done', attempts);
          summary.processed++;
        } else {
          const status = attempts >= maxAttempts ? 'failed' : 'pending';
          await updateJob(job.id, status, attempts, 'execution_unsettled');
          if (status === 'failed') summary.failed++;
        }
      } else if (job.kind === 'budget_estimated') {
        // budget_estimated must remain pending until all relevant billable calls have authoritative settlement
        if (target.pending_calls > 0) {
          logger.log?.(`[reconcile-jobs] Execution ${job.execution_id} still has ${target.pending_calls} pending call(s); keeping job pending.`);
          const status = attempts >= maxAttempts ? 'failed' : 'pending';
          await updateJob(job.id, status, attempts, 'calls_still_pending');
          if (status === 'failed') summary.failed++;
          continue;
        }

        // All calls settled: commit reservation from ledger
        const { data: commitResult, error: commitErr } = await supabase.rpc('px05_commit_from_ledger', {
          p_execution_id: job.execution_id,
        });

        if (commitErr) {
          throw new Error(`commit_from_ledger_failed: ${commitErr.message}`);
        }

        const resState = commitResult?.state;
        if (resState !== 'committed' && resState !== 'released') {
          // Did not reach terminal settlement
          const status = attempts >= maxAttempts ? 'failed' : 'pending';
          await updateJob(job.id, status, attempts, `unresolved_reservation_state: ${resState}`);
          if (status === 'failed') summary.failed++;
          continue;
        }

        const authoritativeCost = Number(commitResult?.committed_usd ?? 0);
        const safeCost = Number.isFinite(authoritativeCost) ? authoritativeCost : 0;
        const costStatus = resState === 'committed' ? 'settled' : 'released';

        // Synchronize public.cost_logs projection
        const { data: existingCostLog, error: queryCostErr } = await supabase
          .from('cost_logs')
          .select('id')
          .eq('idempotency_key', job.execution_id)
          .maybeSingle();

        if (queryCostErr) {
          throw new Error(`cost_logs_query_failed: ${queryCostErr.message}`);
        }

        if (existingCostLog) {
          const { error: updateCostErr } = await supabase
            .from('cost_logs')
            .update({
              total_cost: safeCost,
              cost_status: costStatus === 'released' ? 'settled' : costStatus,
            })
            .eq('idempotency_key', job.execution_id);
          if (updateCostErr) throw new Error(`cost_logs_update_failed: ${updateCostErr.message}`);
        } else {
          // Recreate missing projection row
          const { error: insertCostErr } = await supabase
            .from('cost_logs')
            .insert({
              idempotency_key: job.execution_id,
              user_id: execution.subject_id,
              conversation_id: execution.conversation_id,
              model: execution.resolved_model ?? execution.requested_model ?? 'auto',
              provider: execution.served_model ? execution.served_model.split(':')[0] : 'opencode',
              total_cost: safeCost,
              cost_status: costStatus === 'released' ? 'settled' : costStatus,
            });
          if (insertCostErr) throw new Error(`cost_logs_insert_failed: ${insertCostErr.message}`);
        }

        await updateJob(job.id, 'done', attempts);
        summary.processed++;
      } else if (job.kind === 'admission_settlement_failed') {
        // Verify the actual reservation state: must verify actual reservation reached terminal state
        let isSettled = reservation?.state === 'committed' || reservation?.state === 'released';

        if (!isSettled && target.pending_calls === 0) {
          const { data: commitResult, error: commitErr } = await supabase.rpc('px05_commit_from_ledger', {
            p_execution_id: job.execution_id,
          });
          if (!commitErr && (commitResult?.state === 'committed' || commitResult?.state === 'released')) {
            isSettled = true;
          }
        }

        if (isSettled) {
          await updateJob(job.id, 'done', attempts);
          summary.processed++;
        } else {
          const status = attempts >= maxAttempts ? 'failed' : 'pending';
          await updateJob(job.id, status, attempts, 'reservation_unsettled');
          if (status === 'failed') summary.failed++;
        }
      } else if (job.kind === 'cost_projection_failed') {
        // Recreate or update missing projection
        const authoritativeCost = Number(reservation?.committed_usd ?? target.settled_cost ?? 0);
        const safeCost = Number.isFinite(authoritativeCost) ? authoritativeCost : 0;

        const { data: existingCostLog, error: queryCostErr } = await supabase
          .from('cost_logs')
          .select('id')
          .eq('idempotency_key', job.execution_id)
          .maybeSingle();

        if (queryCostErr) {
          throw new Error(`cost_logs_query_failed: ${queryCostErr.message}`);
        }

        if (existingCostLog) {
          const { error: updateCostErr } = await supabase
            .from('cost_logs')
            .update({
              total_cost: safeCost,
              cost_status: 'settled',
            })
            .eq('idempotency_key', job.execution_id);
          if (updateCostErr) throw new Error(`cost_logs_update_failed: ${updateCostErr.message}`);
        } else {
          const { error: insertCostErr } = await supabase
            .from('cost_logs')
            .insert({
              idempotency_key: job.execution_id,
              user_id: execution.subject_id,
              conversation_id: execution.conversation_id,
              model: job.payload?.model ?? execution.resolved_model ?? execution.requested_model ?? 'auto',
              provider: execution.served_model ? execution.served_model.split(':')[0] : 'opencode',
              total_cost: safeCost,
              cost_status: 'settled',
            });
          if (insertCostErr) throw new Error(`cost_logs_insert_failed: ${insertCostErr.message}`);
        }

        await updateJob(job.id, 'done', attempts);
        summary.processed++;
      } else if (job.kind === 'budget_breached' || job.kind === 'refund_lease' || job.kind === 'assistant_transcript_conflict' || job.kind === 'assistant_transcript_failed') {
        await updateJob(job.id, 'done', attempts);
        summary.processed++;
      } else {
        const status = attempts >= maxAttempts ? 'failed' : 'pending';
        await updateJob(job.id, status, attempts, `unknown_reconciliation_kind: ${job.kind}`);
        if (status === 'failed') summary.failed++;
      }
    } catch (jobErr) {
      logger.error?.(`[reconcile-jobs] Error reconciling job ${job.id}:`, jobErr);
      const status = attempts >= maxAttempts ? 'failed' : 'pending';
      try {
        await updateJob(job.id, status, attempts, String(jobErr?.message ?? jobErr));
      } catch {
        // Best-effort error recording
      }
      if (status === 'failed') summary.failed++;
    }
  }

  // 3. Purge aged terminal jobs if purgeDays configured
  if (purgeDays > 0 && !dryRun && typeof supabase.rpc === 'function') {
    try {
      const { data: purgedCount, error: purgeErr } = await supabase.rpc('px03_purge_reconciliation_jobs', {
        p_purge_days: purgeDays,
      });
      if (!purgeErr && typeof purgedCount === 'number') {
        summary.purged = purgedCount;
        if (summary.purged > 0) {
          logger.log?.(`[reconcile-jobs] Purged ${summary.purged} completed/failed job(s) older than ${purgeDays} days.`);
        }
      }
    } catch (purgeErr) {
      logger.warn?.('[reconcile-jobs] Purge RPC failed:', purgeErr);
    }
  }

  return summary;
}

// CLI Execution entrypoint
if (process.argv[1] && process.argv[1].endsWith('reconcile-jobs.mjs')) {
  const isDryRun = process.argv.includes('--dry-run');
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.warn('[reconcile-jobs] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be provided for live reconciliation.');
    console.log('[reconcile-jobs] Dry-run demonstration mode.');
    process.exit(0);
  }

  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  processReconciliationBatch(client, { dryRun: isDryRun })
    .then((summary) => {
      console.log('[reconcile-jobs] Completed batch execution:', summary);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[reconcile-jobs] Unhandled batch failure:', err);
      process.exit(1);
    });
}
