// tab-head-count — Photo head-count tool
// v1.0.0
//
// Counts the number of people in an uploaded photo using Cloudflare
// Workers AI. Two engines are available:
//
//   detect  (default) — object detection with @cf/facebook/detr-resnet-50.
//                        Counts "person" boxes above a confidence threshold
//                        and returns the boxes so the UI can draw them.
//                        Reliable when people are reasonably separated.
//
//   vision            — a vision LLM (@cf/meta/llama-3.2-11b-vision-instruct)
//                        that estimates the count in natural language.
//                        Better for dense crowds where boxes overlap, but
//                        it only returns a number, not boxes.
//
//   both              — run both and return each count.
//
// Endpoints:
//   GET  /            HTML app (camera / file upload, draws boxes)
//   GET  /health      { ok, ai_bound, version }
//   POST /count       image in (multipart "photo" or raw body) -> JSON count
//
// The deploy pipeline (.github/workflows/deploy.yml) preserves existing
// bindings, so the Workers AI binding must be named "AI" on the script.

const VERSION = "1.0.0";
const DETECT_MODEL = "@cf/facebook/detr-resnet-50";
const VISION_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";
const DEFAULT_THRESHOLD = 0.5;
const MAX_BYTES = 12 * 1024 * 1024; // 12 MB guardrail

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === "/health") {
        return json({
          ok: true,
          service: "tab-head-count",
          version: VERSION,
          ai_bound: !!env.AI
        });
      }

      if (path === "/count" && request.method === "POST") {
        return await handleCount(request, env, url);
      }

      if (path === "/" || path === "") {
        return html(PAGE);
      }

      return json({ ok: false, error: "Not found" }, 404);
    } catch (e) {
      return json({ ok: false, error: e.message || String(e) }, 500);
    }
  }
};

async function handleCount(request, env, url) {
  if (!env.AI) {
    return json({ ok: false, error: "Workers AI binding (AI) not configured" }, 500);
  }

  // Accept either a multipart form field "photo" or a raw image body.
  let bytes;
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("photo");
    if (!file || typeof file === "string") {
      return json({ ok: false, error: "Missing 'photo' file field" }, 400);
    }
    bytes = new Uint8Array(await file.arrayBuffer());
  } else {
    bytes = new Uint8Array(await request.arrayBuffer());
  }

  if (!bytes || bytes.length === 0) {
    return json({ ok: false, error: "Empty image" }, 400);
  }
  if (bytes.length > MAX_BYTES) {
    return json({ ok: false, error: `Image too large (max ${Math.round(MAX_BYTES / 1024 / 1024)} MB)` }, 413);
  }

  const mode = (url.searchParams.get("mode") || "detect").toLowerCase();
  let threshold = parseFloat(url.searchParams.get("threshold"));
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    threshold = DEFAULT_THRESHOLD;
  }

  const result = { ok: true, mode, threshold };

  if (mode === "detect" || mode === "both") {
    result.detect = await detectPeople(env, bytes, threshold);
  }
  if (mode === "vision" || mode === "both") {
    result.vision = await visionCount(env, bytes);
  }

  // Convenience top-level count: prefer detection, fall back to vision.
  if (result.detect) {
    result.count = result.detect.count;
  } else if (result.vision) {
    result.count = result.vision.count;
  }

  return json(result);
}

// Object detection: count "person" boxes over the confidence threshold.
async function detectPeople(env, bytes, threshold) {
  const out = await env.AI.run(DETECT_MODEL, { image: [...bytes] });
  const objects = Array.isArray(out) ? out : (out?.result || []);
  const people = objects
    .filter(o => String(o.label).toLowerCase() === "person" && Number(o.score) >= threshold)
    .map(o => ({
      score: round(o.score, 3),
      box: {
        xmin: round(o.box?.xmin ?? 0, 1),
        ymin: round(o.box?.ymin ?? 0, 1),
        xmax: round(o.box?.xmax ?? 0, 1),
        ymax: round(o.box?.ymax ?? 0, 1)
      }
    }))
    .sort((a, b) => b.score - a.score);

  return { engine: DETECT_MODEL, count: people.length, people };
}

// Vision LLM: ask for a head count and parse the first integer out.
async function visionCount(env, bytes) {
  const prompt =
    "Count the number of people (human heads) visible in this image. " +
    "Include partially visible people. Reply with ONLY a single integer, no other text.";
  const out = await env.AI.run(VISION_MODEL, {
    image: [...bytes],
    prompt,
    max_tokens: 16
  });
  const text = (out?.response ?? out?.description ?? "").toString();
  const match = text.match(/-?\d+/);
  const count = match ? Math.max(0, parseInt(match[0], 10)) : null;
  return { engine: VISION_MODEL, count, raw: text.trim() };
}

function round(n, places) {
  const f = Math.pow(10, places);
  return Math.round(Number(n) * f) / f;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*"
    }
  });
}

function html(body) {
  return new Response(body, {
    headers: { "content-type": "text/html; charset=utf-8" }
  });
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Head Count</title>
<style>
  :root{
    --bg:#0b1220; --card:#131c2e; --border:#26324a; --text:#e8eefc;
    --muted:#94a3b8; --accent:#3b82f6; --box:#22d3ee; --good:#22c55e;
  }
  @media (prefers-color-scheme: light){
    :root{ --bg:#f4f6fb; --card:#ffffff; --border:#dbe2ef; --text:#0b1220;
           --muted:#5b6678; --accent:#2563eb; --box:#0891b2; --good:#16a34a; }
  }
  *{box-sizing:border-box}
  body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
       background:var(--bg);color:var(--text);-webkit-text-size-adjust:100%}
  .wrap{max-width:680px;margin:0 auto;padding:20px 16px 60px}
  h1{font-size:22px;margin:6px 0 2px}
  .sub{color:var(--muted);font-size:14px;margin:0 0 18px}
  .card{background:var(--card);border:1px solid var(--border);border-radius:14px;
        padding:16px;margin-bottom:16px}
  label.file{display:block;padding:22px;border:1px dashed var(--border);border-radius:12px;
        text-align:center;color:var(--muted);cursor:pointer;font-size:15px}
  input[type=file]{display:none}
  .row{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:12px}
  .row label{font-size:14px;color:var(--muted)}
  select,input[type=range]{accent-color:var(--accent)}
  select{background:var(--bg);color:var(--text);border:1px solid var(--border);
         border-radius:8px;padding:8px}
  button{background:var(--accent);color:#fff;border:0;border-radius:10px;
         padding:13px 18px;font-size:16px;font-weight:600;cursor:pointer;width:100%}
  button:disabled{opacity:.5;cursor:default}
  .stage{position:relative;margin-top:14px;border-radius:12px;overflow:hidden;line-height:0}
  .stage img{width:100%;display:block}
  .stage canvas{position:absolute;inset:0;width:100%;height:100%}
  .count{font-size:56px;font-weight:800;line-height:1;margin:6px 0}
  .count .lbl{font-size:14px;font-weight:500;color:var(--muted);display:block;margin-top:6px}
  .pill{display:inline-block;font-size:13px;color:var(--muted);
        background:var(--bg);border:1px solid var(--border);border-radius:999px;
        padding:4px 10px;margin:4px 6px 0 0}
  .err{color:#ef4444;font-size:14px}
  .thr{min-width:36px;text-align:right;font-variant-numeric:tabular-nums}
</style>
</head>
<body>
<div class="wrap">
  <h1>Head Count</h1>
  <p class="sub">Count people in a photo, right from your phone.</p>

  <div class="card">
    <label class="file" for="photo" id="drop">
      📷 Tap to take or choose a photo
    </label>
    <input type="file" id="photo" accept="image/*" capture="environment">

    <div class="row">
      <label for="mode">Engine</label>
      <select id="mode">
        <option value="detect">Detect (boxes)</option>
        <option value="vision">Vision (crowds)</option>
        <option value="both">Both</option>
      </select>
    </div>
    <div class="row" id="thrRow">
      <label for="thr">Confidence</label>
      <input type="range" id="thr" min="0.1" max="0.9" step="0.05" value="0.5" style="flex:1">
      <span class="thr" id="thrVal">0.50</span>
    </div>
    <div class="row">
      <button id="go" disabled>Count heads</button>
    </div>
  </div>

  <div class="card" id="result" style="display:none">
    <div class="count" id="count">–<span class="lbl" id="countLbl">people</span></div>
    <div id="pills"></div>
    <div class="stage" id="stage"></div>
    <div class="err" id="err"></div>
  </div>
</div>

<script>
  const $ = s => document.querySelector(s);
  const photo = $("#photo"), go = $("#go"), drop = $("#drop");
  const modeSel = $("#mode"), thr = $("#thr"), thrVal = $("#thrVal");
  const result = $("#result"), countEl = $("#count"), countLbl = $("#countLbl");
  const pills = $("#pills"), stage = $("#stage"), err = $("#err");
  let file = null;

  thr.addEventListener("input", () => thrVal.textContent = Number(thr.value).toFixed(2));
  modeSel.addEventListener("change", () => {
    $("#thrRow").style.display = modeSel.value === "vision" ? "none" : "";
  });

  photo.addEventListener("change", () => {
    file = photo.files[0] || null;
    if (file) {
      drop.textContent = "📷 " + file.name;
      go.disabled = false;
    }
  });

  go.addEventListener("click", async () => {
    if (!file) return;
    go.disabled = true; go.textContent = "Counting…";
    err.textContent = ""; pills.innerHTML = ""; stage.innerHTML = "";
    result.style.display = "block";
    countEl.firstChild.nodeValue = "…";

    try {
      const mode = modeSel.value;
      const t = thr.value;
      const fd = new FormData();
      fd.append("photo", file);
      const res = await fetch("/count?mode=" + mode + "&threshold=" + t, {
        method: "POST", body: fd
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Request failed");

      const n = data.count == null ? "?" : data.count;
      countEl.firstChild.nodeValue = String(n);
      countLbl.textContent = (n === 1 ? "person" : "people");

      if (data.detect) addPill("Detect: " + data.detect.count);
      if (data.vision) addPill("Vision: " + (data.vision.count == null ? "?" : data.vision.count));

      // Draw the photo with any detection boxes on top.
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        stage.appendChild(img);
        const boxes = data.detect && data.detect.people || [];
        if (boxes.length) drawBoxes(img, boxes);
        URL.revokeObjectURL(url);
      };
      img.src = url;
    } catch (e) {
      err.textContent = e.message || String(e);
      countEl.firstChild.nodeValue = "–";
    } finally {
      go.disabled = false; go.textContent = "Count heads";
    }
  });

  function addPill(text){
    const s = document.createElement("span");
    s.className = "pill"; s.textContent = text; pills.appendChild(s);
  }

  function drawBoxes(img, boxes){
    const c = document.createElement("canvas");
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    stage.appendChild(c);
    const ctx = c.getContext("2d");
    ctx.lineWidth = Math.max(2, img.naturalWidth / 300);
    ctx.strokeStyle = "#22d3ee";
    ctx.font = (Math.max(12, img.naturalWidth/60)) + "px system-ui";
    ctx.fillStyle = "#22d3ee";
    boxes.forEach((b, i) => {
      const x = b.box.xmin, y = b.box.ymin;
      const w = b.box.xmax - x, h = b.box.ymax - y;
      ctx.strokeRect(x, y, w, h);
      ctx.fillText(String(i + 1), x + 3, Math.max(y - 4, 12));
    });
  }
</script>
</body>
</html>`;
