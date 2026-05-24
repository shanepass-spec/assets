// tab-email-ingest.js v1.2 — deployed to church account
// v1.2 changes from v1.1:
//   - Cross-account D1 support: if env.DB binding is not present, the worker
//     uses Cloudflare's HTTP API (env.CF_API_TOKEN + CF_ACCOUNT_ID + D1_DATABASE_ID).
//     Lets this worker run in the church account while writing to D1 in personal.
// v1.1 changes from v1.0:
//   - Replaced homegrown PDF text extractor (failed on compressed streams)
//     with Claude's native PDF document support. PDF is fetched, base64
//     encoded, and sent directly to Claude as a document attachment.
//   - All other logic unchanged: D1 writes, YouTube matching, dedup,
//     status lifecycle, logging.
// Receives weekly Constant Contact emails at ai-ingest@tabsarasota.org,
// extracts the Sunday Outline PDF, parses it with Claude, matches it to
// the YouTube sermon via tab-sermons, and writes a clean row into the
// tab-website-content D1 database used by tab-website-ai.
//
// SCOPE (locked):
//   - Outline PDF only (skip devotions, prayer list, email body)
//   - Theological fidelity: Pastor Dwain + Tab pulpit only
//   - Additive to tab-website-ai — no changes to its code
//   - Dedupe by pdf_url and (sermon_date + title)
//   - status lifecycle: complete | preview | superseded
//
// SECRETS REQUIRED (set in dashboard):
//   - ANTHROPIC_API_KEY (same key as tab-website-ai)
//   - ADMIN_TOKEN       (same token as tab-website-ai, default tab-admin-2026)
//
// BINDINGS REQUIRED (set in dashboard):
//   - DB         → tab-website-content (D1 database)
//   - SERMONS    → tab-sermons (Service binding, optional but recommended)
//
// VARIABLES (set in dashboard, optional):
//   - ALLOWED_SENDERS  → comma-separated list of allowed From addresses
//                        default: rlaferriere@thetabsarasota.org
//
// ENDPOINTS:
//   email (default)       → Email Worker entrypoint, called by Email Routing
//   GET  /health          → status check
//   GET  /admin/log       → last 50 ingest events (HTML, admin auth)
//   POST /admin/test      → manually trigger a parse on a PDF URL (admin auth)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function isAdminAuthed(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = env.ADMIN_TOKEN || 'tab-admin-2026';
  return auth === `Bearer ${token}`;
}

// ─── Email parsing ─────────────────────────────────────────────────────

// Read raw MIME email body from the ReadableStream Cloudflare provides.
async function readEmailRaw(message) {
  const reader = message.raw.getReader();
  const chunks = [];
  let totalLen = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalLen += value.byteLength;
    // Safety cap: stop reading after 5 MB to avoid runaway
    if (totalLen > 5 * 1024 * 1024) break;
  }
  const merged = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(merged);
}

// Find the Outline PDF link inside the raw email. Constant Contact
// uses "Outline" as the anchor text (per spec from prior thread).
// We look for any URL whose anchor text contains "outline" (case-insensitive)
// and prefer files.constantcontact.com PDF URLs.
function findOutlinePdfUrl(rawEmail) {
  if (!rawEmail) return null;

  // First pass: anchor-text match "Outline" → href
  // Constant Contact uses <a href="...">Outline</a> patterns (HTML part)
  const anchorRe = /<a\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*>\s*([^<]+?)\s*<\/a>/gi;
  let match;
  const candidates = [];
  while ((match = anchorRe.exec(rawEmail)) !== null) {
    const href = match[1];
    const text = (match[2] || '').toLowerCase().trim();
    if (text === 'outline' || text.includes('outline for')) {
      candidates.push(href);
    }
  }

  // Prefer constantcontact.com PDF links
  const ccPdf = candidates.find(u => /constantcontact\.com.*\.pdf/i.test(u));
  if (ccPdf) return cleanUrl(ccPdf);
  if (candidates.length > 0) return cleanUrl(candidates[0]);

  // Fallback: any constantcontact PDF URL in the body
  const pdfRe = /https?:\/\/[^\s"'<>]*files\.constantcontact\.com[^\s"'<>]*\.pdf/gi;
  const pdfMatch = rawEmail.match(pdfRe);
  if (pdfMatch && pdfMatch.length > 0) return cleanUrl(pdfMatch[0]);

  return null;
}

function cleanUrl(url) {
  if (!url) return url;
  // Decode entities Constant Contact sometimes inserts
  return url
    .replace(/&amp;/g, '&')
    .replace(/&#x2F;/g, '/')
    .replace(/&#x3D;/g, '=')
    .trim();
}

function getHeader(rawEmail, headerName) {
  // Headers live above the first blank line. Headers can fold across lines
  // (continuation lines begin with whitespace). We grab the headers block,
  // unfold, then look up.
  const blankIdx = rawEmail.search(/\r?\n\r?\n/);
  const headerBlock = blankIdx === -1 ? rawEmail : rawEmail.slice(0, blankIdx);
  const unfolded = headerBlock.replace(/\r?\n[ \t]+/g, ' ');
  const re = new RegExp('^' + headerName + ':\\s*(.+)$', 'im');
  const m = unfolded.match(re);
  return m ? m[1].trim() : '';
}

function extractSenderEmail(fromHeader) {
  if (!fromHeader) return '';
  // Forms: "Name <addr@x>" or "addr@x"
  const angle = fromHeader.match(/<([^>]+)>/);
  if (angle) return angle[1].trim().toLowerCase();
  const bare = fromHeader.match(/[\w.+-]+@[\w.-]+/);
  return bare ? bare[0].trim().toLowerCase() : '';
}

// ─── PDF fetch + base64 encode ─────────────────────────────────────────
//
// We send the raw PDF to Claude directly using Anthropic's native PDF
// document support. No homegrown parsing — Claude reads the PDF natively
// (including compressed streams, embedded fonts, multi-column layouts).

async function fetchPdf(pdfUrl) {
  const res = await fetch(pdfUrl, {
    headers: { 'User-Agent': 'tab-email-ingest/1.0' },
  });
  if (!res.ok) throw new Error(`PDF fetch failed: ${res.status}`);
  return await res.arrayBuffer();
}

// Convert ArrayBuffer → base64 string. Workers don't have Buffer; we
// use btoa with a binary string built in chunks to avoid stack overflow
// on large PDFs.
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000; // 32KB
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

// ─── Claude parsing ────────────────────────────────────────────────────

async function parseOutlineWithClaude(env, pdfBytes, emailSubject) {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');

  const pdfBase64 = arrayBufferToBase64(pdfBytes);

  const systemPrompt = `You are a parser for The Tabernacle Church's weekly sermon outline PDFs.

Your job: read the raw PDF text and extract structured sermon entries.

A typical PDF contains TWO sermons:
  - "Complete" — the previous Sunday's sermon (fully outlined)
  - "Preview" — next Sunday's sermon (often just title + scripture, may be blank)

Return JSON only, no preamble, no markdown fences. Schema:

{
  "sermons": [
    {
      "title": "string",
      "sermon_date": "YYYY-MM-DD",
      "scripture": "string or empty",
      "outline_text": "the full outline body as plain text",
      "status": "complete" | "preview",
      "pastor": "string, default Dwain Kitchens"
    }
  ]
}

Rules:
- ALWAYS attribute to "Dwain Kitchens" unless the PDF explicitly names another Tab pulpit pastor.
- If preview section has no body, still emit the entry with whatever title/scripture is shown and outline_text empty.
- sermon_date is the Sunday the sermon was/will be preached. Infer from the PDF context (heading, date stamp, etc.).
- Keep outline_text faithful to the source — preserve point order, numbering, scripture refs.
- Strip page numbers, headers, footers, and Constant Contact boilerplate.
- If you cannot find any sermon content at all, return { "sermons": [] }.`;

  const userContent = [
    {
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: pdfBase64,
      },
    },
    {
      type: 'text',
      text: `Email subject: ${emailSubject}\n\nParse this PDF into the JSON schema described in the system prompt. Return JSON only.`,
    },
  ];

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Claude API ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data.content?.[0]?.text || '';
  const clean = text.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(clean);
  } catch (e) {
    throw new Error('Claude returned non-JSON: ' + clean.slice(0, 200));
  }
}

// ─── YouTube match via tab-sermons ─────────────────────────────────────

async function findYouTubeMatch(env, sermon) {
  if (!sermon || !sermon.title) return null;

  try {
    // Prefer Service binding if available
    let recentRes;
    if (env.SERMONS && typeof env.SERMONS.fetch === 'function') {
      recentRes = await env.SERMONS.fetch('https://tab-sermons.internal/recent?n=15');
    } else {
      recentRes = await fetch('https://tab-sermons.shanepass.workers.dev/recent?n=15');
    }
    if (!recentRes.ok) return null;
    const recentData = await recentRes.json();
    const sermons = recentData.sermons || [];
    if (sermons.length === 0) return null;

    // Match strategy: title contains the sermon date (DD.MM.YY format),
    // or title fuzzy-matches the sermon title.
    const normalize = (s) => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    const sermonTitleNorm = normalize(sermon.title);
    const sermonDate = sermon.sermon_date || '';

    // Date format expected in YouTube titles: "Tab@Home | DD.MM.YY | Title"
    let dateToken = '';
    if (sermonDate) {
      const dm = sermonDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (dm) {
        const [_, y, mo, d] = dm;
        dateToken = `${d}.${mo}.${y.slice(2)}`;
      }
    }

    // 1) Try exact date-token match
    if (dateToken) {
      for (const v of sermons) {
        if ((v.title || '').includes(dateToken)) {
          return { url: v.url, videoTitle: v.title, matchMethod: 'date_token' };
        }
      }
    }

    // 2) Try title fuzzy match
    for (const v of sermons) {
      const vTitleNorm = normalize(v.title);
      if (sermonTitleNorm && vTitleNorm.includes(sermonTitleNorm)) {
        return { url: v.url, videoTitle: v.title, matchMethod: 'title_substring' };
      }
    }

    // 3) Try /search for the sermon title
    let searchRes;
    const searchPath = `/search?q=${encodeURIComponent(sermon.title)}`;
    if (env.SERMONS && typeof env.SERMONS.fetch === 'function') {
      searchRes = await env.SERMONS.fetch(`https://tab-sermons.internal${searchPath}`);
    } else {
      searchRes = await fetch(`https://tab-sermons.shanepass.workers.dev${searchPath}`);
    }
    if (searchRes.ok) {
      const searchData = await searchRes.json();
      const top = (searchData.sermons || [])[0];
      if (top && top.url && typeof top.score === 'number' && top.score >= 0.7) {
        return { url: top.url, videoTitle: top.title, matchMethod: 'semantic_search' };
      }
    }
  } catch (e) {
    console.error('YouTube match failed:', e.message);
  }
  return null;
}

// ─── D1 access (binding OR Cloudflare HTTP API for cross-account) ──────
//
// When env.DB is present (same account as the D1), use binding directly.
// Otherwise, use the Cloudflare HTTP API. This lets the worker run in
// either account (personal or church) without code changes.

function hasDirectDB(env) {
  return env.DB && typeof env.DB.prepare === 'function';
}

function hasCfApi(env) {
  return !!(env.CF_API_TOKEN && env.CF_ACCOUNT_ID && env.D1_DATABASE_ID);
}

// Mimics env.DB.prepare(sql).bind(...args).all() / .run()
function d1(env) {
  if (hasDirectDB(env)) {
    return env.DB;
  }
  if (!hasCfApi(env)) {
    throw new Error('No D1 access: set DB binding OR set CF_API_TOKEN + CF_ACCOUNT_ID + D1_DATABASE_ID');
  }
  return {
    prepare(sql) {
      let params = [];
      return {
        bind(...args) {
          params = args;
          return this;
        },
        async all() {
          return await d1HttpQuery(env, sql, params);
        },
        async run() {
          return await d1HttpQuery(env, sql, params);
        },
      };
    },
  };
}

async function d1HttpQuery(env, sql, params) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/d1/database/${env.D1_DATABASE_ID}/query`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.CF_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql, params: params.map(p => p === null || p === undefined ? null : p) }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`D1 HTTP API ${res.status}: ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  if (!data.success) {
    throw new Error(`D1 HTTP API error: ${JSON.stringify(data.errors || data)}`);
  }
  // Cloudflare returns { result: [{ results: [...], success, meta }] }
  const firstResult = (data.result || [])[0] || {};
  return {
    results: firstResult.results || [],
    success: firstResult.success !== false,
    meta: firstResult.meta || {},
  };
}

// ─── D1 write ──────────────────────────────────────────────────────────

async function ensureLogTable(env) {
  await d1(env).prepare(`
    CREATE TABLE IF NOT EXISTS email_ingest_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
      sender TEXT,
      subject TEXT,
      pdf_url TEXT,
      sermons_found INTEGER,
      sermons_inserted INTEGER,
      sermons_updated INTEGER,
      sermons_skipped INTEGER,
      youtube_matches INTEGER,
      error TEXT,
      raw_summary TEXT
    )
  `).run();
}

async function logIngest(env, data) {
  try {
    await ensureLogTable(env);
    await d1(env).prepare(`
      INSERT INTO email_ingest_log
      (sender, subject, pdf_url, sermons_found, sermons_inserted,
       sermons_updated, sermons_skipped, youtube_matches, error, raw_summary)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      data.sender || '',
      data.subject || '',
      data.pdf_url || '',
      data.sermons_found || 0,
      data.sermons_inserted || 0,
      data.sermons_updated || 0,
      data.sermons_skipped || 0,
      data.youtube_matches || 0,
      data.error || null,
      data.raw_summary || null
    ).run();
  } catch (e) {
    console.error('logIngest failed:', e.message);
  }
}

async function writeSermonsToD1(env, sermons, pdfUrl) {
  let inserted = 0, updated = 0, skipped = 0, youtubeMatches = 0;

  for (const s of sermons) {
    if (!s.title) { skipped++; continue; }

    const title = `Sunday Outline – ${s.sermon_date || 'unknown'} – ${s.title}`;
    const body = buildSermonBody(s);
    const status = s.status === 'preview' ? 'preview' : 'complete';

    // Match YouTube video if this is a complete sermon
    let youtubeUrl = null;
    if (status === 'complete') {
      const yt = await findYouTubeMatch(env, s);
      if (yt && yt.url) {
        youtubeUrl = yt.url;
        youtubeMatches++;
      }
    }

    // Dedupe: look for existing row by sermon_date + title
    let existing = null;
    try {
      const existingResult = await d1(env).prepare(`
        SELECT id, status FROM content
        WHERE category = 'outline'
          AND title = ?
        LIMIT 1
      `).bind(title).all();
      existing = (existingResult.results || [])[0] || null;
    } catch (e) {
      console.error('dedupe lookup failed:', e.message);
    }

    if (existing) {
      // If existing is preview and new is complete, supersede the preview
      // by updating in place to the complete version
      await d1(env).prepare(`
        UPDATE content
        SET body = ?, status = ?, youtube_url = ?, language = 'en',
            active = 1, source = 'weekly_outline', updated_at = datetime('now')
        WHERE id = ?
      `).bind(body, status, youtubeUrl, existing.id).run();
      updated++;
    } else {
      await d1(env).prepare(`
        INSERT INTO content
        (category, title, body, source, language, active, status, youtube_url)
        VALUES ('outline', ?, ?, 'weekly_outline', 'en', 1, ?, ?)
      `).bind(title, body, status, youtubeUrl).run();
      inserted++;
    }

    // When we insert a "complete" sermon, mark any older "preview" entries
    // for the same date as superseded (defensive cleanup)
    if (status === 'complete' && s.sermon_date) {
      try {
        await d1(env).prepare(`
          UPDATE content
          SET status = 'superseded', updated_at = datetime('now')
          WHERE category = 'outline'
            AND status = 'preview'
            AND title LIKE ?
            AND title != ?
        `).bind(`Sunday Outline – ${s.sermon_date} –%`, title).run();
      } catch (e) {
        console.error('supersede preview failed:', e.message);
      }
    }
  }

  return { inserted, updated, skipped, youtubeMatches };
}

function buildSermonBody(s) {
  const lines = [];
  if (s.scripture) lines.push(`Scripture: ${s.scripture}`);
  if (s.pastor) lines.push(`Pastor: ${s.pastor}`);
  if (s.sermon_date) lines.push(`Date: ${s.sermon_date}`);
  lines.push('');
  if (s.outline_text) lines.push(s.outline_text);
  return lines.join('\n').trim();
}

// ─── Sender check ──────────────────────────────────────────────────────

function isAllowedSender(sender, env) {
  if (!sender) return false;
  const allowed = (env.ALLOWED_SENDERS || 'rlaferriere@thetabsarasota.org')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  return allowed.some(a => sender === a || sender.endsWith('@' + a));
}

// ─── Main ingest pipeline ──────────────────────────────────────────────

async function processIncomingEmail(message, env) {
  const summary = {
    sender: '',
    subject: '',
    pdf_url: '',
    sermons_found: 0,
    sermons_inserted: 0,
    sermons_updated: 0,
    sermons_skipped: 0,
    youtube_matches: 0,
    error: null,
    raw_summary: null,
  };

  try {
    const raw = await readEmailRaw(message);

    const fromHeader = getHeader(raw, 'From');
    const sender = extractSenderEmail(fromHeader);
    const subject = getHeader(raw, 'Subject');
    summary.sender = sender;
    summary.subject = subject;

    // Sender lockdown (light — the address only exists in Constant Contact)
    if (!isAllowedSender(sender, env)) {
      summary.error = `Sender not in allowlist: ${sender}`;
      await logIngest(env, summary);
      return summary;
    }

    const pdfUrl = findOutlinePdfUrl(raw);
    if (!pdfUrl) {
      summary.error = 'No Outline PDF link found in email';
      await logIngest(env, summary);
      return summary;
    }
    summary.pdf_url = pdfUrl;

    const pdfBytes = await fetchPdf(pdfUrl);

    if (!pdfBytes || pdfBytes.byteLength < 500) {
      summary.error = `PDF fetch returned ${pdfBytes ? pdfBytes.byteLength : 0} bytes (too small)`;
      await logIngest(env, summary);
      return summary;
    }

    const parsed = await parseOutlineWithClaude(env, pdfBytes, subject);
    const sermons = parsed.sermons || [];
    summary.sermons_found = sermons.length;

    if (sermons.length === 0) {
      summary.error = 'Claude returned zero sermons from PDF';
      await logIngest(env, summary);
      return summary;
    }

    const writeResult = await writeSermonsToD1(env, sermons, pdfUrl);
    summary.sermons_inserted = writeResult.inserted;
    summary.sermons_updated = writeResult.updated;
    summary.sermons_skipped = writeResult.skipped;
    summary.youtube_matches = writeResult.youtubeMatches;
    summary.raw_summary = sermons.map(s =>
      `${s.status}: ${s.title} (${s.sermon_date || 'no date'})`
    ).join(' | ');

    await logIngest(env, summary);
    return summary;
  } catch (e) {
    summary.error = e.message;
    try { await logIngest(env, summary); } catch (_) {}
    return summary;
  }
}

// ─── Admin log HTML ────────────────────────────────────────────────────

async function buildLogHTML(env) {
  let rows = [];
  try {
    await ensureLogTable(env);
    const result = await d1(env).prepare(`
      SELECT * FROM email_ingest_log ORDER BY timestamp DESC LIMIT 50
    `).all();
    rows = result.results || [];
  } catch (e) {
    return new Response(`<h1>Log error</h1><p>${e.message}</p>`,
      { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  const rowsHTML = rows.length === 0
    ? '<div class="empty">No ingest events yet.</div>'
    : rows.map(r => `
      <div class="row ${r.error ? 'err' : 'ok'}">
        <div class="meta">
          <span class="ts">${esc(r.timestamp)}</span>
          <span class="tag">${esc(r.sender)}</span>
          ${r.error ? '<span class="tag tag-err">ERROR</span>' : '<span class="tag tag-ok">OK</span>'}
        </div>
        <div class="subj"><strong>Subject:</strong> ${esc(r.subject)}</div>
        ${r.pdf_url ? `<div class="pdf"><strong>PDF:</strong> <a href="${esc(r.pdf_url)}" target="_blank">${esc(r.pdf_url)}</a></div>` : ''}
        <div class="stats">Found: ${r.sermons_found} · Inserted: ${r.sermons_inserted} · Updated: ${r.sermons_updated} · Skipped: ${r.sermons_skipped} · YouTube matches: ${r.youtube_matches}</div>
        ${r.error ? `<div class="errbox">${esc(r.error)}</div>` : ''}
        ${r.raw_summary ? `<div class="summary">${esc(r.raw_summary)}</div>` : ''}
      </div>
    `).join('');

  return new Response(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Tab Email Ingest — Log</title>
<style>
body{font-family:system-ui,sans-serif;background:#fbf8f4;color:#1a202c;padding:24px;max-width:900px;margin:0 auto;line-height:1.5}
h1{color:#402020;border-bottom:3px solid #402020;padding-bottom:8px}
.row{background:white;border-radius:10px;padding:14px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,0.06)}
.row.err{border-left:4px solid #dc2626}
.row.ok{border-left:4px solid #15803d}
.meta{font-size:12px;color:#718096;margin-bottom:6px;display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.ts{font-family:monospace}
.tag{padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;background:#e5ddd5;color:#402020}
.tag-err{background:#fee2e2;color:#991b1b}
.tag-ok{background:#dcfce7;color:#166534}
.subj{font-size:14px;margin:4px 0}
.pdf{font-size:12px;margin:4px 0}
.pdf a{color:#402020}
.stats{font-size:12px;color:#555;margin-top:6px}
.errbox{background:#fef2f2;color:#991b1b;border-radius:6px;padding:8px 10px;margin-top:6px;font-size:13px}
.summary{background:#f8f4ee;border-radius:6px;padding:8px 10px;margin-top:6px;font-size:12px;color:#402020}
.empty{text-align:center;padding:60px;color:#718096;background:white;border-radius:12px}
</style></head><body>
<h1>Email Ingest Log</h1>
<p style="color:#718096;font-size:13px">Last 50 ingest events. Newest first.</p>
${rowsHTML}
</body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

// ─── Worker handlers ───────────────────────────────────────────────────

export default {
  // HTTP endpoints (health, admin log, admin test)
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'OPTIONS') return new Response(null, { headers: CORS });

    if (path === '/health') {
      return json({
        ok: true,
        service: 'tab-email-ingest',
        version: 'v1.2',
        pdf_mode: 'claude-native',
        db_mode: hasDirectDB(env) ? 'binding' : (hasCfApi(env) ? 'cf-api' : 'NONE'),
        db: hasDirectDB(env) || hasCfApi(env),
        sermons_binding: !!(env.SERMONS && typeof env.SERMONS.fetch === 'function'),
        anthropic_key: !!env.ANTHROPIC_API_KEY,
      });
    }

    if (path === '/admin/log' && method === 'GET') {
      // Allow either bearer auth header OR ?token=... in URL for browser convenience
      const tokenParam = url.searchParams.get('token');
      const expected = env.ADMIN_TOKEN || 'tab-admin-2026';
      if (!isAdminAuthed(request, env) && tokenParam !== expected) {
        return json({ error: 'Unauthorized' }, 401);
      }
      return await buildLogHTML(env);
    }

    if (path === '/admin/test' && method === 'POST') {
      if (!isAdminAuthed(request, env)) return json({ error: 'Unauthorized' }, 401);
      try {
        const body = await request.json();
        const { pdf_url, subject = 'manual test' } = body;
        if (!pdf_url) return json({ error: 'pdf_url required' }, 400);
        const pdfBytes = await fetchPdf(pdf_url);
        if (!pdfBytes || pdfBytes.byteLength < 500) {
          return json({ ok: false, error: `PDF too small (${pdfBytes ? pdfBytes.byteLength : 0} bytes)` });
        }
        const parsed = await parseOutlineWithClaude(env, pdfBytes, subject);
        const sermons = parsed.sermons || [];
        const writeResult = await writeSermonsToD1(env, sermons, pdf_url);
        await logIngest(env, {
          sender: 'manual-test',
          subject,
          pdf_url,
          sermons_found: sermons.length,
          sermons_inserted: writeResult.inserted,
          sermons_updated: writeResult.updated,
          sermons_skipped: writeResult.skipped,
          youtube_matches: writeResult.youtubeMatches,
          raw_summary: sermons.map(s => `${s.status}: ${s.title} (${s.sermon_date || 'no date'})`).join(' | '),
        });
        return json({ ok: true, sermons_found: sermons.length, ...writeResult, sermons });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }

    return json({ error: 'Not found', path }, 404);
  },

  // Email Worker entrypoint — Email Routing calls this
  async email(message, env, ctx) {
    ctx.waitUntil(processIncomingEmail(message, env));
  },
};
