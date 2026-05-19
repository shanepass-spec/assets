// tab-weekly-audit.js — v1.0
// Scheduled worker. Scans hallucination_log every Monday at 6:00 AM ET,
// writes a summary row to weekly_audit, exposes /audit/latest as a
// readable endpoint anyone with the URL can hit.
//
// SCHEDULE:
//   Cron: 0 11 * * 1   (Monday 11:00 UTC = 6:00 AM ET during DST,
//                       7:00 AM ET during standard time — close enough
//                       for a weekly audit. To pin exactly to ET clock
//                       time year-round, two crons would be needed.)
//
// BINDINGS:
//   env.DB → tab-website-content (97d23702-3489-47d9-a1e9-0707f34b758d)
//
// EXPANSION:
//   Today it scans only tab-website-ai catches (workers writing to
//   hallucination_log). When Jennie/Compass/Dispatch start writing to
//   the same table with their own worker_name, they'll be picked up
//   automatically — no code changes needed.

function getCORS() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

async function runAudit(env) {
  if (!env.DB) {
    throw new Error('DB binding missing');
  }

  // Window: last 7 days
  const now = new Date();
  const periodEnd = now.toISOString();
  const periodStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const auditDate = now.toISOString().slice(0, 10);

  // Pull all catches from the past 7 days
  const catchResult = await env.DB.prepare(
    `SELECT worker_name, trigger_type, action_taken, trigger_match
     FROM hallucination_log
     WHERE timestamp >= ? AND timestamp <= ?`
  ).bind(periodStart, periodEnd).all();
  const catches = catchResult.results || [];

  // Pull conversation count from the same window
  let totalConversations = 0;
  try {
    const convResult = await env.DB.prepare(
      `SELECT COUNT(*) as n FROM conversation_log
       WHERE timestamp >= ? AND timestamp <= ?`
    ).bind(periodStart, periodEnd).all();
    totalConversations = (convResult.results || [])[0]?.n || 0;
  } catch (e) {
    // conversation_log may not exist or query may fail — non-fatal
    totalConversations = 0;
  }

  // Tally
  const workersScannedSet = new Set();
  let surnamesCaught = 0;
  let phoneCaught = 0;
  let addressCaught = 0;
  let rewritesIssued = 0;
  let blocksIssued = 0;
  const matchCounts = {};

  for (const c of catches) {
    workersScannedSet.add(c.worker_name || 'unknown');
    if (c.trigger_type === 'surname') surnamesCaught++;
    if (c.trigger_type === 'phone') phoneCaught++;
    if (c.trigger_type === 'address') addressCaught++;
    if (c.action_taken === 'rewrite') rewritesIssued++;
    if (c.action_taken === 'block') blocksIssued++;
    const key = `${c.trigger_type}:${c.trigger_match}`;
    matchCounts[key] = (matchCounts[key] || 0) + 1;
  }

  const totalHallucinationsCaught = catches.length;
  const workersScanned = Array.from(workersScannedSet).join(', ') || 'tab-website-ai';

  // Build top-matches list (top 10)
  const topMatches = Object.entries(matchCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([k, n]) => `  ${k} × ${n}`)
    .join('\n') || '  (none)';

  const summaryReport = [
    `Weekly Audit — ${auditDate}`,
    `Period: ${periodStart} → ${periodEnd}`,
    ``,
    `Workers scanned: ${workersScanned}`,
    `Total conversations: ${totalConversations}`,
    `Total catches: ${totalHallucinationsCaught}`,
    `  Surnames: ${surnamesCaught} (rewritten)`,
    `  Phone numbers: ${phoneCaught} (blocked)`,
    `  Addresses: ${addressCaught} (blocked)`,
    ``,
    `Actions taken:`,
    `  Rewrites issued: ${rewritesIssued}`,
    `  Replies blocked: ${blocksIssued}`,
    ``,
    `Top recurring matches:`,
    topMatches,
  ].join('\n');

  // Lightweight recommendations
  const recParts = [];
  if (totalHallucinationsCaught === 0) {
    recParts.push('No catches this period. System healthy.');
  } else {
    if (surnamesCaught > 5) {
      recParts.push(`Surname errors trending up (${surnamesCaught}). Consider tightening the system prompt rule about Pastor Dwain's surname.`);
    }
    if (blocksIssued > 0) {
      recParts.push(`${blocksIssued} replies were fully blocked this week. Review the catches to confirm the model is being prompted correctly about phone/address.`);
    }
    if (totalConversations > 0) {
      const rate = (totalHallucinationsCaught / totalConversations) * 100;
      recParts.push(`Catch rate: ${rate.toFixed(1)}% of conversations had at least one catch.`);
    }
  }
  const recommendations = recParts.join('\n');

  // Write the audit row
  await env.DB.prepare(
    `INSERT INTO weekly_audit
     (audit_date, period_start, period_end, workers_scanned,
      total_conversations, total_hallucinations_caught,
      surnames_caught, phone_caught, address_caught,
      blocks_issued, rewrites_issued, summary_report, recommendations)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    auditDate, periodStart, periodEnd, workersScanned,
    totalConversations, totalHallucinationsCaught,
    surnamesCaught, phoneCaught, addressCaught,
    blocksIssued, rewritesIssued, summaryReport, recommendations
  ).run();

  return {
    audit_date: auditDate,
    period_start: periodStart,
    period_end: periodEnd,
    workers_scanned: workersScanned,
    total_conversations: totalConversations,
    total_hallucinations_caught: totalHallucinationsCaught,
    surnames_caught: surnamesCaught,
    phone_caught: phoneCaught,
    address_caught: addressCaught,
    blocks_issued: blocksIssued,
    rewrites_issued: rewritesIssued,
    summary_report: summaryReport,
    recommendations,
  };
}

async function buildAuditHTML(env) {
  let row = null;
  let recentCatches = [];
  try {
    const r = await env.DB.prepare(
      'SELECT * FROM weekly_audit ORDER BY audit_date DESC LIMIT 1'
    ).all();
    row = (r.results || [])[0] || null;

    const c = await env.DB.prepare(
      `SELECT timestamp, trigger_type, trigger_match, action_taken, user_question
       FROM hallucination_log
       ORDER BY timestamp DESC LIMIT 20`
    ).all();
    recentCatches = c.results || [];
  } catch (e) {
    return new Response(`<html><body><h1>Audit Error</h1><p>${e.message}</p></body></html>`,
      { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  const esc = (s) => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  let auditHTML;
  if (!row) {
    auditHTML = '<div class="empty">No weekly audit has run yet. The first audit will run on Monday at 6:00 AM ET.</div>';
  } else {
    auditHTML = `
      <div class="card">
        <h2>Weekly Audit — ${esc(row.audit_date)}</h2>
        <div class="grid">
          <div><strong>Workers scanned:</strong> ${esc(row.workers_scanned)}</div>
          <div><strong>Conversations:</strong> ${esc(row.total_conversations)}</div>
          <div><strong>Total catches:</strong> ${esc(row.total_hallucinations_caught)}</div>
          <div><strong>Surnames:</strong> ${esc(row.surnames_caught)}</div>
          <div><strong>Phone:</strong> ${esc(row.phone_caught)}</div>
          <div><strong>Address:</strong> ${esc(row.address_caught)}</div>
          <div><strong>Rewrites:</strong> ${esc(row.rewrites_issued)}</div>
          <div><strong>Blocks:</strong> ${esc(row.blocks_issued)}</div>
        </div>
        <h3>Summary</h3>
        <pre>${esc(row.summary_report)}</pre>
        ${row.recommendations ? `<h3>Recommendations</h3><pre>${esc(row.recommendations)}</pre>` : ''}
      </div>`;
  }

  const catchesHTML = recentCatches.length === 0
    ? '<div class="empty">No catches logged yet.</div>'
    : recentCatches.map(c => `
        <div class="catch">
          <div class="meta">
            <span class="ts">${esc(c.timestamp)}</span>
            <span class="tag tag-${esc(c.trigger_type)}">${esc(c.trigger_type)}</span>
            <span class="tag tag-${esc(c.action_taken)}">${esc(c.action_taken)}</span>
            <span class="match">match: "${esc(c.trigger_match)}"</span>
          </div>
          <div class="q">Q: ${esc(c.user_question)}</div>
        </div>
      `).join('');

  return new Response(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Tab Hallucination Audit</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;background:#fbf8f4;color:#1a202c;padding:24px;max-width:900px;margin:0 auto;line-height:1.5}
h1{color:#402020;border-bottom:3px solid #402020;padding-bottom:8px}
h2{color:#402020;margin-top:0}
h3{color:#402020;margin-top:20px;margin-bottom:8px}
.card{background:white;border-radius:12px;padding:20px;margin-bottom:24px;box-shadow:0 1px 4px rgba(0,0,0,0.06)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;margin:8px 0}
.empty{text-align:center;padding:40px;color:#718096;background:white;border-radius:12px;margin-bottom:20px}
.catch{background:white;border-radius:8px;padding:12px;margin-bottom:10px;box-shadow:0 1px 3px rgba(0,0,0,0.05)}
.meta{font-size:12px;color:#718096;margin-bottom:6px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.ts{font-family:monospace}
.tag{padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;background:#e5ddd5;color:#402020}
.tag-surname{background:#fef3c7;color:#92400e}
.tag-phone{background:#fee2e2;color:#991b1b}
.tag-address{background:#fee2e2;color:#991b1b}
.tag-rewrite{background:#dbeafe;color:#1e40af}
.tag-block{background:#fecaca;color:#7f1d1d}
.match{font-family:monospace;font-size:12px;color:#402020}
.q{font-size:13px;color:#1a202c;margin-top:6px}
pre{background:#f8f4ee;border-radius:6px;padding:12px;font-size:13px;white-space:pre-wrap;word-wrap:break-word}
</style></head><body>
<h1>Tab Hallucination Audit</h1>
${auditHTML}
<h2>Recent Catches (last 20)</h2>
${catchesHTML}
</body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8', ...getCORS() } });
}

export default {
  // Cron trigger entry point
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runAudit(env));
  },

  // HTTP entry point for /audit/latest and manual /run
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: getCORS() });
    }

    if (path === '/audit/latest' || path === '/') {
      return await buildAuditHTML(env);
    }

    // Manual trigger — secured by ?token=<env.ADMIN_TOKEN>
    if (path === '/run') {
      const token = url.searchParams.get('token') || '';
      const expected = env.ADMIN_TOKEN || 'tab-admin-2026';
      if (token !== expected) {
        return new Response(JSON.stringify({ error: 'unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...getCORS() }
        });
      }
      try {
        const result = await runAudit(env);
        return new Response(JSON.stringify({ ok: true, result }, null, 2), {
          headers: { 'Content-Type': 'application/json', ...getCORS() }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...getCORS() }
        });
      }
    }

    if (path === '/health') {
      return new Response(JSON.stringify({
        ok: true,
        service: 'tab-weekly-audit',
        version: 'v1.0',
        db: !!env.DB,
      }, null, 2), {
        headers: { 'Content-Type': 'application/json', ...getCORS() }
      });
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...getCORS() }
    });
  }
};
