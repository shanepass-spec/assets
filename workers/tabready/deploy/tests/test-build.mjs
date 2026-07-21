import assert from 'node:assert/strict';
import worker from './worker.build.js';
import bridge from './tabready-legacy-bridge.js';

const te = new TextEncoder();
async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', te.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, te.encode(data));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}
async function makeSession(userId, secret, epoch = 0, expOffset = 3600) {
  const payload = { user_id: userId, epoch, exp: Math.floor(Date.now()/1000) + expOffset };
  const b64 = btoa(JSON.stringify(payload));
  return b64 + '.' + await hmac(secret, b64);
}
function b64url(value){return btoa(String.fromCharCode(...new TextEncoder().encode(value))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');}
async function makeTransfer(payload, secret){const e=b64url(JSON.stringify(payload));return e+'.'+await hmac(secret,e);}
function formRequest(url, data, headers = {}) {
  const body = new URLSearchParams(data);
  return new Request(url, { method:'POST', headers: { 'Content-Type':'application/x-www-form-urlencoded', ...headers }, body });
}

class FakePrepared {
  constructor(db, sql) { this.db=db; this.sql=sql; this.args=[]; }
  bind(...args) { this.args=args; return this; }
  async first() { return this.db.exec(this.sql, this.args, 'first'); }
  async all() { return this.db.exec(this.sql, this.args, 'all'); }
  async run() { return this.db.exec(this.sql, this.args, 'run'); }
}

class FakeD1 {
  constructor() {
    this.columns = {
      users: ['id','email','display_name','is_global_admin','phone','notify_email','hidden','last_login_at','is_photo_approver','can_manage_announcements'],
      magic_links: ['token','user_id','expires_at','used_at']
    };
    this.users = new Map([
      ['usr_admin',{id:'usr_admin',email:'admin@example.org',display_name:'Admin',is_global_admin:1,phone:'',notify_email:1,hidden:0,session_epoch:0,is_photo_approver:0,can_manage_announcements:1}],
      ['usr_leader',{id:'usr_leader',email:'leader@example.org',display_name:'Leader',is_global_admin:0,phone:'',notify_email:1,hidden:0,session_epoch:0,is_photo_approver:0,can_manage_announcements:0}],
      ['usr_member',{id:'usr_member',email:'member@example.org',display_name:'Member',is_global_admin:0,phone:'',notify_email:1,hidden:0,session_epoch:0,is_photo_approver:0,can_manage_announcements:0}],
      ['usr_other',{id:'usr_other',email:'other@example.org',display_name:'Other Person',is_global_admin:0,phone:'',notify_email:1,hidden:0,session_epoch:0,is_photo_approver:0,can_manage_announcements:0}]
    ]);
    this.userRoles = [
      {user_id:'usr_leader',role_id:'children'},
      {user_id:'usr_member',role_id:'children'},
      {user_id:'usr_other',role_id:'youth'}
    ];
    this.roles = [{id:'children',team_lead_user_id:'usr_leader'},{id:'youth',team_lead_user_id:null}];
    this.appSettings = new Map([['canonical_base_url','https://tabready.thetabsrq.net']]);
    this.magicLinks = [];
    this.recovery = [];
    this.transfer = new Map();
    this.limits = new Map();
    this.loginCodes = [];
    this.audit = [];
    this.nextId = 1;
  }
  prepare(sql) { return new FakePrepared(this, sql); }
  norm(sql) { return sql.replace(/\s+/g,' ').trim(); }
  changes(n=1,lastRowId=null){return {success:true,meta:{changes:n,last_row_id:lastRowId}};}
  async exec(sqlRaw,args,mode) {
    const sql=this.norm(sqlRaw);
    // schema
    let m=sql.match(/^PRAGMA table_info\(([^)]+)\)$/i);
    if(m) return {results:(this.columns[m[1]]||[]).map((name,cid)=>({cid,name}))};
    m=sql.match(/^ALTER TABLE (\w+) ADD COLUMN (\w+) (.+)$/i);
    if(m){ if(!this.columns[m[1]])this.columns[m[1]]=[]; if(!this.columns[m[1]].includes(m[2]))this.columns[m[1]].push(m[2]); if(m[1]==='users'&&m[2]==='session_epoch'){for(const u of this.users.values())u.session_epoch??=0;} return this.changes(); }
    if(/^CREATE TABLE IF NOT EXISTS /i.test(sql)||/^CREATE INDEX IF NOT EXISTS /i.test(sql)) return this.changes(0);

    // settings / alternate login
    if(sql.startsWith("SELECT value FROM app_settings WHERE key='canonical_base_url'")) return this.appSettings.has('canonical_base_url')?{value:this.appSettings.get('canonical_base_url')}:null;
    if(sql.startsWith('SELECT value FROM app_settings WHERE key=?')) return this.appSettings.has(args[0])?{value:this.appSettings.get(args[0])}:null;

    // rate limit upsert returning
    if(sql.startsWith('INSERT INTO auth_request_limits')){
      const [key,windowStart,now]=args; const old=this.limits.get(key); const count=old&&old.window_start===windowStart?old.count+1:1; const row={window_start:windowStart,count,updated_at:now}; this.limits.set(key,row); return {count,window_start:windowStart};
    }

    // users lookups
    if(sql.startsWith('SELECT id, email, display_name, session_epoch FROM users WHERE lower(email) = ?')){
      const email=String(args[0]).toLowerCase(); return [...this.users.values()].find(u=>u.email.toLowerCase()===email&&u.hidden===0)||null;
    }
    if(sql.startsWith('SELECT id, email, display_name FROM users WHERE lower(email) = ?')){
      const email=String(args[0]).toLowerCase(); return [...this.users.values()].find(u=>u.email.toLowerCase()===email)||null;
    }
    if(sql.startsWith('SELECT id FROM users WHERE lower(email) = ?')){
      const email=String(args[0]).toLowerCase(); const u=[...this.users.values()].find(u=>u.email.toLowerCase()===email); return u?{id:u.id}:null;
    }
    if(sql.startsWith('SELECT id, email, display_name, is_global_admin, notify_email, is_photo_approver, can_manage_announcements, session_epoch FROM users WHERE id = ?')){
      const u=this.users.get(args[0]); return u&&u.hidden===0?{...u}:null;
    }
    if(sql.startsWith('SELECT id, session_epoch FROM users WHERE id=?')){ const u=this.users.get(args[0]); return u&&u.hidden===0?{id:u.id,session_epoch:u.session_epoch}:null; }
    if(sql.startsWith('SELECT session_epoch FROM users WHERE id=?')){ const u=this.users.get(args[0]); return u?{session_epoch:u.session_epoch}:null; }
    if(sql.startsWith('SELECT id, email, display_name FROM users WHERE id=?')){ const u=this.users.get(args[0]); return u&&u.hidden===0?{id:u.id,email:u.email,display_name:u.display_name}:null; }
    if(sql.startsWith('SELECT id, email, display_name FROM users WHERE id = ?')){ const u=this.users.get(args[0]); return u?{id:u.id,email:u.email,display_name:u.display_name}:null; }
    if(sql.startsWith('SELECT id, display_name, phone FROM users WHERE lower(email) = ?')){ const email=String(args[0]).toLowerCase(); const u=[...this.users.values()].find(u=>u.email.toLowerCase()===email); return u?{id:u.id,display_name:u.display_name,phone:u.phone}:null; }
    if(sql.startsWith('INSERT INTO users (id, email, display_name, is_global_admin, phone, notify_email)')){
      const [id,email,name,adminOrPhone,phoneMaybe]=args;
      let isAdmin=0,phone='';
      if(args.length===5){isAdmin=Number(adminOrPhone);phone=phoneMaybe||'';} else {phone=adminOrPhone||'';}
      this.users.set(id,{id,email,display_name:name,is_global_admin:isAdmin,phone,notify_email:1,hidden:0,session_epoch:0,is_photo_approver:0,can_manage_announcements:0}); return this.changes();
    }
    if(sql.startsWith("UPDATE users SET last_login_at = datetime('now')")){ const u=this.users.get(args[0]); if(u)u.last_login_at='now'; return this.changes(u?1:0); }
    if(sql.startsWith('UPDATE users SET session_epoch=session_epoch+1 WHERE id=?')){const u=this.users.get(args[0]);if(u)u.session_epoch++;return this.changes(u?1:0);}
    if(sql.startsWith('UPDATE users SET display_name = ? WHERE id = ?')){const u=this.users.get(args[1]);if(u)u.display_name=args[0];return this.changes(u?1:0);}
    if(sql.startsWith('UPDATE users SET phone = ? WHERE id = ?')){const u=this.users.get(args[1]);if(u)u.phone=args[0];return this.changes(u?1:0);}

    // roles
    if(sql.startsWith('SELECT role_id FROM user_roles WHERE user_id = ?')) return {results:this.userRoles.filter(r=>r.user_id===args[0]).map(r=>({role_id:r.role_id}))};
    if(sql.startsWith('SELECT id FROM roles WHERE team_lead_user_id = ?')) return {results:this.roles.filter(r=>r.team_lead_user_id===args[0]).map(r=>({id:r.id}))};
    if(sql.startsWith('SELECT 1 AS ok FROM user_roles WHERE user_id=? AND role_id IN (')){const target=args[0],roles=args.slice(1);return this.userRoles.some(r=>r.user_id===target&&roles.includes(r.role_id))?{ok:1}:null;}
    if(sql.startsWith('INSERT OR IGNORE INTO user_roles')){const [user_id,role_id]=args;if(!this.userRoles.some(r=>r.user_id===user_id&&r.role_id===role_id))this.userRoles.push({user_id,role_id});return this.changes();}

    if(sql.startsWith('SELECT id, display_name, email FROM users WHERE hidden=0 AND (display_name LIKE ?')){const q=String(args[0]).replace(/%/g,'').toLowerCase();return {results:[...this.users.values()].filter(u=>u.hidden===0&&(u.display_name.toLowerCase().includes(q)||u.email.toLowerCase().includes(q))).slice(0,30).map(u=>({id:u.id,display_name:u.display_name,email:u.email}))};}
    if(sql.startsWith('SELECT DISTINCT u.id, u.display_name, u.email FROM users u JOIN user_roles')){const q=String(args.at(-2)).replace(/%/g,'').toLowerCase();const roles=args.slice(0,-2);const ids=new Set(this.userRoles.filter(r=>roles.includes(r.role_id)).map(r=>r.user_id));return {results:[...this.users.values()].filter(u=>ids.has(u.id)&&u.hidden===0&&(u.display_name.toLowerCase().includes(q)||u.email.toLowerCase().includes(q))).slice(0,30).map(u=>({id:u.id,display_name:u.display_name,email:u.email}))};}

    // recovery requests
    if(sql.startsWith("SELECT id FROM recovery_requests WHERE user_id=? AND status='pending'")){return this.recovery.find(r=>r.user_id===args[0]&&r.status==='pending')||null;}
    if(sql.startsWith("INSERT INTO recovery_requests (id, user_id, requested_email, status)")){this.recovery.push({id:args[0],user_id:args[1],requested_email:args[2],status:'pending',created_at:Math.floor(Date.now()/1000),updated_at:Math.floor(Date.now()/1000)});return this.changes();}
    if(sql.startsWith('UPDATE recovery_requests SET updated_at=unixepoch(), requested_email=?')){const r=this.recovery.find(r=>r.id===args[1]);if(r){r.requested_email=args[0];r.updated_at=Math.floor(Date.now()/1000);}return this.changes(r?1:0);}
    if(sql.startsWith("SELECT rr.id, rr.user_id, rr.requested_email, rr.status")){const rows=this.recovery.filter(r=>r.status==='pending').map(r=>({...r,display_name:this.users.get(r.user_id).display_name,email:this.users.get(r.user_id).email}));return {results:rows};}
    if(sql.startsWith("SELECT DISTINCT rr.id, rr.user_id")){const led=args;const rows=this.recovery.filter(r=>r.status==='pending'&&this.userRoles.some(ur=>ur.user_id===r.user_id&&led.includes(ur.role_id))).map(r=>({...r,display_name:this.users.get(r.user_id).display_name,email:this.users.get(r.user_id).email}));return {results:rows};}
    if(sql.startsWith("SELECT rr.id, rr.user_id, rr.status, u.email, u.display_name")){const r=this.recovery.find(r=>r.id===args[0]);if(!r)return null;const u=this.users.get(r.user_id);return {id:r.id,user_id:r.user_id,status:r.status,email:u.email,display_name:u.display_name};}
    if(sql.startsWith("UPDATE recovery_requests SET status='issuing'")){const r=this.recovery.find(r=>r.id===args[1]&&r.status==='pending');if(r){r.status='issuing';r.resolved_by=args[0];}return this.changes(r?1:0);}
    if(sql.startsWith("UPDATE recovery_requests SET status='pending', resolved_by=NULL")){const r=this.recovery.find(r=>r.id===args[0]&&r.status==='issuing');if(r){r.status='pending';r.resolved_by=null;}return this.changes(r?1:0);}
    if(sql.startsWith("UPDATE recovery_requests SET status='issued'")){const r=this.recovery.find(r=>r.id===args[0]&&r.status==='issuing');if(r){r.status='issued';}return this.changes(r?1:0);}

    // magic links
    if(sql.startsWith('UPDATE magic_links SET used_at=unixepoch() WHERE user_id=?')){let n=0;for(const l of this.magicLinks){if(l.user_id===args[0]&&!l.used_at){l.used_at=Math.floor(Date.now()/1000);n++;}}return this.changes(n);}
    if(sql.startsWith('UPDATE magic_links SET used_at = unixepoch() WHERE user_id = ?')){let n=0;for(const l of this.magicLinks){if(l.user_id===args[0]&&!l.used_at){l.used_at=Math.floor(Date.now()/1000);n++;}}return this.changes(n);}
    if(sql.startsWith("INSERT INTO magic_links (token, user_id, expires_at, purpose, issued_by, revoke_sessions)")){const row={id:this.nextId++,token:args[0],user_id:args[1],expires_at:args[2],purpose:'restore',issued_by:args[3],revoke_sessions:Number(args[4]),used_at:null};this.magicLinks.push(row);return this.changes(1,row.id);}
    if(sql.startsWith('INSERT INTO magic_links (token, user_id, expires_at)')){const row={id:this.nextId++,token:args[0],user_id:args[1],expires_at:args[2],purpose:'login',issued_by:null,revoke_sessions:0,used_at:null};this.magicLinks.push(row);return this.changes(1,row.id);}
    if(sql.startsWith('SELECT token, user_id, expires_at, used_at, purpose')){const l=this.magicLinks.find(l=>l.token===args[0]);return l?{...l}:null;}
    if(sql.startsWith('UPDATE magic_links SET used_at = unixepoch() WHERE token = ? AND used_at IS NULL')){const l=this.magicLinks.find(l=>l.token===args[0]&&!l.used_at);if(l)l.used_at=Math.floor(Date.now()/1000);return this.changes(l?1:0);}
    if(sql.startsWith('UPDATE magic_links SET used_at = unixepoch() WHERE token = ?')){const l=this.magicLinks.find(l=>l.token===args[0]);if(l)l.used_at=Math.floor(Date.now()/1000);return this.changes(l?1:0);}

    // transfer replay store
    if(sql.startsWith('INSERT OR IGNORE INTO transfer_jti')){const [hash,user_id,expires_at]=args;if(this.transfer.has(hash))return this.changes(0);this.transfer.set(hash,{user_id,expires_at});return this.changes(1);}
    if(sql.startsWith('DELETE FROM transfer_jti')) return this.changes(0);

    // login codes
    if(sql.startsWith('UPDATE login_codes SET used_at = unixepoch() WHERE user_id = ?')){let n=0;for(const c of this.loginCodes){if(c.user_id===args[0]&&!c.used_at){c.used_at=Math.floor(Date.now()/1000);n++;}}return this.changes(n);}
    if(sql.startsWith('INSERT INTO login_codes')){this.loginCodes.push({id:this.nextId++,user_id:args[0],code:args[1],expires_at:args[2],used_at:null,attempts:0});return this.changes();}
    if(sql.startsWith('SELECT id, code, expires_at, used_at, attempts FROM login_codes')){return [...this.loginCodes].reverse().find(c=>c.user_id===args[0]&&!c.used_at)||null;}
    if(sql.startsWith('UPDATE login_codes SET used_at = unixepoch() WHERE id = ?')){const c=this.loginCodes.find(c=>c.id===args[0]);if(c)c.used_at=Math.floor(Date.now()/1000);return this.changes(c?1:0);}
    if(sql.startsWith('UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?')){const c=this.loginCodes.find(c=>c.id===args[0]);if(c)c.attempts++;return this.changes(c?1:0);}

    // audit
    if(sql.startsWith('INSERT INTO audit_log_v2')){this.audit.push({kind:'v2',args});return this.changes();}
    if(sql.startsWith('INSERT INTO audit_log ')){this.audit.push({kind:'v1',args});return this.changes();}

    throw new Error('FakeD1 unsupported SQL ['+mode+']: '+sql+' args='+JSON.stringify(args));
  }
}

const db=new FakeD1();
const env={
  DB:db,
  SESSION_SECRET:'media-session-secret',
  SESSION_TRANSFER_SECRET:'transfer-secret',
  CANONICAL_BASE_URL:'https://tabready.thetabsrq.net',
  RESEND_API_KEY:'test',
  RESEND_FROM:'TabReady <tabready@thetabsrq.net>'
};
const originalFetch=globalThis.fetch;
globalThis.fetch=async function(input,init){
  const u=typeof input==='string'?input:input.url;
  if(u.startsWith('https://api.resend.com/')) return new Response(JSON.stringify({id:'mail_test'}),{status:200,headers:{'Content-Type':'application/json'}});
  return originalFetch(input,init);
};

let issuedRestoreToken='';
const results=[];
async function test(name,fn){try{await fn();results.push(['PASS',name]);}catch(e){results.push(['FAIL',name,e.stack||String(e)]);}}

await test('health reports exact candidate and immutable baseline',async()=>{
  const r=await worker.fetch(new Request('https://tabready.test/health'),env,{}); const d=await r.json();
  assert.equal(d.version,'2.9.290'); assert.equal(d.baseline_sha256,'6aae0ec256efd5cf1c8db6eb093f7d62b859b1b4493643c9260a3bde2c60211b');
});

await test('login page exposes first-class Restore Access path',async()=>{
  const r=await worker.fetch(new Request('https://tabready.test/login'),env,{}); const t=await r.text();
  assert.match(t,/I previously had TabReady/); assert.match(t,/\/auth\/recovery\/request/);
});

await test('pre-upgrade epoch-less sessions remain valid at epoch zero',async()=>{
  const payload={user_id:'usr_other',exp:Math.floor(Date.now()/1000)+3600}; const b64=btoa(JSON.stringify(payload)); const token=b64+'.'+await hmac(env.SESSION_SECRET,b64);
  const r=await worker.fetch(new Request('https://tabready.test/api/me',{headers:{Cookie:'tabready_session='+token}}),env,{}); assert.equal(r.status,200);
});

await test('self session revocation invalidates the prior cookie',async()=>{
  const cookie=await makeSession('usr_other',env.SESSION_SECRET,0);
  const revoke=await worker.fetch(new Request('https://tabready.test/api/me/revoke-sessions',{method:'POST',headers:{Cookie:'tabready_session='+cookie}}),env,{}); assert.equal(revoke.status,200); assert.equal(db.users.get('usr_other').session_epoch,1);
  const old=await worker.fetch(new Request('https://tabready.test/api/me',{headers:{Cookie:'tabready_session='+cookie}}),env,{}); assert.equal(old.status,401);
});

await test('recovery request is neutral and creates one pending request',async()=>{
  const req=new Request('https://tabready.test/auth/recovery/request',{method:'POST',headers:{'Content-Type':'application/json','CF-Connecting-IP':'203.0.113.10'},body:JSON.stringify({email:'member@example.org'})});
  const r=await worker.fetch(req,env,{}); const d=await r.json(); assert.equal(r.status,200); assert.equal(d.ok,true); assert.equal(db.recovery.length,1);
  const req2=new Request('https://tabready.test/auth/recovery/request',{method:'POST',headers:{'Content-Type':'application/json','CF-Connecting-IP':'203.0.113.10'},body:JSON.stringify({email:'member@example.org'})});
  await worker.fetch(req2,env,{}); assert.equal(db.recovery.length,1);
  const unknown=new Request('https://tabready.test/auth/recovery/request',{method:'POST',headers:{'Content-Type':'application/json','CF-Connecting-IP':'203.0.113.11'},body:JSON.stringify({email:'unknown@example.org'})});
  const ur=await worker.fetch(unknown,env,{}); const ud=await ur.json(); assert.equal(ud.ok,true); assert.equal(db.recovery.length,1);
});

await test('Restore Access page is discoverable to leaders and search stays ministry-scoped',async()=>{
  const cookie=await makeSession('usr_leader',env.SESSION_SECRET,0);
  const page=await worker.fetch(new Request('https://tabready.test/restore-access',{headers:{Cookie:'tabready_session='+cookie}}),env,{}); const text=await page.text();
  assert.equal(page.status,200); assert.match(text,/Requests waiting for help/); assert.match(text,/Find an existing person/);
  const sr=await worker.fetch(new Request('https://tabready.test/api/restore/search?q=mem',{headers:{Cookie:'tabready_session='+cookie}}),env,{}); const sd=await sr.json();
  assert.equal(sd.people.length,1); assert.equal(sd.people[0].id,'usr_member');
  const other=await worker.fetch(new Request('https://tabready.test/api/restore/search?q=other',{headers:{Cookie:'tabready_session='+cookie}}),env,{}); const od=await other.json(); assert.equal(od.people.length,0);
});

await test('ordinary members cannot open or call Restore Access management',async()=>{
  const cookie=await makeSession('usr_member',env.SESSION_SECRET,0);
  const page=await worker.fetch(new Request('https://tabready.test/restore-access',{headers:{Cookie:'tabready_session='+cookie}}),env,{}); assert.equal(page.status,403);
  const api=await worker.fetch(new Request('https://tabready.test/api/restore/search?q=mem',{headers:{Cookie:'tabready_session='+cookie}}),env,{}); assert.equal(api.status,403);
});

await test('leader sees in-scope request and issues canonical one-hour restore credential',async()=>{
  const cookie=await makeSession('usr_leader',env.SESSION_SECRET,0);
  const list=await worker.fetch(new Request('https://tabready.test/api/recovery-requests',{headers:{Cookie:'tabready_session='+cookie}}),env,{}); const ld=await list.json();
  assert.equal(ld.requests.length,1); const id=ld.requests[0].id;
  const issue=await worker.fetch(new Request('https://tabready.test/api/recovery-requests/'+id+'/issue',{method:'POST',headers:{Cookie:'tabready_session='+cookie,'Content-Type':'application/json'},body:JSON.stringify({revoke_old_sessions:true})}),env,{});
  const d=await issue.json(); assert.equal(issue.status,200); assert.match(d.login_url,/^https:\/\/tabready\.thetabsrq\.net\/auth\/verify\?token=/);
  issuedRestoreToken=new URL(d.login_url).searchParams.get('token');
  const link=db.magicLinks.at(-1); assert.equal(link.purpose,'restore'); assert.equal(link.revoke_sessions,1); assert.match(link.token,/^sha256:/); assert.notEqual(link.token,issuedRestoreToken); assert.equal(link.expires_at-Math.floor(Date.now()/1000)>3500,true);
});

await test('restore credential preserves user and revokes older sessions when consumed',async()=>{
  const link=db.magicLinks.at(-1); const beforeUsers=db.users.size;
  const r=await worker.fetch(formRequest('https://tabready.thetabsrq.net/auth/verify',{token:issuedRestoreToken}),env,{});
  assert.equal(r.status,302); assert.equal(db.users.size,beforeUsers); assert.equal(db.users.get('usr_member').session_epoch,1); assert.match(r.headers.get('set-cookie'),/tabready_session=/);
  const replay=await worker.fetch(formRequest('https://tabready.thetabsrq.net/auth/verify',{token:issuedRestoreToken}),env,{}); assert.equal(replay.status,400);
});

await test('restore credential consume is atomic under concurrent replay',async()=>{
  const leaderCookie=await makeSession('usr_leader',env.SESSION_SECRET,0);
  const issue=await worker.fetch(new Request('https://tabready.test/api/restore/usr_member',{method:'POST',headers:{Cookie:'tabready_session='+leaderCookie,'Content-Type':'application/json'},body:JSON.stringify({revoke_old_sessions:false})}),env,{});
  const d=await issue.json(); const token=new URL(d.login_url).searchParams.get('token');
  const [a,b]=await Promise.all([
    worker.fetch(formRequest('https://tabready.thetabsrq.net/auth/verify',{token}),env,{}),
    worker.fetch(formRequest('https://tabready.thetabsrq.net/auth/verify',{token}),env,{})
  ]);
  assert.deepEqual([a.status,b.status].sort((x,y)=>x-y),[302,400]);
});

await test('admin Add Person credential is seven days and uses canonical host',async()=>{
  const cookie=await makeSession('usr_admin',env.SESSION_SECRET,0);
  const r=await worker.fetch(new Request('https://old.example/api/admin/users',{method:'POST',headers:{Cookie:'tabready_session='+cookie,'Content-Type':'application/json'},body:JSON.stringify({name:'New Person',email:'new@example.org',roles:['children']})}),env,{});
  const d=await r.json(); assert.equal(r.status,200); assert.match(d.login_url,/^https:\/\/tabready\.thetabsrq\.net/);
  const link=db.magicLinks.at(-1); const ttl=link.expires_at-Math.floor(Date.now()/1000); assert(ttl>6.9*86400&&ttl<=7*86400);
});

await test('verified alternate email can request and complete code login',async()=>{
  db.appSettings.set('login_alt:alternate@example.org','usr_member');
  const req=new Request('https://tabready.test/auth/code/request',{method:'POST',headers:{'Content-Type':'application/json','CF-Connecting-IP':'198.51.100.44'},body:JSON.stringify({email:'alternate@example.org'})});
  const sent=await worker.fetch(req,env,{}); assert.equal(sent.status,200); const code=db.loginCodes.at(-1).code;
  const verify=await worker.fetch(new Request('https://tabready.test/auth/code/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'alternate@example.org',code})}),env,{});
  assert.equal(verify.status,200); assert.match(verify.headers.get('set-cookie'),/tabready_session=/);
});

await test('code requests are rate limited without revealing account existence',async()=>{
  const before=db.loginCodes.length; let last;
  for(let i=0;i<7;i++){
    const req=new Request('https://tabready.test/auth/code/request',{method:'POST',headers:{'Content-Type':'application/json','CF-Connecting-IP':'198.51.100.2'},body:JSON.stringify({email:'member@example.org'})});
    last=await worker.fetch(req,env,{}); assert.equal(last.status,200);
  }
  assert.equal(db.loginCodes.length-before,5);
});

await test('legacy bridge uses POST-body handoff and preserves path+query',async()=>{
  const legacySecret='legacy-session-secret';
  const legacyCookie=await makeSession('usr_admin',legacySecret,0);
  const br=await bridge.fetch(new Request('https://tabready.shanepass.workers.dev/directory?x=1',{headers:{Cookie:'tabready_session='+legacyCookie}}),{LEGACY_SESSION_SECRET:legacySecret,SESSION_TRANSFER_SECRET:env.SESSION_TRANSFER_SECRET,CANONICAL_BASE_URL:env.CANONICAL_BASE_URL});
  assert.equal(br.status,200); const html=await br.text(); assert.match(html,/method="POST"/); assert.doesNotMatch(html,/__xfer=/); assert.match(html,/auth\/transfer\/consume/);
  const token=html.match(/name="transfer_token" value="([^"]+)"/)[1];
  const consumed=await worker.fetch(formRequest('https://tabready.thetabsrq.net/auth/transfer/consume',{transfer_token:token}),env,{});
  assert.equal(consumed.status,303); assert.equal(consumed.headers.get('location'),'/directory?x=1'); assert.match(consumed.headers.get('set-cookie'),/tabready_session=/);
  const replay=await worker.fetch(formRequest('https://tabready.thetabsrq.net/auth/transfer/consume',{transfer_token:token}),env,{}); assert.equal(replay.status,400);
});

await test('transfer rejects wrong audience, expiry, and revoked epoch',async()=>{
  const now=Math.floor(Date.now()/1000);
  const base={purpose:'session_transfer',user_id:'usr_other',epoch:0,source_host:'old.example',dest_path:'/directory',iat:now,exp:now+60,jti:crypto.randomUUID()};
  const wrongAud=await makeTransfer({...base,aud:'https://wrong.example'},env.SESSION_TRANSFER_SECRET);
  const wr=await worker.fetch(formRequest('https://tabready.thetabsrq.net/auth/transfer/consume',{transfer_token:wrongAud}),env,{}); assert.equal(wr.status,400);
  const expired=await makeTransfer({...base,aud:'https://tabready.thetabsrq.net',iat:now-120,exp:now-60,jti:crypto.randomUUID()},env.SESSION_TRANSFER_SECRET);
  const er=await worker.fetch(formRequest('https://tabready.thetabsrq.net/auth/transfer/consume',{transfer_token:expired}),env,{}); assert.equal(er.status,400);
  const revoked=await makeTransfer({...base,user_id:'usr_member',epoch:0,aud:'https://tabready.thetabsrq.net',jti:crypto.randomUUID()},env.SESSION_TRANSFER_SECRET);
  const rr=await worker.fetch(formRequest('https://tabready.thetabsrq.net/auth/transfer/consume',{transfer_token:revoked}),env,{}); assert.equal(rr.status,400);
});

await test('legacy bridge is redirect-only for anonymous traffic and rejects writes',async()=>{
  const benv={LEGACY_SESSION_SECRET:'legacy',SESSION_TRANSFER_SECRET:env.SESSION_TRANSFER_SECRET,CANONICAL_BASE_URL:env.CANONICAL_BASE_URL};
  const anon=await bridge.fetch(new Request('https://tabready.shanepass.workers.dev/auth/verify?token=abc'),benv); assert.equal(anon.status,302); assert.equal(anon.headers.get('location'),'https://tabready.thetabsrq.net/auth/verify?token=abc');
  const authPost=await bridge.fetch(formRequest('https://tabready.shanepass.workers.dev/auth/verify',{token:'abc'}),benv); assert.equal(authPost.status,307); assert.equal(authPost.headers.get('location'),'https://tabready.thetabsrq.net/auth/verify');
  const write=await bridge.fetch(new Request('https://tabready.shanepass.workers.dev/api/notes',{method:'POST',body:'x'}),benv); assert.equal(write.status,409);
});

for(const r of results) console.log(r[0],'-',r[1],r[2]?'\n'+r[2]:'');
const failed=results.filter(r=>r[0]==='FAIL');
if(failed.length){console.error('\n'+failed.length+' test(s) failed');process.exit(1);}else console.log('\nAll '+results.length+' tests passed.');
