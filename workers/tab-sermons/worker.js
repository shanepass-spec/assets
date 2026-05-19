// tab-sermons.js v4 — Privacy filtering: dead/private/unlisted videos excluded
// Channel: @MyTabChurch (UCMpQ5cEbos-oiQEUrRgzg0g)
//
// v4 changes from v3:
//   FIX: Catalog refresh now fetches privacyStatus for every video and only
//        keeps videos that are public AND have an embeddable/playable status.
//        Private, unlisted, deleted, and rejected videos are filtered out
//        BEFORE they get into the catalog or embedded into Vectorize.
//
//   This means Tab Assistant will never recommend a dead/unavailable sermon
//   because such sermons aren't searchable in the first place.
//
//   Implementation: After fetching playlistItems, batch the videoIds and
//   call YouTube's videos.list endpoint (max 50 IDs per call) with
//   part=status to get privacyStatus + uploadStatus. Filter to
//   privacyStatus='public' AND uploadStatus='processed'.
//
//   PRESERVED: all v3 behavior (KV catalog, Vectorize semantic search,
//   transcript ingestion, admin endpoints, scheduled cron refresh).
//
//   /health response now includes "filters_dead_videos: true" flag.
//   /count response now includes filtering stats from last refresh.

const EMBEDDING_MODEL = '@cf/baai/bge-base-en-v1.5';
const EMBED_BATCH_SIZE = 10;
const YT_VIDEOS_BATCH_SIZE = 50; // YouTube videos.list max IDs per call

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getCORS(request) {
  const origin = request ? (request.headers.get('Origin') || '*') : '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function json(data, status = 200, request = null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...getCORS(request), 'Content-Type': 'application/json' },
  });
}

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function isAdminAuthed(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = env.ADMIN_TOKEN || 'tab-admin-2026';
  return auth === `Bearer ${token}`;
}

// ─── Transcript parsing ───────────────────────────────────────────────────────

function cleanTranscript(raw) {
  if (!raw) return '';
  let text = raw.trim();
  text = text.replace(/^WEBVTT.*?\n/, '');
  text = text.replace(/\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[.,]\d{3}.*$/gm, '');
  text = text.replace(/^\d+$/gm, '');
  text = text.replace(/<\/?c[^>]*>/g, '');
  text = text.replace(/<\d{2}:\d{2}:\d{2}[.,]\d{3}>/g, '');
  text = text.replace(/\n{2,}/g, '\n');
  text = text.replace(/[ \t]+/g, ' ');
  text = text.trim();
  return text;
}

// ─── YouTube catalog refresh ──────────────────────────────────────────────────

async function getUploadsPlaylistId(channelId, apiKey) {
  const url = `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${channelId}&key=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`YouTube channels API error: ${res.status}`);
  const data = await res.json();
  const playlistId = data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!playlistId) throw new Error('Could not find uploads playlist for channel');
  return playlistId;
}

async function fetchAllPlaylistItems(playlistId, apiKey) {
  const all = [];
  let pageToken = '';
  let safetyStop = 0;

  while (safetyStop < 50) {
    const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&maxResults=50&playlistId=${playlistId}&key=${apiKey}${pageToken ? '&pageToken=' + pageToken : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`YouTube playlistItems error: ${res.status}`);
    const data = await res.json();

    for (const item of (data.items || [])) {
      const videoId = item.contentDetails?.videoId;
      const snippet = item.snippet || {};
      if (!videoId) continue;
      all.push({
        videoId,
        title: snippet.title || '',
        description: snippet.description || '',
        publishedAt: snippet.publishedAt || '',
        thumbnail: snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url || '',
        url: `https://www.youtube.com/watch?v=${videoId}`,
      });
    }

    pageToken = data.nextPageToken || '';
    if (!pageToken) break;
    safetyStop += 1;
  }

  return all;
}

// v4: NEW — Fetch privacyStatus and uploadStatus for a list of video IDs.
// YouTube's videos.list endpoint accepts up to 50 IDs per call. We batch.
// Returns a Map<videoId, { privacyStatus, uploadStatus }>.
async function fetchVideoStatuses(videoIds, apiKey) {
  const statusMap = new Map();
  if (!videoIds || videoIds.length === 0) return statusMap;

  for (let i = 0; i < videoIds.length; i += YT_VIDEOS_BATCH_SIZE) {
    const batch = videoIds.slice(i, i + YT_VIDEOS_BATCH_SIZE);
    const idsParam = batch.join(',');
    const url = `https://www.googleapis.com/youtube/v3/videos?part=status&id=${idsParam}&maxResults=50&key=${apiKey}`;

    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.error(`videos.list batch ${i} failed: ${res.status}`);
        // On error, mark these videos as unknown — they'll be filtered out by being absent from the map
        continue;
      }
      const data = await res.json();
      for (const item of (data.items || [])) {
        if (item.id && item.status) {
          statusMap.set(item.id, {
            privacyStatus: item.status.privacyStatus || 'unknown',
            uploadStatus: item.status.uploadStatus || 'unknown',
          });
        }
      }
    } catch (e) {
      console.error(`videos.list batch ${i} threw: ${e.message}`);
      // continue — videos missing from map will be filtered out
    }
  }

  return statusMap;
}

// v4: NEW — Filter sermons to only public, processed videos.
// Returns { keep, drop } so the refresh stats can show what was filtered.
function filterPublicSermons(sermons, statusMap) {
  const keep = [];
  const drop = [];

  for (const s of sermons) {
    const status = statusMap.get(s.videoId);

    if (!status) {
      // Video not in API response — usually means deleted, removed, or unavailable
      drop.push({ videoId: s.videoId, title: s.title, reason: 'not_in_api_response' });
      continue;
    }

    if (status.privacyStatus !== 'public') {
      drop.push({
        videoId: s.videoId,
        title: s.title,
        reason: `privacyStatus=${status.privacyStatus}`,
      });
      continue;
    }

    if (status.uploadStatus !== 'processed') {
      drop.push({
        videoId: s.videoId,
        title: s.title,
        reason: `uploadStatus=${status.uploadStatus}`,
      });
      continue;
    }

    keep.push(s);
  }

  return { keep, drop };
}

// ─── Embeddings ───────────────────────────────────────────────────────────────

async function buildEmbedTextWithTranscript(env, sermon) {
  const desc = (sermon.description || '').slice(0, 1500);
  let parts = [sermon.title, desc];
  try {
    const transcript = await env.SERMONS_KV.get(`transcript-${sermon.videoId}`);
    if (transcript) {
      parts.push(transcript.slice(0, 3000));
    }
  } catch (e) { /* ignore */ }
  return parts.filter(Boolean).join('\n\n').trim();
}

async function embedTexts(env, texts) {
  const resp = await env.AI.run(EMBEDDING_MODEL, { text: texts });
  return resp.data || [];
}

async function upsertSermonsToVectorize(env, sermons) {
  let embedded = 0;
  let upserted = 0;
  let errors = 0;

  for (let i = 0; i < sermons.length; i += EMBED_BATCH_SIZE) {
    const batch = sermons.slice(i, i + EMBED_BATCH_SIZE);
    const texts = [];
    for (const s of batch) {
      texts.push(await buildEmbedTextWithTranscript(env, s));
    }

    try {
      const vectors = await embedTexts(env, texts);
      if (!Array.isArray(vectors) || vectors.length !== batch.length) {
        errors += batch.length;
        continue;
      }

      const toUpsert = [];
      for (let idx = 0; idx < batch.length; idx++) {
        const sermon = batch[idx];
        let hasTranscript = false;
        try {
          const t = await env.SERMONS_KV.get(`transcript-${sermon.videoId}`);
          hasTranscript = !!t;
        } catch (_) {}

        toUpsert.push({
          id: sermon.videoId,
          values: vectors[idx],
          metadata: {
            title: sermon.title,
            url: sermon.url,
            publishedAt: sermon.publishedAt,
            description: (sermon.description || '').slice(0, 500),
            thumbnail: sermon.thumbnail || '',
            has_transcript: hasTranscript,
          },
        });
      }

      await env.VECTORIZE.upsert(toUpsert);
      embedded += batch.length;
      upserted += batch.length;
    } catch (e) {
      console.error(`batch ${i} error:`, e.message);
      errors += batch.length;
    }
  }

  return { embedded, upserted, errors };
}

// v4: NEW — Delete vectors from Vectorize for videos that got filtered out.
// Best-effort: errors don't block the refresh.
async function deleteVectorsByIds(env, videoIds) {
  if (!videoIds || videoIds.length === 0) return { deleted: 0, errors: 0 };
  if (!env.VECTORIZE || typeof env.VECTORIZE.deleteByIds !== 'function') {
    return { deleted: 0, errors: 0, skipped: 'deleteByIds not available' };
  }
  try {
    await env.VECTORIZE.deleteByIds(videoIds);
    return { deleted: videoIds.length, errors: 0 };
  } catch (e) {
    console.error('deleteVectorsByIds failed:', e.message);
    return { deleted: 0, errors: videoIds.length, error_message: e.message };
  }
}

// ─── Search ───────────────────────────────────────────────────────────────────

async function semanticSearch(env, query, topK = 5) {
  const queryVec = await embedTexts(env, [query]);
  if (!queryVec[0]) return [];

  const matches = await env.VECTORIZE.query(queryVec[0], {
    topK,
    returnMetadata: 'all',
  });

  return (matches.matches || []).map(m => ({
    videoId: m.id,
    title: m.metadata?.title || '',
    url: m.metadata?.url || '',
    publishedAt: m.metadata?.publishedAt || '',
    description: m.metadata?.description || '',
    thumbnail: m.metadata?.thumbnail || '',
    has_transcript: !!m.metadata?.has_transcript,
    score: m.score,
  }));
}

function scoreSermon(sermon, terms) {
  const title = (sermon.title || '').toLowerCase();
  const desc = (sermon.description || '').toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (!term) continue;
    const t = term.toLowerCase();
    if (title.includes(t)) score += 3;
    if (desc.includes(t)) score += 1;
  }
  return score;
}

function keywordSearch(sermons, query) {
  if (!query) return [];
  const stopwords = new Set(['the','a','an','of','on','in','and','or','to','for','is','are','what','how','do','does','i','me','my','about','with']);
  const terms = query.toLowerCase().split(/[^a-z0-9']+/).filter(w => w && !stopwords.has(w));
  if (terms.length === 0) return [];

  return sermons
    .map(s => ({ sermon: s, score: scoreSermon(s, terms) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(x => ({ ...x.sermon, _score: x.score }));
}

// ─── Catalog storage ──────────────────────────────────────────────────────────

async function loadCatalog(env) {
  if (!env.SERMONS_KV) return null;
  try {
    const raw = await env.SERMONS_KV.get('catalog');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

async function saveCatalog(env, catalog) {
  if (!env.SERMONS_KV) throw new Error('SERMONS_KV not bound');
  await env.SERMONS_KV.put('catalog', JSON.stringify(catalog));
}

async function runRefresh(env) {
  if (!env.YT_API_KEY) throw new Error('YT_API_KEY not configured');
  const channelId = env.CHANNEL_ID || 'UCMpQ5cEbos-oiQEUrRgzg0g';

  // Step 1: Get all playlist items (raw, unfiltered)
  const playlistId = await getUploadsPlaylistId(channelId, env.YT_API_KEY);
  const allFromPlaylist = await fetchAllPlaylistItems(playlistId, env.YT_API_KEY);

  // v4 Step 2: Fetch privacy/upload status for every video
  const videoIds = allFromPlaylist.map(s => s.videoId);
  const statusMap = await fetchVideoStatuses(videoIds, env.YT_API_KEY);

  // v4 Step 3: Filter out non-public and not-fully-processed videos
  const { keep: sermons, drop } = filterPublicSermons(allFromPlaylist, statusMap);

  // Step 4: Diff against previous catalog to determine what to re-embed
  const prev = await loadCatalog(env);
  const prevMap = new Map();
  if (prev?.sermons) {
    for (const s of prev.sermons) prevMap.set(s.videoId, s);
  }

  const toEmbed = [];
  for (const s of sermons) {
    const old = prevMap.get(s.videoId);
    if (!old || old.title !== s.title || old.description !== s.description) {
      toEmbed.push(s);
    }
  }

  let vectorStats = { embedded: 0, upserted: 0, errors: 0 };
  if (env.VECTORIZE && env.AI && toEmbed.length > 0) {
    vectorStats = await upsertSermonsToVectorize(env, toEmbed);
  }

  // v4 Step 5: Remove vectors for videos that were dropped (now private/deleted/etc)
  // Compare current "keep" set against previous catalog to find newly-dropped IDs.
  const droppedFromPrev = [];
  if (prev?.sermons) {
    const keepIds = new Set(sermons.map(s => s.videoId));
    for (const oldS of prev.sermons) {
      if (!keepIds.has(oldS.videoId)) {
        droppedFromPrev.push(oldS.videoId);
      }
    }
  }
  let deleteStats = { deleted: 0, errors: 0 };
  if (droppedFromPrev.length > 0 && env.VECTORIZE) {
    deleteStats = await deleteVectorsByIds(env, droppedFromPrev);
  }

  const catalog = {
    refreshed_at: new Date().toISOString(),
    channel_id: channelId,
    count: sermons.length,
    raw_playlist_count: allFromPlaylist.length,
    filtered_out_count: drop.length,
    filter_drop_sample: drop.slice(0, 10), // first 10 for debugging visibility
    vector_stats: vectorStats,
    delete_stats: deleteStats,
    last_full_reembed: prev?.last_full_reembed || null,
    sermons,
  };
  await saveCatalog(env, catalog);

  return {
    refreshed_at: catalog.refreshed_at,
    raw_playlist_count: allFromPlaylist.length,
    public_sermons: sermons.length,
    filtered_out: drop.length,
    newly_embedded: vectorStats.embedded,
    embed_errors: vectorStats.errors,
    vectors_deleted: deleteStats.deleted,
  };
}

async function reembedAll(env) {
  const catalog = await loadCatalog(env);
  if (!catalog || !catalog.sermons) {
    return { ok: false, error: 'No catalog found, run /refresh first' };
  }
  if (!env.VECTORIZE || !env.AI) {
    return { ok: false, error: 'Vectorize or AI binding missing' };
  }
  const stats = await upsertSermonsToVectorize(env, catalog.sermons);
  catalog.vector_stats = stats;
  catalog.last_full_reembed = new Date().toISOString();
  await saveCatalog(env, catalog);
  return { ok: true, total_sermons: catalog.sermons.length, ...stats };
}

// ─── Transcript ingest ────────────────────────────────────────────────────────

async function ingestTranscript(env, videoId, rawTranscript) {
  if (!videoId || !rawTranscript) {
    return { ok: false, error: 'videoId and transcript required' };
  }

  const catalog = await loadCatalog(env);
  if (!catalog || !catalog.sermons) {
    return { ok: false, error: 'Catalog not loaded — run /refresh first' };
  }

  const sermon = catalog.sermons.find(s => s.videoId === videoId);
  if (!sermon) {
    return { ok: false, error: `Sermon ${videoId} not found in catalog` };
  }

  const cleaned = cleanTranscript(rawTranscript);
  if (cleaned.length < 50) {
    return { ok: false, error: 'Transcript too short after cleaning (min 50 chars)' };
  }

  await env.SERMONS_KV.put(`transcript-${videoId}`, cleaned);

  if (!env.VECTORIZE || !env.AI) {
    return { ok: true, message: 'Transcript saved, but Vectorize/AI not bound — search will not be updated', videoId, characters: cleaned.length };
  }

  const embedText = await buildEmbedTextWithTranscript(env, sermon);
  const vectors = await embedTexts(env, [embedText]);
  if (!vectors[0]) {
    return { ok: false, error: 'Embedding failed' };
  }

  await env.VECTORIZE.upsert([{
    id: videoId,
    values: vectors[0],
    metadata: {
      title: sermon.title,
      url: sermon.url,
      publishedAt: sermon.publishedAt,
      description: (sermon.description || '').slice(0, 500),
      thumbnail: sermon.thumbnail || '',
      has_transcript: true,
    },
  }]);

  return {
    ok: true,
    message: `Transcript ingested for "${sermon.title}"`,
    videoId,
    characters: cleaned.length,
  };
}

// ─── Admin pages ──────────────────────────────────────────────────────────────

function transcriptAdminHTML() {
  return html(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tab Sermons — Transcript Admin</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, sans-serif; background: #f0f4f8; color: #333; min-height: 100vh; padding: 20px; }
.container { max-width: 800px; margin: 0 auto; }
.header { background: #1E3A5F; color: white; padding: 16px 20px; border-radius: 12px 12px 0 0; }
.header h1 { font-size: 18px; }
.header p { font-size: 12px; opacity: 0.8; margin-top: 4px; }
.card { background: white; padding: 20px; border-radius: 0 0 12px 12px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); margin-bottom: 16px; }
.card.standalone { border-radius: 12px; }
label { display: block; font-size: 13px; font-weight: 600; color: #1E3A5F; margin-bottom: 6px; margin-top: 12px; }
input, textarea { width: 100%; border: 1px solid #ddd; border-radius: 8px; padding: 10px 12px; font-size: 14px; font-family: inherit; outline: none; }
input:focus, textarea:focus { border-color: #1E3A5F; }
textarea { min-height: 200px; resize: vertical; font-family: ui-monospace, Menlo, monospace; font-size: 12px; }
.btn { padding: 10px 20px; border-radius: 8px; border: none; cursor: pointer; font-size: 14px; font-weight: 500; margin-top: 16px; }
.btn-primary { background: #1E3A5F; color: white; }
.btn-primary:hover { opacity: 0.9; }
.btn-secondary { background: #e2e8f0; color: #333; margin-left: 8px; }
.status { font-size: 13px; padding: 10px 12px; border-radius: 6px; margin-top: 12px; display: none; }
.status.success { background: #dcfce7; color: #166534; display: block; }
.status.error { background: #fee2e2; color: #991b1b; display: block; }
.status.info { background: #dbeafe; color: #1e40af; display: block; }
.help { font-size: 12px; color: #666; margin-top: 4px; }
.section-divider { border-top: 1px solid #e2e8f0; margin: 24px 0 0; padding-top: 20px; }
.url-hint { background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 6px; padding: 8px 10px; font-family: ui-monospace, Menlo, monospace; font-size: 12px; color: #475569; margin-top: 6px; word-break: break-all; }
</style>
</head>
<body>
<div class="container">

  <div class="header">
    <h1>Sermon Transcript Admin</h1>
    <p>Upload transcripts so Tab Assistant can search sermon content, not just titles</p>
  </div>

  <div class="card">
    <h2 style="font-size:15px;color:#1E3A5F;margin-bottom:8px">Login</h2>
    <p class="help">Enter your admin token to enable saving</p>
    <input type="password" id="token-input" placeholder="Admin token" />
  </div>

  <div class="card standalone">
    <h2 style="font-size:15px;color:#1E3A5F;margin-bottom:8px">Add a Single Transcript</h2>

    <label for="video-id">YouTube Video ID</label>
    <input type="text" id="video-id" placeholder="e.g. dQw4w9WgXcQ" />
    <p class="help">The 11-character ID from the YouTube URL — the part after <code>v=</code></p>
    <div class="url-hint">https://www.youtube.com/watch?v=<strong>dQw4w9WgXcQ</strong></div>

    <label for="transcript-text">Transcript Content</label>
    <textarea id="transcript-text" placeholder="Paste the .vtt or .srt or plain text content here..."></textarea>
    <p class="help">Paste the full content of the .vtt file you downloaded from YouTube Studio. Timestamps will be cleaned automatically.</p>

    <button class="btn btn-primary" onclick="ingestSingle()">Save Transcript & Embed</button>

    <div class="status" id="single-status"></div>
  </div>

  <div class="card standalone section-divider">
    <h2 style="font-size:15px;color:#1E3A5F;margin-bottom:8px">Maintenance</h2>
    <p class="help">Re-embed all sermons in the catalog. Use this if vector search returns nothing — it'll embed all sermons (with transcripts where available) into Vectorize. Takes a few minutes.</p>
    <button class="btn btn-primary" onclick="reembedAll()">Re-embed All Sermons</button>
    <div class="status" id="reembed-status"></div>

    <p class="help" style="margin-top:16px">Refresh the catalog from YouTube. v4 now filters out private/unlisted/deleted videos automatically.</p>
    <button class="btn btn-primary" onclick="refreshCatalog()">Refresh Catalog from YouTube</button>
    <div class="status" id="refresh-status"></div>
  </div>

  <div class="card standalone">
    <h2 style="font-size:15px;color:#1E3A5F;margin-bottom:8px">Status Check</h2>
    <button class="btn btn-secondary" onclick="checkStatus()">Check Catalog & Vector Status</button>
    <div class="status" id="status-status"></div>
  </div>

</div>

<script>
function getToken() {
  return document.getElementById('token-input').value.trim();
}

async function ingestSingle() {
  const status = document.getElementById('single-status');
  const token = getToken();
  const videoId = document.getElementById('video-id').value.trim();
  const transcriptText = document.getElementById('transcript-text').value.trim();

  if (!token) {
    status.className = 'status error';
    status.textContent = 'Admin token required';
    return;
  }
  if (!videoId || !transcriptText) {
    status.className = 'status error';
    status.textContent = 'Both Video ID and transcript are required';
    return;
  }

  status.className = 'status info';
  status.textContent = 'Saving and embedding...';

  try {
    const res = await fetch('/admin/transcript/ingest', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
      },
      body: JSON.stringify({ videoId, transcript: transcriptText }),
    });
    const data = await res.json();
    if (data.ok) {
      status.className = 'status success';
      status.textContent = '✓ ' + (data.message || 'Saved') + ' — ' + data.characters + ' characters';
      document.getElementById('video-id').value = '';
      document.getElementById('transcript-text').value = '';
    } else {
      status.className = 'status error';
      status.textContent = data.error || 'Save failed';
    }
  } catch (e) {
    status.className = 'status error';
    status.textContent = 'Error: ' + e.message;
  }
}

async function reembedAll() {
  const status = document.getElementById('reembed-status');
  const token = getToken();
  if (!token) {
    status.className = 'status error';
    status.textContent = 'Admin token required';
    return;
  }
  if (!confirm('Re-embed all sermons? This takes a few minutes.')) return;

  status.className = 'status info';
  status.textContent = 'Re-embedding all sermons... This may take a few minutes. Do not close this page.';

  try {
    const res = await fetch('/admin/reembed-all', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token },
    });
    const data = await res.json();
    if (data.ok) {
      status.className = 'status success';
      status.textContent = '✓ Re-embedded ' + data.embedded + ' of ' + data.total_sermons + ' sermons (' + data.errors + ' errors)';
    } else {
      status.className = 'status error';
      status.textContent = data.error || 'Re-embed failed';
    }
  } catch (e) {
    status.className = 'status error';
    status.textContent = 'Error: ' + e.message;
  }
}

async function refreshCatalog() {
  const status = document.getElementById('refresh-status');
  const token = getToken();
  if (!token) {
    status.className = 'status error';
    status.textContent = 'Admin token required';
    return;
  }
  if (!confirm('Refresh catalog from YouTube? This will pull all videos and filter dead ones.')) return;

  status.className = 'status info';
  status.textContent = 'Refreshing catalog... This pulls all videos from YouTube and checks privacy/upload status.';

  try {
    const res = await fetch('/refresh', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token },
    });
    const data = await res.json();
    if (data.ok) {
      status.className = 'status success';
      status.innerHTML =
        '✓ Refresh complete<br>' +
        'Public sermons kept: ' + data.public_sermons + '<br>' +
        'Filtered out: ' + data.filtered_out + ' (private/unlisted/deleted)<br>' +
        'Newly embedded: ' + data.newly_embedded + '<br>' +
        'Vectors deleted: ' + data.vectors_deleted;
    } else {
      status.className = 'status error';
      status.textContent = data.error || 'Refresh failed';
    }
  } catch (e) {
    status.className = 'status error';
    status.textContent = 'Error: ' + e.message;
  }
}

async function checkStatus() {
  const status = document.getElementById('status-status');
  status.className = 'status info';
  status.textContent = 'Checking...';
  try {
    const [healthRes, countRes] = await Promise.all([
      fetch('/health'),
      fetch('/count'),
    ]);
    const health = await healthRes.json();
    const count = await countRes.json();
    status.className = 'status info';
    status.innerHTML =
      'Service: ' + (health.ok ? 'OK' : 'DOWN') + '<br>' +
      'Version: ' + health.version + '<br>' +
      'Filters dead videos: ' + (health.filters_dead_videos ? 'YES' : 'NO') + '<br>' +
      'KV bound: ' + health.kv_bound + '<br>' +
      'Vectorize bound: ' + health.vectorize_bound + '<br>' +
      'AI bound: ' + health.ai_bound + '<br>' +
      'Total public sermons: ' + count.count + '<br>' +
      'Filtered out last refresh: ' + (count.filtered_out_count !== undefined ? count.filtered_out_count : 'unknown') + '<br>' +
      'Last refresh: ' + (count.last_refreshed || 'never') + '<br>' +
      'Last embed run: ' + (count.vector_stats ? JSON.stringify(count.vector_stats) : 'unknown');
  } catch (e) {
    status.className = 'status error';
    status.textContent = 'Status check failed: ' + e.message;
  }
}
</script>

</body>
</html>`);
}

// ─── Main fetch handler ───────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'OPTIONS') return new Response(null, { headers: getCORS(request) });

    if (path === '/health') {
      return json({
        ok: true,
        service: 'tab-sermons',
        version: 'v4',
        filters_dead_videos: true,
        kv_bound: !!env.SERMONS_KV,
        vectorize_bound: !!env.VECTORIZE,
        ai_bound: !!env.AI,
        has_api_key: !!env.YT_API_KEY,
      }, 200, request);
    }

    if (path === '/count') {
      const catalog = await loadCatalog(env);
      return json({
        ok: true,
        count: catalog?.sermons?.length || 0,
        raw_playlist_count: catalog?.raw_playlist_count || null,
        filtered_out_count: catalog?.filtered_out_count || 0,
        last_refreshed: catalog?.refreshed_at || null,
        last_full_reembed: catalog?.last_full_reembed || null,
        vector_stats: catalog?.vector_stats || null,
      }, 200, request);
    }

    if (path === '/recent' && method === 'GET') {
      const catalog = await loadCatalog(env);
      if (!catalog) return json({ ok: false, error: 'catalog empty, run /refresh first' }, 404, request);
      const n = Math.min(20, Math.max(1, parseInt(url.searchParams.get('n') || '5', 10)));
      const sermons = [...catalog.sermons]
        .sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''))
        .slice(0, n);
      return json({ ok: true, sermons }, 200, request);
    }

    if (path === '/search' && method === 'GET') {
      const q = url.searchParams.get('q') || '';
      if (!q) return json({ ok: false, error: 'missing query param q' }, 400, request);

      if (env.VECTORIZE && env.AI) {
        try {
          const results = await semanticSearch(env, q, 5);
          if (results.length > 0) {
            return json({ ok: true, mode: 'semantic', query: q, count: results.length, sermons: results }, 200, request);
          }
        } catch (e) {
          console.error('semantic search failed:', e.message);
        }
      }

      const catalog = await loadCatalog(env);
      if (!catalog) return json({ ok: false, error: 'catalog empty, run /refresh first' }, 404, request);
      const results = keywordSearch(catalog.sermons, q);
      return json({ ok: true, mode: 'keyword-fallback', query: q, count: results.length, sermons: results }, 200, request);
    }

    if (path === '/search-keyword' && method === 'GET') {
      const catalog = await loadCatalog(env);
      if (!catalog) return json({ ok: false, error: 'catalog empty, run /refresh first' }, 404, request);
      const q = url.searchParams.get('q') || '';
      if (!q) return json({ ok: false, error: 'missing query param q' }, 400, request);
      const results = keywordSearch(catalog.sermons, q);
      return json({ ok: true, mode: 'keyword', query: q, count: results.length, sermons: results }, 200, request);
    }

    // ── Admin endpoints ─────────────────────────────────────────────────────
    if (path === '/admin/transcripts' || path === '/admin/transcripts/') {
      return transcriptAdminHTML();
    }

    if (path === '/admin/transcript/ingest' && method === 'POST') {
      if (!isAdminAuthed(request, env)) return json({ ok: false, error: 'Unauthorized' }, 401, request);
      try {
        const body = await request.json();
        const { videoId, transcript } = body;
        const result = await ingestTranscript(env, videoId, transcript);
        return json(result, result.ok ? 200 : 400, request);
      } catch (e) {
        return json({ ok: false, error: e.message }, 500, request);
      }
    }

    if (path === '/admin/reembed-all' && method === 'POST') {
      if (!isAdminAuthed(request, env)) return json({ ok: false, error: 'Unauthorized' }, 401, request);
      try {
        const result = await reembedAll(env);
        return json(result, result.ok ? 200 : 500, request);
      } catch (e) {
        return json({ ok: false, error: e.message }, 500, request);
      }
    }

    if (path === '/refresh' && method === 'POST') {
      if (!isAdminAuthed(request, env)) return json({ ok: false, error: 'Unauthorized' }, 401, request);
      try {
        const result = await runRefresh(env);
        return json({ ok: true, ...result }, 200, request);
      } catch (e) {
        return json({ ok: false, error: e.message }, 500, request);
      }
    }

    return json({ error: 'Not found', path }, 404, request);
  },

  async scheduled(event, env, ctx) {
    try {
      console.log('[cron] starting scheduled refresh');
      const result = await runRefresh(env);
      console.log('[cron] refresh complete:', JSON.stringify(result));
    } catch (e) {
      console.error('[cron] refresh failed:', e.message);
    }
  },
};
