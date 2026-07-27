// tab-curriculum-upload — v1.0.0
// Upload box for Sunday School curriculum. Writes into the tab-curriculum R2 bucket.
//
// BINDING REQUIRED: R2 bucket  CURRICULUM -> tab-curriculum   (church account)
//
// ROUTES
//   GET  /health              public, no token. Reports binding status.
//   GET  /?t=TOKEN            upload UI (drag a folder or pick files)
//   PUT  /put?t=TOKEN&key=K   write one object
//   GET  /ls?t=TOKEN&prefix=P list keys
//   GET  /get?t=TOKEN&key=K   read one object back
//
// SAFETY: any key under a PROTECTED prefix is rejected unless allow_overwrite=YES.
// Summer_2026 is protected so a stray upload can never damage the live quarter.

var TOKEN = "2ZKwKD1Ty_9wiyvt3y3bocQsjaIYcRzC";
var VERSION = "1.0.2";
var PROTECTED = ["Summer_2026/"];

function j(data, status) {
  return new Response(JSON.stringify(data, null, 2), {
    status: status || 200,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });
}

function auth(url) {
  var t = url.searchParams.get("t") || "";
  return t === TOKEN;
}

function isProtected(key) {
  for (var i = 0; i < PROTECTED.length; i++) {
    if (key.indexOf(PROTECTED[i]) === 0) return true;
  }
  return false;
}

export default {
  async fetch(request, env) {
    var url = new URL(request.url);
    var path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type"
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

    if (!auth(url)) return j({ ok: false, error: "Bad or missing token." }, 401);
    if (!env.CURRICULUM) return j({ ok: false, error: "CURRICULUM R2 binding missing." }, 500);

    // ---- WRITE ----
    if (path === "/put" && request.method === "PUT") {
      var key = url.searchParams.get("key") || "";
      if (!key) return j({ ok: false, error: "key required" }, 400);
      if (isProtected(key) && url.searchParams.get("allow_overwrite") !== "YES") {
        return j({ ok: false, error: "Refused: '" + key + "' is under a protected prefix.", protected: PROTECTED }, 403);
      }
      var ct = "application/octet-stream";
      var lower = key.toLowerCase();
      if (lower.endsWith(".pdf")) ct = "application/pdf";
      else if (lower.endsWith(".json")) ct = "application/json";
      var body = await request.arrayBuffer();
      if (!body || body.byteLength === 0) return j({ ok: false, error: "empty body" }, 400);
      await env.CURRICULUM.put(key, body, { httpMetadata: { contentType: ct } });
      return j({ ok: true, key: key, size: body.byteLength, content_type: ct });
    }

    // ---- LIST ----
    if (path === "/ls") {
      var prefix = url.searchParams.get("prefix") || "";
      var out = [];
      var cursor = undefined;
      do {
        // NOTE: must NOT be named `page` - a var here hoists over the top-level page() function.
        var listing = await env.CURRICULUM.list({ prefix: prefix, cursor: cursor, limit: 1000 });
        for (var i = 0; i < listing.objects.length; i++) {
          out.push({ key: listing.objects[i].key, size: listing.objects[i].size });
        }
        cursor = listing.truncated ? listing.cursor : undefined;
      } while (cursor);
      return j({ ok: true, count: out.length, prefix: prefix, objects: out });
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

    // ---- UI ----
    if (path === "/" || path === "") {
      return new Response(page(), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    return j({ ok: false, error: "Not found" }, 404);
  }
};

function page() {
  var NL = String.fromCharCode(10);
  var h = "";
  h += "<!DOCTYPE html><html lang='en'><head><meta charset='utf-8'>";
  h += "<meta name='viewport' content='width=device-width, initial-scale=1'>";
  h += "<title>Curriculum Upload</title><style>";
  h += ":root{--brown:#402020;--cross:#6d3d31;--reach:#aac27f;--equip:#ca8342;--cream:#f6f1e7;}";
  h += "*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--cream);color:var(--brown);line-height:1.45}";
  h += "header{background:var(--reach);padding:22px 20px;border-bottom:4px solid var(--cross)}";
  h += "header h1{margin:0;font-size:1.4rem}header p{margin:4px 0 0;font-size:.9rem;opacity:.85}";
  h += "main{max-width:760px;margin:0 auto;padding:20px}";
  h += ".card{background:#fff;border-radius:12px;padding:18px 16px;margin-bottom:18px;box-shadow:0 1px 3px rgba(0,0,0,.08)}";
  h += "label{display:block;font-weight:600;margin-bottom:6px;font-size:.95rem}";
  h += "input[type=text]{width:100%;padding:11px;border:1px solid #ddd;border-radius:8px;font-size:1rem;margin-bottom:14px}";
  h += ".drop{border:3px dashed var(--equip);border-radius:12px;padding:34px 18px;text-align:center;background:#fffdf9;cursor:pointer}";
  h += ".drop.over{background:#fdf0dd}";
  h += ".drop b{display:block;font-size:1.1rem;margin-bottom:6px}";
  h += ".drop span{font-size:.86rem;opacity:.7}";
  h += "button{background:var(--cross);color:#fff;border:0;border-radius:10px;padding:14px 20px;font-size:1rem;font-weight:700;cursor:pointer;width:100%;margin-top:14px}";
  h += "button:disabled{opacity:.5;cursor:default}";
  h += "#log{font-size:.84rem;max-height:340px;overflow-y:auto;margin-top:14px}";
  h += "#log div{padding:4px 0;border-bottom:1px solid #f0eae2}";
  h += ".ok{color:#3f7d20}.err{color:#b3261e;font-weight:600}";
  h += "#bar{height:10px;background:#eee;border-radius:6px;overflow:hidden;margin-top:14px;display:none}";
  h += "#bar i{display:block;height:100%;background:var(--reach);width:0%}";
  h += "</style></head><body>";
  h += "<header><h1>Curriculum Upload</h1><p>Unzip first, then drag the folder in. Nothing goes live until it is checked.</p></header><main>";
  h += "<div class='card'>";
  h += "<label>Drop target</label>";
  h += "<input type='text' id='prefix' value='_incoming' placeholder='_incoming'>";
  h += "<div class='drop' id='drop'><b>Drag the unzipped folder here</b><span>or tap to choose files</span>";
  h += "<input type='file' id='picker' multiple webkitdirectory style='display:none'></div>";
  h += "<button id='go' disabled>Upload</button>";
  h += "<div id='bar'><i></i></div><div id='log'></div>";
  h += "</div></main><script>";
  h += "var TOKEN=new URLSearchParams(location.search).get('t')||'';";
  h += "var files=[];";
  h += "var drop=document.getElementById('drop'),picker=document.getElementById('picker');";
  h += "var go=document.getElementById('go'),log=document.getElementById('log');";
  h += "var bar=document.getElementById('bar'),fill=bar.querySelector('i');";
  h += "function say(m,c){var d=document.createElement('div');d.textContent=m;if(c)d.className=c;log.appendChild(d);log.scrollTop=log.scrollHeight;}";
  h += "function setFiles(list){files=list.filter(function(f){return f.size>0;});";
  h += "go.disabled=files.length===0;log.innerHTML='';say(files.length+' file(s) ready.');}";
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
  h += "if(!prefix){alert('Enter a quarter folder name.');return;}";
  h += "go.disabled=true;bar.style.display='block';log.innerHTML='';";
  h += "var done=0,fail=0;";
  h += "function next(i){if(i>=files.length){fill.style.width='100%';";
  h += "say('Finished. '+done+' uploaded, '+fail+' failed.',fail?'err':'ok');go.disabled=false;return;}";
  h += "var f=files[i];var rel=relOf(f);";
  h += "var parts=rel.split('/');if(parts.length>1)parts.shift();var sub=parts.join('/');";
  h += "var key=prefix+'/'+sub;";
  h += "var u='/put?t='+encodeURIComponent(TOKEN)+'&key='+encodeURIComponent(key);";
  h += "fetch(u,{method:'PUT',body:f}).then(function(r){return r.json();}).then(function(d){";
  h += "if(d.ok){done++;say('OK  '+key,'ok');}else{fail++;say('FAIL '+key+' - '+(d.error||'?'),'err');}";
  h += "}).catch(function(e){fail++;say('FAIL '+key+' - '+e,'err');}).then(function(){";
  h += "fill.style.width=Math.round(((i+1)/files.length)*100)+'%';next(i+1);});}";
  h += "next(0);});";
  h += "</script></body></html>";
  return h + NL;
}
