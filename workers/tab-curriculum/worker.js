export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const key = decodeURIComponent(url.pathname.slice(1));

    // --- Homepage: browse all seasons ---
    if (!key || key === '') {
      return await renderHome(env, url);
    }

    // --- Serve index.json (manifest) for any season ---
    if (key.toLowerCase().endsWith('.json')) {
      const object = await env.CURRICULUM.get(key);
      if (!object) return new Response('Not found', { status: 404 });
      return new Response(object.body, {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=300',
        }
      });
    }

    // --- Serve PDFs (open inline in browser) ---
    if (key.toLowerCase().endsWith('.pdf')) {
      const object = await env.CURRICULUM.get(key);
      if (!object) return new Response('Not found', { status: 404 });
      const filename = key.split('/').pop();
      return new Response(object.body, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'inline; filename="' + filename + '"',
          'Cache-Control': 'public, max-age=86400',
        }
      });
    }

    return new Response('Not found', { status: 404 });
  }
};

// Discover season folders at bucket root (e.g. "Summer_2026/")
async function listSeasons(env) {
  const listed = await env.CURRICULUM.list({ delimiter: '/' });
  const seasons = (listed.delimitedPrefixes || [])
    .map(p => p.replace(/\/$/, ''))
    .filter(p => /_\d{4}$/.test(p)); // Season_YYYY pattern
  // Sort newest first by year, then season order
  const order = { Winter: 0, Spring: 1, Summer: 2, Fall: 3 };
  seasons.sort((a, b) => {
    const [sa, ya] = a.split('_');
    const [sb, yb] = b.split('_');
    if (yb !== ya) return parseInt(yb) - parseInt(ya);
    return (order[sb] ?? 0) - (order[sa] ?? 0);
  });
  return seasons;
}

function prettySeason(folder) {
  return folder.replace('_', ' ');
}

async function renderHome(env, url) {
  const seasons = await listSeasons(env);
  const base = url.origin;

  // Load each season's manifest
  const sections = [];
  for (const season of seasons) {
    let manifest = null;
    try {
      const obj = await env.CURRICULUM.get(season + '/index.json');
      if (obj) manifest = JSON.parse(await obj.text());
    } catch (e) { manifest = null; }
    sections.push(renderSeason(season, manifest, base));
  }

  const body = sections.length
    ? sections.join('\n')
    : '<p class="empty">No curriculum is published yet.</p>';

  return new Response(pageShell(body), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

function renderSeason(season, manifest, base) {
  const title = manifest?.display_title || prettySeason(season);
  if (!manifest) {
    return `<section class="season"><h2>${esc(prettySeason(season))}</h2>
      <p class="empty">Manifest unavailable for this season.</p></section>`;
  }

  const lessons = manifest.lessons || [];
  const files = manifest.files || [];

  // Map lane -> {week -> path}
  const laneMap = {};
  for (const f of files) {
    if (!laneMap[f.lane]) laneMap[f.lane] = {};
    if (f.week != null) laneMap[f.lane][f.week] = f.path;
  }

  // READ ME (schedule lane)
  const readme = files.find(f => f.lane === 'schedule');
  const readmeLink = readme
    ? `<a class="readme" href="${base}/${encodePath(season + '/' + readme.path)}" target="_blank">📅 Read Me First — Schedule &amp; Dates</a>`
    : '';

  // Build rows
  let rows = '';
  for (const l of lessons) {
    const adult = laneMap['adult_leader']?.[l.week];
    const senior = laneMap['senior_adult_leader']?.[l.week];
    const ddg = laneMap['daily_discipleship']?.[l.week];
    rows += `<tr>
      <td class="wk">${esc(l.week_label || ('Week ' + l.week))}<span class="dt">${esc(l.display_date || '')}</span></td>
      <td class="ti">${esc(l.title || '')}<span class="fp">${esc(l.focal_passage || '')}</span></td>
      <td class="dl">${trackLink(base, season, adult)}</td>
      <td class="dl">${trackLink(base, season, senior)}</td>
      <td class="dl">${trackLink(base, season, ddg)}</td>
    </tr>`;
  }

  return `<section class="season">
    <h2>${esc(title)}</h2>
    ${readmeLink}
    <div class="tablewrap">
    <table>
      <thead><tr>
        <th>Week</th><th>Lesson</th>
        <th>Adult</th><th>Senior Adult</th><th>Daily Discipleship</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    </div>
  </section>`;
}

function trackLink(base, season, path) {
  if (!path) return '<span class="na">—</span>';
  return `<a href="${base}/${encodePath(season + '/' + path)}" target="_blank">Open</a>`;
}

function encodePath(p) {
  return p.split('/').map(encodeURIComponent).join('/');
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function pageShell(body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tab Sunday School Curriculum</title>
<style>
  :root {
    --brown:#402020; --cross:#6d3d31; --reach:#aac27f;
    --equip:#ca8342; --send:#8dc6e8; --cream:#f6f1e7;
  }
  * { box-sizing:border-box; }
  body {
    margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
    background:var(--cream); color:var(--brown); line-height:1.45;
  }
  header {
    background:var(--reach); color:var(--brown);
    padding:22px 20px; border-bottom:4px solid var(--cross);
  }
  header h1 { margin:0; font-size:1.4rem; }
  header p { margin:4px 0 0; font-size:.9rem; opacity:.85; }
  main { max-width:1000px; margin:0 auto; padding:20px; }
  .podcast { display:flex; flex-direction:column; gap:3px;
    margin-bottom:24px; padding:16px 18px; background:var(--cross);
    color:var(--cream); border-radius:12px; text-decoration:none;
    font-weight:700; font-size:1.02rem;
    box-shadow:0 1px 3px rgba(0,0,0,.08); }
  .podcast:hover { opacity:.92; }
  .podcast span { font-size:.82rem; opacity:.88; font-weight:400; }
  .season { background:#fff; border-radius:12px; padding:18px 16px;
    margin-bottom:26px; box-shadow:0 1px 3px rgba(0,0,0,.08); }
  .season h2 { margin:0 0 10px; color:var(--cross); font-size:1.25rem; }
  .readme { display:inline-block; margin-bottom:14px; padding:8px 14px;
    background:var(--equip); color:#fff; border-radius:8px;
    text-decoration:none; font-weight:600; font-size:.92rem; }
  .readme:hover { opacity:.9; }
  .tablewrap { overflow-x:auto; }
  table { width:100%; border-collapse:collapse; font-size:.9rem; }
  th { text-align:left; background:var(--brown); color:var(--cream);
    padding:9px 10px; font-weight:600; white-space:nowrap; }
  td { padding:9px 10px; border-bottom:1px solid #eee; vertical-align:top; }
  .wk { white-space:nowrap; font-weight:600; }
  .wk .dt { display:block; font-weight:400; font-size:.78rem; opacity:.7; }
  .ti .fp { display:block; font-size:.78rem; opacity:.7; }
  .dl a { display:inline-block; padding:5px 12px; background:var(--send);
    color:var(--brown); border-radius:6px; text-decoration:none;
    font-weight:600; font-size:.82rem; }
  .dl a:hover { opacity:.85; }
  .na { color:#bbb; }
  .empty { color:var(--cross); font-style:italic; }
  footer { text-align:center; padding:20px; font-size:.8rem; opacity:.6; }
  footer .staff-link { display:inline-block; margin-top:8px; color:var(--cross);
    text-decoration:none; font-weight:600; opacity:.85; }
  footer .staff-link:hover { opacity:1; }
</style>
</head>
<body>
<header>
  <h1>Tab Sunday School Curriculum</h1>
  <p>Leader guides for teachers — tap Open to view a lesson.</p>
</header>
<main>
<a class="podcast" href="https://biblestudiesforlife.lifeway.com/podcasts/" target="_blank">
  🎧 Bible Studies for Life — Podcast
  <span>Listen to the weekly session audio from LifeWay</span>
</a>
${body}
</main>
<footer>
  The Tabernacle Church · Sarasota, FL
  <br><a class="staff-link" href="https://tab-curriculum-upload.media-ffd.workers.dev/">🔒 Staff: upload or publish curriculum →</a>
</footer>
</body>
</html>`;
}
