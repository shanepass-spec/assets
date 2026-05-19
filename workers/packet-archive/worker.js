// packet-archive.js
// Context Packet Archive — structured memory for Tabernacle Hub projects
// Stores, retrieves, lists, and searches context packets across projects
// KV-backed. Auth-protected writes. Simple and durable.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function err(msg, status = 400) {
  return json({ error: msg }, status);
}

// ── AUTH ───────────────────────────────────────────────────────────────────────
function isAuthed(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = env.ARCHIVE_TOKEN || 'tabernacle-archive-2026';
  return auth === `Bearer ${token}` || auth === token;
}

// ── SLUG HELPERS ───────────────────────────────────────────────────────────────
function toSlug(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function packetKey(slug) {
  return `packet:${slug}`;
}

function indexKey(project) {
  return project ? `index:project:${project}` : 'index:all';
}

// ── PACKET SCHEMA ──────────────────────────────────────────────────────────────
function buildPacket(body, existing = null) {
  const now = new Date().toISOString();
  return {
    id: existing?.id || crypto.randomUUID(),
    slug: body.slug || toSlug(body.title || ''),
    title: body.title || existing?.title || '',
    project: body.project || existing?.project || '',
    category: body.category || existing?.category || '',
    packet_type: body.packet_type || existing?.packet_type || 'general',
    source_thread: body.source_thread || existing?.source_thread || '',
    status: body.status || existing?.status || 'active',
    tags: body.tags || existing?.tags || [],
    summary: body.summary || existing?.summary || '',
    content: body.content || existing?.content || '',
    notes: body.notes || existing?.notes || '',
    date_created: existing?.date_created || now,
    date_updated: now,
  };
}

// ── INDEX MANAGEMENT ───────────────────────────────────────────────────────────
async function addToIndex(kv, packet) {
  // All packets index
  const allRaw = await kv.get('index:all', 'json') || [];
  if (!allRaw.includes(packet.slug)) {
    allRaw.push(packet.slug);
    await kv.put('index:all', JSON.stringify(allRaw));
  }
  // Project index
  if (packet.project) {
    const projKey = `index:project:${packet.project}`;
    const projRaw = await kv.get(projKey, 'json') || [];
    if (!projRaw.includes(packet.slug)) {
      projRaw.push(packet.slug);
      await kv.put(projKey, JSON.stringify(projRaw));
    }
  }
  // Category index
  if (packet.category) {
    const catKey = `index:category:${packet.category}`;
    const catRaw = await kv.get(catKey, 'json') || [];
    if (!catRaw.includes(packet.slug)) {
      catRaw.push(packet.slug);
      await kv.put(catKey, JSON.stringify(catRaw));
    }
  }
}

async function removeFromIndex(kv, packet) {
  const allRaw = await kv.get('index:all', 'json') || [];
  await kv.put('index:all', JSON.stringify(allRaw.filter(s => s !== packet.slug)));
  if (packet.project) {
    const projKey = `index:project:${packet.project}`;
    const projRaw = await kv.get(projKey, 'json') || [];
    await kv.put(projKey, JSON.stringify(projRaw.filter(s => s !== packet.slug)));
  }
}

// ── MAIN WORKER ────────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const kv = env.PACKETS;

    if (!kv) return err('KV binding not configured', 500);

    // ── POST /api/packets — create packet ──────────────────────────────────────
    if (path === '/api/packets' && method === 'POST') {
      if (!isAuthed(request, env)) return err('Unauthorized', 401);
      try {
        const body = await request.json();
        if (!body.title) return err('title is required');
        const packet = buildPacket(body);
        if (!packet.slug) return err('could not generate slug from title');

        const existing = await kv.get(packetKey(packet.slug), 'json');
        if (existing) return err(`Packet with slug "${packet.slug}" already exists. Use PUT to update.`, 409);

        await kv.put(packetKey(packet.slug), JSON.stringify(packet));
        await addToIndex(kv, packet);
        return json({ ok: true, packet }, 201);
      } catch (e) {
        return err('Invalid request: ' + e.message);
      }
    }

    // ── PUT /api/packets/:slug — update packet ─────────────────────────────────
    if (path.startsWith('/api/packets/') && method === 'PUT') {
      if (!isAuthed(request, env)) return err('Unauthorized', 401);
      try {
        const slug = path.split('/')[3];
        if (!slug) return err('slug required');
        const existing = await kv.get(packetKey(slug), 'json');
        if (!existing) return err(`Packet "${slug}" not found. Use POST to create.`, 404);
        const body = await request.json();
        const updated = buildPacket(body, existing);
        updated.slug = slug; // preserve original slug
        await kv.put(packetKey(slug), JSON.stringify(updated));
        await addToIndex(kv, updated);
        return json({ ok: true, packet: updated });
      } catch (e) {
        return err('Invalid request: ' + e.message);
      }
    }

    // ── GET /api/packets/:slug — fetch single packet ───────────────────────────
    if (path.startsWith('/api/packets/') && path.split('/').length === 4 && method === 'GET') {
      const slug = path.split('/')[3];
      if (!slug) return err('slug required');
      const packet = await kv.get(packetKey(slug), 'json');
      if (!packet) return err(`Packet "${slug}" not found`, 404);
      return json(packet);
    }

    // ── GET /api/packets — list packets ───────────────────────────────────────
    if (path === '/api/packets' && method === 'GET') {
      try {
        const project = url.searchParams.get('project');
        const category = url.searchParams.get('category');
        const tag = url.searchParams.get('tag');

        let slugs = [];
        if (project) {
          slugs = await kv.get(`index:project:${project}`, 'json') || [];
        } else if (category) {
          slugs = await kv.get(`index:category:${category}`, 'json') || [];
        } else {
          slugs = await kv.get('index:all', 'json') || [];
        }

        const packets = await Promise.all(
          slugs.map(s => kv.get(packetKey(s), 'json'))
        );
        let results = packets.filter(Boolean);

        // Tag filter (post-fetch)
        if (tag) {
          results = results.filter(p => Array.isArray(p.tags) && p.tags.includes(tag));
        }

        // Sort newest first
        results.sort((a, b) => new Date(b.date_updated) - new Date(a.date_updated));

        return json({ count: results.length, packets: results });
      } catch (e) {
        return err('List failed: ' + e.message);
      }
    }

    // ── GET /api/packets/search?q= — keyword search ────────────────────────────
    if (path === '/api/packets/search' && method === 'GET') {
      const q = (url.searchParams.get('q') || '').toLowerCase().trim();
      if (!q) return err('q parameter required');
      try {
        const slugs = await kv.get('index:all', 'json') || [];
        const packets = await Promise.all(slugs.map(s => kv.get(packetKey(s), 'json')));
        const results = packets.filter(p => {
          if (!p) return false;
          return (
            p.title?.toLowerCase().includes(q) ||
            p.summary?.toLowerCase().includes(q) ||
            p.content?.toLowerCase().includes(q) ||
            p.tags?.some(t => t.toLowerCase().includes(q)) ||
            p.project?.toLowerCase().includes(q) ||
            p.category?.toLowerCase().includes(q)
          );
        });
        return json({ count: results.length, query: q, packets: results });
      } catch (e) {
        return err('Search failed: ' + e.message);
      }
    }

    // ── DELETE /api/packets/:slug ──────────────────────────────────────────────
    if (path.startsWith('/api/packets/') && method === 'DELETE') {
      if (!isAuthed(request, env)) return err('Unauthorized', 401);
      try {
        const slug = path.split('/')[3];
        const existing = await kv.get(packetKey(slug), 'json');
        if (!existing) return err(`Packet "${slug}" not found`, 404);
        await kv.delete(packetKey(slug));
        await removeFromIndex(kv, existing);
        return json({ ok: true, deleted: slug });
      } catch (e) {
        return err('Delete failed: ' + e.message);
      }
    }

    // ── GET /api/status — health check ────────────────────────────────────────
    if (path === '/api/status' && method === 'GET') {
      const allSlugs = await kv.get('index:all', 'json') || [];
      return json({ ok: true, packet_count: allSlugs.length, service: 'packet-archive' });
    }

    return err('Not found', 404);
  }
};
