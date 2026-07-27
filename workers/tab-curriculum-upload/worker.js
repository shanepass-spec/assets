// tab-curriculum-upload — v2.0.0
// Self-serve manager for Sunday School curriculum. Writes into the
// tab-curriculum R2 bucket (the same bucket the teacher-facing viewer reads).
//
// BINDING REQUIRED: R2 bucket  CURRICULUM -> tab-curriculum   (church account)
//
// THE FLOW (what a non-technical user does)
//   1. UPLOAD  — drag the unzipped curriculum folder in. Files land in a
//                staging area (_incoming/) and are NOT visible to teachers yet.
//   2. REVIEW  — the tool reads the package's "TABREADY IMPORT DATA" manifest
//                and shows exactly what will go live (which quarter, how many
//                lessons/files, anything missing). Nothing is written yet.
//   3. PUBLISH — one button copies the staged files into the live quarter
//                folder (e.g. Fall_2026/) and writes the viewer's index.json.
//                Teachers see it immediately in the tabready app.
//
// ROUTES
//   GET  /health               public. Reports binding status + version.
//   GET  /                     public UI shell. Data actions need the access code.
//   PUT  /put?t=CODE&key=K      write one object (used by the uploader)
//   GET  /ls?t=CODE&prefix=P    list keys
//   GET  /get?t=CODE&key=K      read one object back
//   GET  /seasons?t=CODE        list live (published) quarters + a count of files
//   POST /publish?t=CODE&source=_incoming[&dry=1][&replace=1][&allow_missing=1]
//                              REVIEW (dry=1) or PUBLISH a staged quarter.
//
// SAFETY
//   * Uploads stage into _incoming/ — publishing is a deliberate second step.
//   * PROTECTED prefixes (and any already-published quarter) are never
//     overwritten unless the caller explicitly opts in with replace=1.
//   * /publish is manifest-driven: it will only publish what the package's
//     manifest describes. If the manifest is missing or doesn't say which
//     quarter to publish into, it declines and explains — it never guesses.

var TOKEN = "2ZKwKD1Ty_9wiyvt3y3bocQsjaIYcRzC";
var VERSION = "2.0.0";
var PROTECTED = ["Summer_2026/"];
var STAGING_DEFAULT = "_incoming";
var VIEWER_URL = "https://tab-curriculum.media-ffd.workers.dev/";
var SEASON_RE = /^[A-Za-z]+_\d{4}$/;

function j(data, status) {
  return new Response(JSON.stringify(data, null, 2), {
    status: status || 200,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });
}

function auth(url, request) {
  var t = url.searchParams.get("t") || (request && request.headers.get("x-access-code")) || "";
  return t === TOKEN;
}

function isProtected(key) {
  for (var i = 0; i < PROTECTED.length; i++) {
    if (key.indexOf(PROTECTED[i]) === 0) return true;
  }
  return false;
}

function basename(p) {
  var s = String(p || "");
  var i = s.lastIndexOf("/");
  return i >= 0 ? s.slice(i + 1) : s;
}

function ctFor(key) {
  var lower = String(key).toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

async function listAll(env, prefix) {
  var out = [];
  var cursor = undefined;
  do {
    var listing = await env.CURRICULUM.list({ prefix: prefix, cursor: cursor, limit: 1000 });
    for (var i = 0; i < listing.objects.length; i++) {
      out.push({ key: listing.objects[i].key, size: listing.objects[i].size });
    }
    cursor = listing.truncated ? listing.cursor : undefined;
  } while (cursor);
  return out;
}

// List published quarters at the bucket root (Season_YYYY/) with a file count
// and whether the viewer's index.json exists.
async function listSeasons(env) {
  var listed = await env.CURRICULUM.list({ delimiter: "/" });
  var prefixes = (listed.delimitedPrefixes || [])
    .map(function (p) { return p.replace(/\/$/, ""); })
    .filter(function (p) { return SEASON_RE.test(p); });
  var order = { Winter: 0, Spring: 1, Summer: 2, Fall: 3 };
  prefixes.sort(function (a, b) {
    var pa = a.split("_"), pb = b.split("_");
    if (pb[1] !== pa[1]) return parseInt(pb[1]) - parseInt(pa[1]);
    return (order[pb[0]] || 0) - (order[pa[0]] || 0);
  });
  var out = [];
  for (var i = 0; i < prefixes.length; i++) {
    var season = prefixes[i];
    var objs = await listAll(env, season + "/");
    var pdfs = objs.filter(function (o) { return o.key.toLowerCase().endsWith(".pdf"); }).length;
    var head = await env.CURRICULUM.head(season + "/index.json");
    out.push({ season: season, published: !!head, pdf_count: pdfs, protected: isProtected(season + "/") });
  }
  return out;
}

// Build (or, when dry, preview) the promotion of a staged package into a live
// quarter. Manifest-driven and non-destructive.
async function planOrPublish(env, url) {
  var source = (url.searchParams.get("source") || STAGING_DEFAULT).replace(/^\/+|\/+$/g, "");
  var dry = url.searchParams.get("dry") === "1" || url.searchParams.get("dry") === "true";
  var replace = url.searchParams.get("replace") === "1";
  var allowMissing = url.searchParams.get("allow_missing") === "1";
  var warnings = [];

  // 1. Scan the staging area.
  var keys = await listAll(env, source + "/");
  if (!keys.length) {
    return j({ ok: false, stage: "scan",
      error: "Nothing is staged under '" + source + "'. Upload a curriculum package first." }, 404);
  }
  var keyList = keys.map(function (o) { return o.key; });

  // 2. Find the package manifest.
  var manifestKeys = keyList.filter(function (k) { return k.toLowerCase().endsWith("tabready_import/manifest.json"); });
  if (!manifestKeys.length) manifestKeys = keyList.filter(function (k) { return k.toLowerCase().endsWith("/manifest.json"); });
  if (!manifestKeys.length) {
    var topFolders = {};
    keyList.forEach(function (k) {
      var rel = k.slice(source.length + 1);
      var top = rel.split("/")[0];
      if (top) topFolders[top] = true;
    });
    return j({ ok: false, stage: "manifest",
      error: "Couldn't find a TABREADY_IMPORT/manifest.json in this upload. That file is what tells the tool which quarter to publish and where each lesson goes.",
      found_folders: Object.keys(topFolders) }, 422);
  }
  var manifestKey = manifestKeys[0];
  if (manifestKeys.length > 1) warnings.push("More than one manifest was found; using " + manifestKey + ".");

  // 3. Read + parse the manifest.
  var mobj = await env.CURRICULUM.get(manifestKey);
  if (!mobj) return j({ ok: false, stage: "manifest", error: "The manifest key was listed but could not be read: " + manifestKey }, 500);
  var manifest;
  try { manifest = JSON.parse(await mobj.text()); }
  catch (e) { return j({ ok: false, stage: "manifest", error: "The manifest isn't valid JSON: " + e }, 422); }

  // 4. Which live quarter does it target?
  var season = String(manifest.season || manifest.season_folder || manifest.target || manifest.folder || "").replace(/\/+$/, "");
  if (!SEASON_RE.test(season)) {
    return j({ ok: false, stage: "manifest",
      error: "The manifest doesn't name a season folder to publish into. Add a \"season\" like \"Fall_2026\".",
      manifest_top_level_keys: Object.keys(manifest) }, 422);
  }

  // 5. The viewer index (lessons + files). Accept a ready-made index or build one.
  var index = null;
  if (manifest.index && typeof manifest.index === "object") index = manifest.index;
  else if (Array.isArray(manifest.lessons) && Array.isArray(manifest.files)) {
    index = { display_title: manifest.display_title || season.replace("_", " "), lessons: manifest.lessons, files: manifest.files };
  }
  if (!index || !Array.isArray(index.files)) {
    return j({ ok: false, stage: "manifest",
      error: "The manifest doesn't contain the lessons/files list the teacher view needs (expected \"lessons\" and \"files\", or an \"index\" object).",
      manifest_top_level_keys: Object.keys(manifest) }, 422);
  }

  // 6. Resolve each referenced file to a staged object, and plan the copy.
  var manifestDir = manifestKey.slice(0, manifestKey.length - "manifest.json".length); // trailing "/"
  var keySet = {};
  keyList.forEach(function (k) { keySet[k] = true; });
  var copies = [], missing = [];
  for (var fi = 0; fi < index.files.length; fi++) {
    var f = index.files[fi];
    var destPath = String(f.path || "").replace(/^\/+/, "");
    if (!destPath) { warnings.push("A file entry in the manifest had no \"path\" and was skipped."); continue; }
    var dest = season + "/" + destPath;
    var cands = [];
    if (f.source) cands.push(manifestDir + String(f.source).replace(/^\/+/, ""));
    cands.push(manifestDir + destPath);
    var found = null;
    for (var ci = 0; ci < cands.length; ci++) { if (keySet[cands[ci]]) { found = cands[ci]; break; } }
    if (!found) {
      var bn = basename(f.source || destPath);
      for (var ki = 0; ki < keyList.length; ki++) {
        if (keyList[ki].indexOf(manifestDir) === 0 && basename(keyList[ki]) === bn) { found = keyList[ki]; break; }
      }
    }
    if (found) copies.push({ from: found, to: dest });
    else missing.push({ path: destPath, looked_for: basename(f.source || destPath) });
  }

  // 7. Non-destructive guards.
  var head = await env.CURRICULUM.head(season + "/index.json");
  var already = !!head;
  var protectedSeason = isProtected(season + "/");
  var canPublish = (missing.length === 0 || allowMissing) && (!protectedSeason || replace) && (!already || replace);

  // 8a. REVIEW — show the plan, write nothing.
  if (dry) {
    return j({ ok: true, dry: true, plan: {
      season: season,
      display_title: index.display_title || season.replace("_", " "),
      lessons: (index.lessons || []).length,
      files_planned: copies.length,
      files_total: index.files.length,
      missing: missing,
      copies: copies.slice(0, 300),
      already_published: already,
      protected: protectedSeason,
      can_publish: canPublish,
      warnings: warnings,
      manifest_key: manifestKey
    }});
  }

  // 8b. PUBLISH — deliberate, guarded, then copy + write the index.
  if (protectedSeason && !replace) {
    return j({ ok: false, error: "'" + season + "' is protected. Turn on Replace to overwrite it.", protected: true }, 403);
  }
  if (already && !replace) {
    return j({ ok: false, error: "'" + season + "' is already published. Turn on Replace to overwrite it.", already_published: true }, 409);
  }
  if (missing.length && !allowMissing) {
    return j({ ok: false, error: missing.length + " file(s) named in the manifest weren't found in the upload.", missing: missing }, 409);
  }

  var copied = 0;
  for (var c = 0; c < copies.length; c++) {
    var src = await env.CURRICULUM.get(copies[c].from);
    if (!src) { missing.push({ path: copies[c].to, looked_for: copies[c].from }); continue; }
    await env.CURRICULUM.put(copies[c].to, src.body, { httpMetadata: { contentType: ctFor(copies[c].to) } });
    copied++;
  }
  await env.CURRICULUM.put(season + "/index.json", JSON.stringify(index, null, 2), { httpMetadata: { contentType: "application/json" } });

  return j({ ok: true, published: season, files_copied: copied, index_key: season + "/index.json", viewer_url: VIEWER_URL, warnings: warnings });
}

export default {
  async fetch(request, env) {
    var url = new URL(request.url);
    var path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, x-access-code"
        }
      });
    }

    if (path === "/health") {
      return j({
        ok: true,
        service: "tab-curriculum-upload",
        version: VERSION,
        binding_CURRICULUM: !!env.CURRICULUM,
        protected_prefixes: PROTECTED
      });
    }

    // Public UI shell — served WITHOUT the access code so it can be linked from
    // the tool box. The page asks for the code once and remembers it in the
    // browser; every data action below still requires it.
    if (path === "/" || path === "") {
      return new Response(page(), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    if (!auth(url, request)) return j({ ok: false, error: "Bad or missing access code." }, 401);
    if (!env.CURRICULUM) return j({ ok: false, error: "CURRICULUM R2 binding missing." }, 500);

    // ---- WRITE ----
    if (path === "/put" && request.method === "PUT") {
      var key = url.searchParams.get("key") || "";
      if (!key) return j({ ok: false, error: "key required" }, 400);
      if (isProtected(key) && url.searchParams.get("allow_overwrite") !== "YES") {
        return j({ ok: false, error: "Refused: '" + key + "' is under a protected prefix.", protected: PROTECTED }, 403);
      }
      var body = await request.arrayBuffer();
      if (!body || body.byteLength === 0) return j({ ok: false, error: "empty body" }, 400);
      await env.CURRICULUM.put(key, body, { httpMetadata: { contentType: ctFor(key) } });
      return j({ ok: true, key: key, size: body.byteLength, content_type: ctFor(key) });
    }

    // ---- LIST ----
    if (path === "/ls") {
      var prefix = url.searchParams.get("prefix") || "";
      var objs = await listAll(env, prefix);
      return j({ ok: true, count: objs.length, prefix: prefix, objects: objs });
    }

    // ---- READ ----
    if (path === "/get") {
      var gkey = url.searchParams.get("key") || "";
      if (!gkey) return j({ ok: false, error: "key required" }, 400);
      var obj = await env.CURRICULUM.get(gkey);
      if (!obj) return j({ ok: false, error: "not found", key: gkey }, 404);
      return new Response(obj.body, {
        headers: {
          "Content-Type": (obj.httpMetadata && obj.httpMetadata.contentType) || "application/octet-stream",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }

    // ---- LIVE QUARTERS ----
    if (path === "/seasons") {
      var seasons = await listSeasons(env);
      return j({ ok: true, viewer_url: VIEWER_URL, seasons: seasons });
    }

    // ---- REVIEW / PUBLISH ----
    if (path === "/publish" && (request.method === "POST" || request.method === "GET")) {
      return await planOrPublish(env, url);
    }

    return j({ ok: false, error: "Not found" }, 404);
  }
};

function page() {
  var NL = String.fromCharCode(10);
  var h = "";
  h += "<!DOCTYPE html><html lang='en'><head><meta charset='utf-8'>";
  h += "<meta name='viewport' content='width=device-width, initial-scale=1'>";
  h += "<title>Curriculum Manager</title><style>";
  h += ":root{--brown:#402020;--cross:#6d3d31;--reach:#aac27f;--equip:#ca8342;--send:#8dc6e8;--cream:#f6f1e7;}";
  h += "*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--cream);color:var(--brown);line-height:1.45}";
  h += "header{background:var(--reach);padding:22px 20px;border-bottom:4px solid var(--cross)}";
  h += "header h1{margin:0;font-size:1.4rem}header p{margin:4px 0 0;font-size:.9rem;opacity:.85}";
  h += "main{max-width:760px;margin:0 auto;padding:20px}";
  h += ".card{background:#fff;border-radius:12px;padding:18px 16px;margin-bottom:18px;box-shadow:0 1px 3px rgba(0,0,0,.08)}";
  h += ".card h2{margin:0 0 4px;font-size:1.1rem;color:var(--cross)}";
  h += ".card h2 .step{display:inline-block;width:24px;height:24px;line-height:24px;text-align:center;background:var(--cross);color:#fff;border-radius:50%;font-size:.85rem;margin-right:8px}";
  h += ".card .hint{font-size:.86rem;opacity:.75;margin:0 0 12px}";
  h += "label{display:block;font-weight:600;margin-bottom:6px;font-size:.95rem}";
  h += "input[type=text],input[type=password]{width:100%;padding:11px;border:1px solid #ddd;border-radius:8px;font-size:1rem;margin-bottom:14px}";
  h += ".drop{border:3px dashed var(--equip);border-radius:12px;padding:34px 18px;text-align:center;background:#fffdf9;cursor:pointer}";
  h += ".drop.over{background:#fdf0dd}.drop b{display:block;font-size:1.1rem;margin-bottom:6px}.drop span{font-size:.86rem;opacity:.7}";
  h += "button{background:var(--cross);color:#fff;border:0;border-radius:10px;padding:14px 20px;font-size:1rem;font-weight:700;cursor:pointer;width:100%;margin-top:14px}";
  h += "button.ghost{background:#fff;color:var(--cross);border:2px solid var(--cross)}";
  h += "button:disabled{opacity:.5;cursor:default}";
  h += "#log{font-size:.84rem;max-height:340px;overflow-y:auto;margin-top:14px}#log div{padding:4px 0;border-bottom:1px solid #f0eae2}";
  h += ".ok{color:#3f7d20}.err{color:#b3261e;font-weight:600}.muted{opacity:.7}";
  h += "#bar{height:10px;background:#eee;border-radius:6px;overflow:hidden;margin-top:14px;display:none}#bar i{display:block;height:100%;background:var(--reach);width:0%}";
  h += ".pill{display:inline-block;background:var(--reach);color:var(--brown);border-radius:20px;padding:3px 12px;font-weight:700;font-size:.9rem;margin-right:6px}";
  h += ".pubrow{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f0eae2;font-size:.92rem}";
  h += ".pubrow a{color:var(--cross);font-weight:600;text-decoration:none}";
  h += ".review{background:#faf7f1;border-radius:10px;padding:14px;margin-top:12px}";
  h += ".review .big{font-size:1.05rem;font-weight:700}";
  h += ".chk{display:flex;align-items:center;gap:8px;font-size:.88rem;margin-top:8px}.chk input{width:auto;margin:0}";
  h += ".note{font-size:.82rem;background:#fdf0dd;border-radius:8px;padding:10px 12px;margin-top:10px}";
  h += "</style></head><body>";
  h += "<header><h1>Curriculum Manager</h1><p>Upload a quarter, review it, then publish it for your teachers.</p></header><main>";

  // Access-code gate (hidden once a code is saved)
  h += "<div class='card' id='gate' style='display:none'>";
  h += "<h2>Enter your access code</h2>";
  h += "<p class='hint'>Paste the code from your bookmark once. This device will remember it.</p>";
  h += "<input type='password' id='code' placeholder='Access code'>";
  h += "<button id='saveCode'>Save &amp; continue</button>";
  h += "</div>";

  h += "<div id='app' style='display:none'>";

  // Step 1 — Upload
  h += "<div class='card'>";
  h += "<h2><span class='step'>1</span>Upload</h2>";
  h += "<p class='hint'>Unzip the curriculum first, then drag the whole folder in. Files land in a staging area and are <b>not</b> visible to teachers yet.</p>";
  h += "<label>Staging folder</label>";
  h += "<input type='text' id='prefix' value='_incoming' placeholder='_incoming'>";
  h += "<div class='drop' id='drop'><b>Drag the unzipped folder here</b><span>or tap to choose files</span>";
  h += "<input type='file' id='picker' multiple webkitdirectory style='display:none'></div>";
  h += "<button id='go' disabled>Upload</button>";
  h += "<div id='bar'><i></i></div><div id='log'></div>";
  h += "</div>";

  // Step 2 & 3 — Review + Publish
  h += "<div class='card'>";
  h += "<h2><span class='step'>2</span>Review &amp; <span class='step'>3</span>Publish</h2>";
  h += "<p class='hint'>Check what's waiting in staging, then publish it live in one tap. Nothing is written until you press Publish.</p>";
  h += "<button class='ghost' id='review'>Check what's waiting to publish</button>";
  h += "<div id='reviewOut'></div>";
  h += "</div>";

  // Live now
  h += "<div class='card'>";
  h += "<h2>What's live now</h2>";
  h += "<p class='hint'>Quarters your teachers can currently see in the app.</p>";
  h += "<div id='liveOut' class='muted'>Loading…</div>";
  h += "</div>";

  h += "</div>"; // #app

  h += "<script>";
  // ---- token / access code ----
  h += "var qsT=new URLSearchParams(location.search).get('t');";
  h += "if(qsT){try{localStorage.setItem('cur_code',qsT);}catch(e){}}";
  h += "function code(){try{return localStorage.getItem('cur_code')||'';}catch(e){return qsT||'';}}";
  h += "function api(p){var sep=p.indexOf('?')>=0?'&':'?';return p+sep+'t='+encodeURIComponent(code());}";
  h += "var gate=document.getElementById('gate'),app=document.getElementById('app');";
  h += "function boot(){if(code()){gate.style.display='none';app.style.display='block';loadLive();}else{gate.style.display='block';app.style.display='none';}}";
  h += "document.getElementById('saveCode').addEventListener('click',function(){var v=document.getElementById('code').value.trim();if(!v)return;try{localStorage.setItem('cur_code',v);}catch(e){}boot();});";

  // ---- upload (drag/pick a folder) ----
  h += "var files=[];";
  h += "var drop=document.getElementById('drop'),picker=document.getElementById('picker');";
  h += "var go=document.getElementById('go'),log=document.getElementById('log');";
  h += "var bar=document.getElementById('bar'),fill=bar.querySelector('i');";
  h += "function say(m,c){var d=document.createElement('div');d.textContent=m;if(c)d.className=c;log.appendChild(d);log.scrollTop=log.scrollHeight;}";
  h += "function setFiles(list){files=list.filter(function(f){return f.size>0;});go.disabled=files.length===0;log.innerHTML='';say(files.length+' file(s) ready.');}";
  h += "drop.addEventListener('click',function(){picker.click();});";
  h += "picker.addEventListener('change',function(){setFiles(Array.prototype.slice.call(picker.files));});";
  h += "drop.addEventListener('dragover',function(e){e.preventDefault();drop.classList.add('over');});";
  h += "drop.addEventListener('dragleave',function(){drop.classList.remove('over');});";
  h += "drop.addEventListener('drop',function(e){e.preventDefault();drop.classList.remove('over');";
  h += "var items=e.dataTransfer.items;if(!items){setFiles(Array.prototype.slice.call(e.dataTransfer.files));return;}";
  h += "var entries=[];for(var i=0;i<items.length;i++){var en=items[i].webkitGetAsEntry&&items[i].webkitGetAsEntry();if(en)entries.push(en);}";
  h += "walkAll(entries).then(setFiles);});";
  h += "function walkAll(entries){return Promise.all(entries.map(walk)).then(function(a){return [].concat.apply([],a);});}";
  h += "function walk(entry,base){base=base||'';return new Promise(function(res){";
  h += "if(entry.isFile){entry.file(function(f){f._rel=base+entry.name;res([f]);});}";
  h += "else if(entry.isDirectory){var rd=entry.createReader();var all=[];";
  h += "(function read(){rd.readEntries(function(ents){if(!ents.length){walkAll2(all,base+entry.name+'/').then(res);return;}";
  h += "all=all.concat(Array.prototype.slice.call(ents));read();});})();}else{res([]);}});}";
  h += "function walkAll2(entries,base){return Promise.all(entries.map(function(en){return walk(en,base);})).then(function(a){return [].concat.apply([],a);});}";
  h += "function relOf(f){return f._rel||f.webkitRelativePath||f.name;}";
  h += "go.addEventListener('click',function(){";
  h += "var prefix=(document.getElementById('prefix').value||'').trim().replace(/^\\/+|\\/+$/g,'');";
  h += "if(!prefix){alert('Enter a staging folder name.');return;}";
  h += "go.disabled=true;bar.style.display='block';log.innerHTML='';var done=0,fail=0;";
  h += "function next(i){if(i>=files.length){fill.style.width='100%';say('Finished. '+done+' uploaded, '+fail+' failed.',fail?'err':'ok');go.disabled=false;if(!fail)say('Now tap \"Check what\\'s waiting to publish\" below.');return;}";
  h += "var f=files[i];var rel=relOf(f);var parts=rel.split('/');if(parts.length>1)parts.shift();var sub=parts.join('/');";
  h += "var key=prefix+'/'+sub;var u=api('/put?key='+encodeURIComponent(key));";
  h += "fetch(u,{method:'PUT',body:f}).then(function(r){return r.json();}).then(function(d){";
  h += "if(d.ok){done++;say('OK  '+key,'ok');}else{fail++;say('FAIL '+key+' - '+(d.error||'?'),'err');}";
  h += "}).catch(function(e){fail++;say('FAIL '+key+' - '+e,'err');}).then(function(){fill.style.width=Math.round(((i+1)/files.length)*100)+'%';next(i+1);});}";
  h += "next(0);});";

  // ---- review / publish ----
  h += "var reviewBtn=document.getElementById('review'),reviewOut=document.getElementById('reviewOut');";
  h += "function esc(s){return String(s==null?'':s).replace(/[&<>\"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[c];});}";
  h += "reviewBtn.addEventListener('click',function(){doReview();});";
  h += "function doReview(){reviewOut.innerHTML='<p class=muted>Checking…</p>';var src=(document.getElementById('prefix').value||'_incoming').trim().replace(/^\\/+|\\/+$/g,'');";
  h += "fetch(api('/publish?dry=1&source='+encodeURIComponent(src)),{method:'POST'}).then(function(r){return r.json();}).then(function(d){renderReview(d,src);}).catch(function(e){reviewOut.innerHTML='<p class=err>'+esc(e)+'</p>';});}";
  h += "function renderReview(d,src){";
  h += "if(!d.ok){var extra='';if(d.found_folders)extra='<p class=muted>Found in staging: '+esc(d.found_folders.join(', '))+'</p>';reviewOut.innerHTML='<div class=note><b>Not ready.</b> '+esc(d.error)+extra+'</div>';return;}";
  h += "var p=d.plan;var html='<div class=review>';";
  h += "html+='<div class=big><span class=pill>'+esc(p.season.replace(\"_\",\" \"))+'</span>'+esc(p.display_title)+'</div>';";
  h += "html+='<p style=\"margin:8px 0 0\">'+p.lessons+' lessons · '+p.files_planned+' of '+p.files_total+' files ready to publish</p>';";
  h += "if(p.missing&&p.missing.length){html+='<div class=note><b>'+p.missing.length+' file(s) missing</b> from the upload:<br>';html+=p.missing.slice(0,12).map(function(m){return '· '+esc(m.path);}).join('<br>');if(p.missing.length>12)html+='<br>…and '+(p.missing.length-12)+' more';html+='</div>';}";
  h += "if(p.already_published)html+='<div class=note>'+esc(p.season.replace(\"_\",\" \"))+' is <b>already published</b>. Turn on Replace to overwrite it.</div>';";
  h += "if(p.protected)html+='<div class=note>'+esc(p.season.replace(\"_\",\" \"))+' is a <b>protected</b> quarter. Turn on Replace to overwrite it.</div>';";
  h += "if(p.warnings&&p.warnings.length)html+='<p class=muted style=\"margin-top:8px\">'+p.warnings.map(esc).join('<br>')+'</p>';";
  h += "var needRep=p.already_published||p.protected;";
  h += "if(needRep)html+='<label class=chk><input type=checkbox id=repl> Replace '+esc(p.season.replace(\"_\",\" \"))+' (overwrite what\\'s live)</label>';";
  h += "if(p.missing&&p.missing.length)html+='<label class=chk><input type=checkbox id=allowmiss> Publish anyway, without the missing files</label>';";
  h += "html+='<button id=pubBtn style=\"margin-top:14px\">Publish '+esc(p.season.replace(\"_\",\" \"))+' to teachers</button>';";
  h += "html+='<div id=pubResult></div></div>';";
  h += "reviewOut.innerHTML=html;";
  h += "document.getElementById('pubBtn').addEventListener('click',function(){doPublish(p,src);});";
  h += "}";
  h += "function doPublish(p,src){var rep=document.getElementById('repl');var am=document.getElementById('allowmiss');";
  h += "var q='/publish?source='+encodeURIComponent(src);if(rep&&rep.checked)q+='&replace=1';if(am&&am.checked)q+='&allow_missing=1';";
  h += "var pr=document.getElementById('pubResult');pr.innerHTML='<p class=muted>Publishing…</p>';var btn=document.getElementById('pubBtn');btn.disabled=true;";
  h += "fetch(api(q),{method:'POST'}).then(function(r){return r.json();}).then(function(d){";
  h += "if(d.ok){pr.innerHTML='<p class=ok><b>Published!</b> '+d.files_copied+' file(s) are now live in '+esc(d.published.replace(\"_\",\" \"))+'.</p><p><a href=\"'+d.viewer_url+'\" target=_blank>Open the teacher view →</a></p>';loadLive();}";
  h += "else{btn.disabled=false;pr.innerHTML='<p class=err>'+esc(d.error||'Could not publish.')+'</p>';}";
  h += "}).catch(function(e){btn.disabled=false;pr.innerHTML='<p class=err>'+esc(e)+'</p>';});}";

  // ---- live list ----
  h += "function loadLive(){var el=document.getElementById('liveOut');el.className='muted';el.textContent='Loading…';";
  h += "fetch(api('/seasons'),{method:'GET'}).then(function(r){return r.json();}).then(function(d){";
  h += "if(!d.ok){el.className='err';el.textContent=d.error||'Could not load.';return;}";
  h += "if(!d.seasons.length){el.className='muted';el.textContent='Nothing is published yet.';return;}";
  h += "el.className='';el.innerHTML=d.seasons.map(function(s){var status=s.published?(s.pdf_count+' files'):'<span class=err>no index — not visible</span>';";
  h += "return '<div class=pubrow><span><b>'+esc(s.season.replace(\"_\",\" \"))+'</b>'+(s.protected?' 🔒':'')+'</span><span class=muted>'+status+'</span></div>';}).join('')";
  h += "+'<div style=\"margin-top:12px\"><a href=\"'+d.viewer_url+'\" target=_blank>Open the teacher view →</a></div>';";
  h += "}).catch(function(e){el.className='err';el.textContent=''+e;});}";

  h += "boot();";
  h += "</script></body></html>";
  return h + NL;
}
