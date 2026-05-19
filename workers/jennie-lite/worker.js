// jennie-lite-v4.js
// Jennie Lite — Role-scoped operational interface for Living Nativity field leaders
// Standalone worker. Does not touch jennie-gateway or compass-api.

// ── ROLE CONFIG ────────────────────────────────────────────────────────────────
const ROLE_CONFIG = {
  safety_lead: {
    name: "Safety Lead",
    packets: ["LN-2026-004", "LN-2026-007", "LN-2026-009", "LN-2026-010", "LN-2026-CODES", "LN-2026-ZONES"],
    zones: ["Alpha", "Bravo", "Charlie", "Delta", "Echo"],
    actions: ["VIEW_INCIDENTS", "CREATE_INCIDENT", "UPDATE_INCIDENT", "CLEAR_INCIDENT", "SET_ZONE_STATUS", "REQUEST_COMMAND_ALERT"]
  },
  parking_lead: {
    name: "Parking Lead",
    packets: ["LN-2026-003", "LN-2026-005", "LN-2026-007", "LN-2026-CODES", "LN-2026-ZONES"],
    zones: ["Alpha", "Bravo", "Echo"],
    actions: ["VIEW_INCIDENTS", "SET_ZONE_STATUS"]
  },
  hospitality_lead: {
    name: "Hospitality Lead",
    packets: ["LN-2026-004", "LN-2026-006", "LN-2026-008", "LN-2026-CODES", "LN-2026-ZONES"],
    zones: ["Charlie", "Echo"],
    actions: ["VIEW_INCIDENTS", "SET_ZONE_STATUS"]
  }
};

// ── PACKET DATA ────────────────────────────────────────────────────────────────
const PACKETS = {
  "LN-2026-003": {
    id: "LN-2026-003",
    title: "Parking Zone Operations",
    purpose: "Ensure smooth vehicle flow and maximum lot usage by executing the Two-Person Directed Handoff system.",
    core_rules: [
      "Maintain Two-Person Rule at all times — Entry Director and Spotter always active together.",
      "Direct every vehicle to a specific parking space. No free parking.",
      "Youth Building is ADA Overflow — NO PARKING at all times.",
      "Control flow direction: inflow vs outflow. Never both at once.",
      "Report zone capacity at 80% to Command immediately."
    ],
    triggers: [
      "Gates open — start inflow.",
      "Zone reaches 80-90% capacity — prepare overflow activation.",
      "Show ends — switch all lanes to outflow."
    ],
    failure_risks: [
      "Traffic congestion and lost parking capacity.",
      "Vehicle and pedestrian safety conflicts.",
      "ADA access blocked or compromised."
    ]
  },
  "LN-2026-004": {
    id: "LN-2026-004",
    title: "Safety Lead Operations",
    purpose: "Serve as the primary authority for campus safety, medical response, and emergency radio discipline.",
    core_rules: [
      "Channel 1 is for safety traffic only. Protect it.",
      "First Aid station must be visible and staffed before gates open.",
      "Cast Only doors are restricted. Door Team enforces at all times.",
      "Initiate 911 calls alongside Command — never alone.",
      "Log every incident with time, severity, and outcome."
    ],
    triggers: [
      "6:00 PM safety deployment briefing.",
      "Any medical alert, injury, missing child, or safety breach.",
      "Major equipment failure, fire, or power-related hazard."
    ],
    failure_risks: [
      "Delayed emergency response from radio clutter.",
      "Conflicting 911 calls causing responder confusion.",
      "Uncontrolled guest access into restricted areas.",
      "Missed incident documentation."
    ]
  },
  "LN-2026-005": {
    id: "LN-2026-005",
    title: "Parking Equipment and Tools",
    purpose: "Ensure all parking team equipment is ready, charged, and deployed before gates open.",
    core_rules: [
      "All radios charged and checked before 5:30 PM.",
      "LED wands and clip lights distributed to every parking post.",
      "Cones and signage placed before volunteer deployment.",
      "All equipment returned and charging at close of each night."
    ],
    triggers: [
      "5:30 PM pre-open equipment check.",
      "Any wand, radio, or light failure during operations.",
      "End of night — recover all equipment before release."
    ],
    failure_risks: [
      "Uncharged radios reducing communication range.",
      "Missing wands reducing visibility in dark zones.",
      "Equipment left outside overnight."
    ]
  },
  "LN-2026-006": {
    id: "LN-2026-006",
    title: "Hospitality Operations",
    purpose: "Steward the guest refreshment and welcome experience through safe food service, steady supply flow, and clear team communication.",
    core_rules: [
      "Server-only distribution. Guests do not self-serve.",
      "Hot beverage and propane areas must have visible safety boundaries.",
      "Confirm vendor readiness 48 hours before each event night.",
      "Stations close cleanly — non-perishables secured at end of night."
    ],
    triggers: [
      "48-hour vendor confirmation window.",
      "Guest arrival surge — shift to high-volume serving mode.",
      "Post-show outflow surge — manage final touchpoints.",
      "Low inventory — trigger restock runner immediately."
    ],
    failure_risks: [
      "Food contamination from guest self-service.",
      "Empty stations from failed vendor confirmation.",
      "Guest flow blockages near service areas.",
      "Volunteer confusion from weak pre-event communication."
    ]
  },
  "LN-2026-007": {
    id: "LN-2026-007",
    title: "Radio Protocol",
    purpose: "Maintain clean, effective radio communication across all teams during the event.",
    core_rules: [
      "Channel 1: Safety only.",
      "Channel 2: Parking and Hospitality.",
      "Channel 4: Command and Ops coordination.",
      "Keep transmissions short, calm, and directive.",
      "Announce your role before your message."
    ],
    triggers: [
      "Any safety emergency — move to Channel 1 immediately.",
      "Radio silence order from Safety Lead — clear the channel.",
      "End of night — return all radios to charging station."
    ],
    failure_risks: [
      "Cross-channel chatter blocking emergency traffic.",
      "Unreturned or uncharged radios at next event night.",
      "Long transmissions blocking urgent calls."
    ]
  },
  "LN-2026-008": {
    id: "LN-2026-008",
    title: "Hospitality Team Setup",
    purpose: "Ensure hospitality stations are fully ready before guest arrival.",
    core_rules: [
      "All stations set up and safety boundaries in place by 6:00 PM.",
      "Volunteers briefed and at posts by 6:10 PM.",
      "Serving supplies counted and restocked before gates open.",
      "Hot water and propane areas marked with boundary cones."
    ],
    triggers: [
      "5:30 PM hospitality setup call.",
      "Any volunteer no-show — reassign before 6:10 PM.",
      "Supply count below minimum — call runner immediately."
    ],
    failure_risks: [
      "Unmanned stations at guest arrival.",
      "Hot zone without safety boundaries.",
      "Volunteers unclear on serving method."
    ]
  },
  "LN-2026-009": {
    id: "LN-2026-009",
    title: "Emergency Response Procedures",
    purpose: "Ensure rapid and coordinated emergency response for all Code situations.",
    core_rules: [
      "Code Blue (Medical): Channel 1 priority. Safety Lead responds. Coordinate EMS via DeSoto Entry.",
      "Code Pink (Missing Person): Hold exits. Assign sweep teams by zone. Maintain calm.",
      "Code Red (Fire/Danger): Immediate evacuation. Safety Lead assumes command. Sheriff controls perimeter.",
      "Code Silver (Disruptive Guest): Quiet escalation to Sheriff. Avoid public confrontation."
    ],
    triggers: [
      "Any injury, health emergency, or Code Blue report.",
      "Missing child or vulnerable adult — Code Pink.",
      "Fire, structural failure, or life threat — Code Red.",
      "Aggressive or escalating guest behavior — Code Silver."
    ],
    failure_risks: [
      "Delayed Code activation from hesitation.",
      "Multiple conflicting 911 calls.",
      "Exit blockage during Code Red evacuation.",
      "Public confrontation escalating Code Silver."
    ]
  },
  "LN-2026-010": {
    id: "LN-2026-010",
    title: "Safety Gear and Deployment",
    purpose: "Ensure all safety equipment is ready, distributed, and recovered each night.",
    core_rules: [
      "Safety Office at Blue Awning is the gear hub.",
      "High-visibility vests distributed before 6:00 PM.",
      "Master contact list must be on Safety Lead at all times.",
      "First Aid location known by all team leads.",
      "All gear recovered and inventoried at close."
    ],
    triggers: [
      "5:30 PM gear distribution from Blue Awning.",
      "Any gear failure or shortage during event.",
      "End of night — full gear recovery before release."
    ],
    failure_risks: [
      "Missing vests reducing team visibility.",
      "Safety Lead without contact list.",
      "First Aid location unknown to responders."
    ]
  },
  "LN-2026-CODES": {
    id: "LN-2026-CODES",
    title: "Incident Codes Reference",
    purpose: "Quick reference for all event incident codes.",
    core_rules: [
      "CODE BLUE: Medical or injury. Channel 1. Safety Lead responds. EMS via DeSoto Entry.",
      "CODE PINK: Missing person. Hold exits. Sweep by zone. Stay calm.",
      "CODE RED: Fire or immediate danger. Evacuate immediately. Sheriff perimeter.",
      "CODE SILVER: Disruptive guest. Quiet escalation to Sheriff. No public confrontation."
    ],
    triggers: [
      "Any emergency situation requiring coordinated response.",
      "Use the code — do not describe the situation on open radio."
    ],
    failure_risks: [
      "Using plain language instead of codes on radio.",
      "Hesitating to call a code due to uncertainty."
    ]
  },
  "LN-2026-ZONES": {
    id: "LN-2026-ZONES",
    title: "Zone Map Reference",
    purpose: "Quick reference for all campus zones and their responsibilities.",
    core_rules: [
      "Alpha (DeSoto Entry): Sheriff and Parking Lead. Vehicle/pedestrian handoff from street.",
      "Bravo (Parking): Parking Team. Gridlock prevention and ADA access.",
      "Charlie (Guest Village): Hospitality Lead. Crowd surge and food safety.",
      "Delta (Production/Backstage): Production Lead. Rigging and Angel Lift access.",
      "Echo (Mobility Path): Cart Ops. ADA shuttle and pedestrian safety in dark zones."
    ],
    triggers: [
      "Zone status change — report to Command immediately.",
      "Zone capacity issue — escalate before crisis point."
    ],
    failure_risks: [
      "Zone confusion causing wrong team to respond.",
      "Unmonitored zone during peak periods."
    ]
  }
};

// ── EVENT PHASE DATA ───────────────────────────────────────────────────────────
const EVENT_PHASES = [
  { phase: "PRE-OPEN", time: "5:30 PM – 6:15 PM", description: "Setup, gear distribution, volunteer deployment to posts." },
  { phase: "INFLOW", time: "6:15 PM – 7:30 PM", description: "Guest arrival, parking, hospitality service, ADA shuttle." },
  { phase: "SHOW", time: "7:30 PM – 8:15 PM", description: "Show-time lockout. Safety priority. Minimal movement." },
  { phase: "OUTFLOW", time: "8:15 PM – 9:00 PM", description: "All lanes switch to exit. Right-turn bias to DeSoto." },
  { phase: "CLOSE", time: "9:00 PM – 10:00 PM", description: "Recover gear, sweep, charge equipment, sign off." }
];

// ── JWT UTILITIES ──────────────────────────────────────────────────────────────
async function createJWT(payload, secret) {
  const header = { alg: "HS256", typ: "JWT" };
  const enc = (obj) => btoa(JSON.stringify(obj)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const data = enc(header) + "." + enc(payload);
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  return data + "." + sigB64;
}

async function verifyJWT(token, secret) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const data = parts[0] + "." + parts[1];
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
    );
    const sig = Uint8Array.from(atob(parts[2].replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify("HMAC", key, sig, new TextEncoder().encode(data));
    if (!valid) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

function getToken(request) {
  const auth = request.headers.get("Authorization") || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  return null;
}

// ── EMAIL ALERTS ───────────────────────────────────────────────────────────────
async function sendIncidentAlert(incident, env) {
  const apiKey = env.RESEND_API_KEY || 're_5K7BKMUV_Jb7omEQQKRhUkQPbPF3ZPCXX';
  // Recipients: set ALERT_EMAILS env var as comma-separated list to override
  const defaultEmails = 'spass@thetabsarasota.org,tabsafetyteam@gmail.com,jschmidt@thetabsarasota.org';
  const emailList = env.ALERT_EMAILS || defaultEmails;
  const recipients = emailList.split(',').map(e => e.trim()).filter(Boolean);

  const zoneLabels = {
    Alpha: 'Alpha — DeSoto Entry',
    Bravo: 'Bravo — Parking',
    Charlie: 'Charlie — Guest Village',
    Delta: 'Delta — Production/Backstage',
    Echo: 'Echo — Mobility Path'
  };

  const time = new Date(incident.timestamp).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York'
  });

  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:500px;margin:0 auto;padding:24px;background:#0a0a0f;color:#e2e2f0;border-radius:12px">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:#6366f1;margin-bottom:8px">JENNIE LITE — INCIDENT ALERT</div>
      <div style="font-size:22px;font-weight:700;color:#ef4444;margin-bottom:16px">${incident.code}</div>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:8px 0;color:#888;font-size:13px;width:100px">Zone</td><td style="padding:8px 0;font-size:14px">${zoneLabels[incident.zone] || incident.zone}</td></tr>
        <tr><td style="padding:8px 0;color:#888;font-size:13px">Description</td><td style="padding:8px 0;font-size:14px">${incident.description}</td></tr>
        <tr><td style="padding:8px 0;color:#888;font-size:13px">Reported By</td><td style="padding:8px 0;font-size:14px">${incident.reported_by.replace('_', ' ').toUpperCase()}</td></tr>
        <tr><td style="padding:8px 0;color:#888;font-size:13px">Time</td><td style="padding:8px 0;font-size:14px">${time} ET</td></tr>
        <tr><td style="padding:8px 0;color:#888;font-size:13px">Incident ID</td><td style="padding:8px 0;font-size:12px;color:#888">${incident.id}</td></tr>
      </table>
      <div style="margin-top:20px;padding:12px;background:#1e1e2e;border-radius:8px;font-size:12px;color:#888">
        Log in to Jennie Lite to resolve this incident.<br>
        <a href="https://jennie-lite.shanepass.workers.dev" style="color:#6366f1">jennie-lite.shanepass.workers.dev</a>
      </div>
    </div>
  `;

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Jennie Lite <onboarding@resend.dev>',
        to: recipients,
        subject: `[${incident.code}] Zone ${incident.zone} — Living Nativity 2026`,
        html
      })
    });
  } catch(e) {
    console.error('Email send failed:', e);
  }
}

async function sendResolutionAlert(incident, resolvedBy, env) {
  const apiKey = env.RESEND_API_KEY || 're_5K7BKMUV_Jb7omEQQKRhUkQPbPF3ZPCXX';
  // Recipients: set ALERT_EMAILS env var as comma-separated list to override
  const defaultEmails = 'spass@thetabsarasota.org,tabsafetyteam@gmail.com,jschmidt@thetabsarasota.org';
  const emailList = env.ALERT_EMAILS || defaultEmails;
  const recipients = emailList.split(',').map(e => e.trim()).filter(Boolean);

  const time = new Date().toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York'
  });

  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:500px;margin:0 auto;padding:24px;background:#0a0a0f;color:#e2e2f0;border-radius:12px">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:#22c55e;margin-bottom:8px">JENNIE LITE — INCIDENT RESOLVED</div>
      <div style="font-size:22px;font-weight:700;color:#22c55e;margin-bottom:16px">${incident.code} — RESOLVED</div>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:8px 0;color:#888;font-size:13px;width:100px">Zone</td><td style="padding:8px 0;font-size:14px">${incident.zone}</td></tr>
        <tr><td style="padding:8px 0;color:#888;font-size:13px">Description</td><td style="padding:8px 0;font-size:14px">${incident.description}</td></tr>
        <tr><td style="padding:8px 0;color:#888;font-size:13px">Resolved By</td><td style="padding:8px 0;font-size:14px">${resolvedBy.replace('_', ' ').toUpperCase()}</td></tr>
        <tr><td style="padding:8px 0;color:#888;font-size:13px">Resolved At</td><td style="padding:8px 0;font-size:14px">${time} ET</td></tr>
      </table>
    </div>
  `;

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Jennie Lite <onboarding@resend.dev>',
        to: recipients,
        subject: `[RESOLVED] ${incident.code} — Zone ${incident.zone}`,
        html
      })
    });
  } catch(e) {
    console.error('Resolution email failed:', e);
  }
}

// ── CORS + RESPONSE HELPERS ────────────────────────────────────────────────────
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function jsonRes(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" }
  });
}

function htmlRes(body) {
  return new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

// ── UI ─────────────────────────────────────────────────────────────────────────
function appHTML() {
  return htmlRes(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
<meta name="apple-mobile-web-app-capable" content="yes"/>
<meta name="theme-color" content="#0a0a0f"/>
<title>Jennie Lite</title>
<style>
:root{
  --bg:#0a0a0f;--card:#13131c;--border:#1e1e2e;
  --accent:#6366f1;--text:#e2e2f0;--muted:#666;
  --red:#ef4444;--orange:#f97316;--green:#22c55e;--yellow:#eab308;
}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);min-height:100vh;padding-bottom:env(safe-area-inset-bottom)}
.screen{display:none;max-width:480px;margin:0 auto;padding:16px}
.screen.active{display:block}

/* LOGIN */
.login-wrap{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;gap:20px;padding:24px}
.login-logo{font-size:48px}
.login-title{font-size:22px;font-weight:700;letter-spacing:.05em}
.login-sub{font-size:13px;color:var(--muted);text-align:center}
.login-input{width:100%;max-width:300px;padding:16px;border-radius:12px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:24px;text-align:center;letter-spacing:.3em;outline:none}
.login-input:focus{border-color:var(--accent)}
.login-btn{width:100%;max-width:300px;padding:16px;border-radius:12px;border:none;background:var(--accent);color:#fff;font-size:16px;font-weight:600;cursor:pointer}
.login-err{color:var(--red);font-size:13px;min-height:20px}

/* HEADER */
.header{display:flex;align-items:center;justify-content:space-between;padding:12px 0 16px}
.header-role{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--accent);font-weight:600}
.header-title{font-size:18px;font-weight:700}
.header-phase{font-size:11px;color:var(--muted)}
.logout-btn{background:none;border:1px solid var(--border);border-radius:8px;padding:6px 12px;color:var(--muted);font-size:12px;cursor:pointer}

/* TABS */
.tabs{display:flex;border-bottom:1px solid var(--border);margin-bottom:16px}
.tab{flex:1;text-align:center;padding:10px 6px;font-size:13px;font-weight:500;cursor:pointer;color:var(--muted);border-bottom:2px solid transparent}
.tab.active{color:var(--accent);border-bottom-color:var(--accent)}
.tab-panel{display:none}
.tab-panel.active{display:block}

/* CARDS */
.card{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:16px;margin-bottom:12px}
.card-label{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin-bottom:8px}

/* INCIDENTS */
.incident{border-radius:12px;padding:14px;margin-bottom:10px;border:1px solid var(--border)}
.incident.open{border-color:var(--red);background:rgba(239,68,68,.08)}
.incident.resolved{border-color:var(--border);opacity:.6}
.incident-code{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--red);margin-bottom:4px}
.incident-desc{font-size:14px;font-weight:500;margin-bottom:4px}
.incident-meta{font-size:11px;color:var(--muted)}
.incident-actions{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
.action-btn{padding:8px 14px;border-radius:8px;border:none;font-size:12px;font-weight:600;cursor:pointer}
.btn-resolve{background:var(--green);color:#000}
.btn-escalate{background:var(--orange);color:#000}
.btn-create{background:var(--accent);color:#fff;width:100%;padding:14px;border-radius:12px;border:none;font-size:15px;font-weight:600;cursor:pointer;margin-top:8px}
.empty{color:var(--muted);font-size:14px;text-align:center;padding:24px 0}

/* ZONES */
.zone{display:flex;align-items:center;justify-content:space-between;padding:14px;border-radius:12px;border:1px solid var(--border);background:var(--card);margin-bottom:10px}
.zone-name{font-size:15px;font-weight:600}
.zone-code{font-size:11px;color:var(--muted);margin-top:2px}
.zone-status{font-size:11px;font-weight:700;padding:4px 10px;border-radius:20px}
.status-clear{background:rgba(34,197,94,.15);color:var(--green)}
.status-active{background:rgba(239,68,68,.15);color:var(--red)}
.status-caution{background:rgba(234,179,8,.15);color:var(--yellow)}
.set-status-btn{background:none;border:1px solid var(--border);border-radius:8px;padding:6px 10px;color:var(--muted);font-size:11px;cursor:pointer;margin-top:6px}

/* PACKETS */
.packet{border:1px solid var(--border);border-radius:14px;overflow:hidden;margin-bottom:12px}
.packet-header{padding:14px 16px;background:var(--card);cursor:pointer;display:flex;justify-content:space-between;align-items:center}
.packet-title{font-size:15px;font-weight:600}
.packet-id{font-size:10px;color:var(--muted)}
.packet-body{padding:16px;border-top:1px solid var(--border);display:none}
.packet-body.open{display:block}
.packet-section{margin-bottom:14px}
.packet-section-label{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--accent);margin-bottom:6px;font-weight:600}
.packet-section ul{padding-left:16px}
.packet-section li{font-size:13px;line-height:1.6;color:var(--text);margin-bottom:3px}
.packet-purpose{font-size:14px;line-height:1.6;color:var(--text)}

/* EVENT PHASES */
.phase{padding:12px 14px;border-radius:10px;border:1px solid var(--border);margin-bottom:8px;display:flex;align-items:center;gap:12px}
.phase.current{border-color:var(--accent);background:rgba(99,102,241,.08)}
.phase-dot{width:8px;height:8px;border-radius:50%;background:var(--border);flex-shrink:0}
.phase.current .phase-dot{background:var(--accent)}
.phase-info{flex:1}
.phase-name{font-size:13px;font-weight:600}
.phase-time{font-size:11px;color:var(--muted)}
.phase-desc{font-size:12px;color:var(--muted);margin-top:2px}

/* MODAL */
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:100;display:none;align-items:flex-end;justify-content:center}
.modal-overlay.open{display:flex}
.modal{background:var(--card);border-radius:20px 20px 0 0;padding:24px 20px 40px;width:100%;max-width:480px;max-height:80vh;overflow-y:auto}
.modal-title{font-size:16px;font-weight:700;margin-bottom:16px}
.modal-input{width:100%;padding:12px;border-radius:10px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:15px;outline:none;margin-bottom:10px}
.modal-input:focus{border-color:var(--accent)}
.modal-select{width:100%;padding:12px;border-radius:10px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:15px;outline:none;margin-bottom:10px}
.modal-actions{display:flex;gap:8px;margin-top:6px}
.modal-cancel{flex:1;padding:12px;border-radius:10px;border:1px solid var(--border);background:none;color:var(--muted);font-size:14px;cursor:pointer}
.modal-submit{flex:2;padding:12px;border-radius:10px;border:none;background:var(--accent);color:#fff;font-size:14px;font-weight:600;cursor:pointer}
</style>
</head>
<body>

<!-- LOGIN -->
<div class="screen active" id="screen-login">
  <div class="login-wrap">
    <div class="login-logo">🎄</div>
    <div class="login-title">JENNIE LITE</div>
    <div class="login-sub">Living Nativity 2026<br>Team Lead Access</div>
    <input class="login-input" id="access-code" type="number" placeholder="000000" maxlength="6" />
    <div class="login-err" id="login-err"></div>
    <button class="login-btn" onclick="doLogin()">Enter</button>
  </div>
</div>

<!-- APP -->
<div class="screen" id="screen-app">
  <div class="header">
    <div>
      <div class="header-role" id="header-role">—</div>
      <div class="header-title">Jennie Lite</div>
      <div class="header-phase" id="header-phase">Living Nativity 2026</div>
    </div>
    <button class="logout-btn" onclick="doLogout()">Exit</button>
  </div>

  <div id="alert-banner" style="display:none;background:rgba(239,68,68,.15);border:1px solid #ef4444;border-radius:10px;padding:10px 14px;margin-bottom:12px;display:flex;align-items:center;gap:10px;cursor:pointer" onclick="showTab('incidents')">
    <span style="font-size:18px">🚨</span>
    <div>
      <div style="font-size:13px;font-weight:700;color:#ef4444" id="alert-text">Open Incidents</div>
      <div style="font-size:11px;color:#888">Tap to view</div>
    </div>
  </div>

  <div class="tabs">
    <div class="tab active" onclick="showTab('incidents')">Incidents</div>
    <div class="tab" onclick="showTab('zones')">My Zone</div>
    <div class="tab" onclick="showTab('guide')">Guide</div>
  </div>

  <!-- INCIDENTS TAB -->
  <div class="tab-panel active" id="tab-incidents">
    <div id="incidents-list"><div class="empty">Loading...</div></div>
    <button class="btn-create" id="create-btn" onclick="openCreateModal()" style="display:none">+ Report Incident</button>
  </div>

  <!-- ZONES TAB -->
  <div class="tab-panel" id="tab-zones">
    <div class="card">
      <div class="card-label">My Assigned Zones</div>
      <div id="zones-list"></div>
    </div>
    <div class="card" style="margin-top:4px">
      <div class="card-label">Event Timeline</div>
      <div id="phases-list"></div>
    </div>
  </div>

  <!-- GUIDE TAB -->
  <div class="tab-panel" id="tab-guide">
    <div class="card" style="margin-bottom:12px">
      <div class="card-label">Your Operational Packets</div>
      <div style="font-size:12px;color:var(--muted)">Tap any packet to expand</div>
    </div>
    <div id="packets-list"></div>
  </div>
</div>

<!-- CREATE INCIDENT MODAL -->
<div class="modal-overlay" id="create-modal" onclick="closeModalOutside(event)">
  <div class="modal" onclick="event.stopPropagation()">
    <div class="modal-title">Report Incident</div>
    <select class="modal-select" id="incident-code">
      <option value="">Select Code...</option>
      <option value="CODE BLUE">CODE BLUE — Medical/Injury</option>
      <option value="CODE PINK">CODE PINK — Missing Person</option>
      <option value="CODE RED">CODE RED — Fire/Danger</option>
      <option value="CODE SILVER">CODE SILVER — Disruptive Guest</option>
      <option value="GENERAL">GENERAL — Other</option>
    </select>
    <select class="modal-select" id="incident-zone">
      <option value="">Select Zone...</option>
    </select>
    <input class="modal-input" id="incident-desc" placeholder="Brief description..." />
    <div class="modal-actions">
      <button class="modal-cancel" onclick="closeCreateModal()">Cancel</button>
      <button class="modal-submit" onclick="submitIncident()">Report</button>
    </div>
  </div>
</div>

<!-- ZONE STATUS MODAL -->
<div class="modal-overlay" id="zone-modal" onclick="closeModalOutside(event)">
  <div class="modal" onclick="event.stopPropagation()">
    <div class="modal-title" id="zone-modal-title">Set Zone Status</div>
    <select class="modal-select" id="zone-status-select">
      <option value="clear">Clear — Normal operations</option>
      <option value="caution">Caution — Monitor closely</option>
      <option value="active">Active — Incident in progress</option>
    </select>
    <div class="modal-actions">
      <button class="modal-cancel" onclick="closeZoneModal()">Cancel</button>
      <button class="modal-submit" onclick="submitZoneStatus()">Update</button>
    </div>
  </div>
</div>

<script>
const API = '';
let token = null;
let role = null;
let roleConfig = null;
let incidents = [];
let zoneStatuses = {};
let currentZoneTarget = null;

// ── AUTH ──────────────────────────────────────────────────────────────────────
async function doLogin() {
  const code = document.getElementById('access-code').value.trim();
  const errEl = document.getElementById('login-err');
  errEl.textContent = '';
  if (!code) return;
  try {
    const res = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_code: code })
    });
    const data = await res.json();
    if (data.token) {
      token = data.token;
      role = data.role;
      roleConfig = data.role_config;
      localStorage.setItem('jl_token', token);
      localStorage.setItem('jl_role', JSON.stringify(data));
      startApp(data);
    } else {
      errEl.textContent = data.error || 'Invalid access code';
    }
  } catch(e) {
    errEl.textContent = 'Connection error. Try again.';
  }
}

function doLogout() {
  token = null; role = null; roleConfig = null;
  localStorage.removeItem('jl_token');
  localStorage.removeItem('jl_role');
  document.getElementById('screen-login').classList.add('active');
  document.getElementById('screen-app').classList.remove('active');
  document.getElementById('access-code').value = '';
}

document.getElementById('access-code').addEventListener('keydown', e => {
  if (e.key === 'Enter') doLogin();
});

// ── APP START ─────────────────────────────────────────────────────────────────
function startApp(authData) {
  document.getElementById('screen-login').classList.remove('active');
  document.getElementById('screen-app').classList.add('active');
  document.getElementById('header-role').textContent = authData.role_name || authData.role;
  updatePhaseDisplay();
  loadManifest();
  loadState();
  renderZones();
  renderPhases();
  if (authData.role_config && authData.role_config.actions.includes('CREATE_INCIDENT')) {
    document.getElementById('create-btn').style.display = 'block';
  }
}

// Check for existing session
window.addEventListener('load', () => {
  const saved = localStorage.getItem('jl_role');
  const savedToken = localStorage.getItem('jl_token');
  if (saved && savedToken) {
    try {
      const data = JSON.parse(saved);
      token = savedToken;
      role = data.role;
      roleConfig = data.role_config;
      startApp(data);
    } catch(e) {}
  }
});

// ── TABS ──────────────────────────────────────────────────────────────────────
function showTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  const tabs = ['incidents','zones','guide'];
  const idx = tabs.indexOf(name);
  document.querySelectorAll('.tab')[idx].classList.add('active');
  document.getElementById('tab-' + name).classList.add('active');
}

// ── MANIFEST (PACKETS) ────────────────────────────────────────────────────────
async function loadManifest() {
  try {
    const res = await fetch('/api/manifest', { headers: { 'Authorization': 'Bearer ' + token } });
    const data = await res.json();
    renderPackets(data.packets || []);
  } catch(e) {}
}

function renderPackets(packets) {
  const el = document.getElementById('packets-list');
  if (!packets.length) { el.innerHTML = '<div class="empty">No packets available</div>'; return; }
  el.innerHTML = packets.map(p => \`
    <div class="packet">
      <div class="packet-header" onclick="togglePacket('\${p.id}')">
        <div>
          <div class="packet-title">\${esc(p.title)}</div>
          <div class="packet-id">\${p.id}</div>
        </div>
        <span id="chevron-\${p.id}">▸</span>
      </div>
      <div class="packet-body" id="body-\${p.id}">
        <div class="packet-section">
          <div class="packet-section-label">Purpose</div>
          <div class="packet-purpose">\${esc(p.purpose)}</div>
        </div>
        <div class="packet-section">
          <div class="packet-section-label">Core Rules</div>
          <ul>\${(p.core_rules||[]).map(r => \`<li>\${esc(r)}</li>\`).join('')}</ul>
        </div>
        <div class="packet-section">
          <div class="packet-section-label">Triggers</div>
          <ul>\${(p.triggers||[]).map(r => \`<li>\${esc(r)}</li>\`).join('')}</ul>
        </div>
        <div class="packet-section">
          <div class="packet-section-label">Failure Risks</div>
          <ul>\${(p.failure_risks||[]).map(r => \`<li>\${esc(r)}</li>\`).join('')}</ul>
        </div>
      </div>
    </div>
  \`).join('');
}

function togglePacket(id) {
  const body = document.getElementById('body-' + id);
  const chev = document.getElementById('chevron-' + id);
  body.classList.toggle('open');
  chev.textContent = body.classList.contains('open') ? '▾' : '▸';
}

// ── STATE (INCIDENTS) ─────────────────────────────────────────────────────────
async function loadState() {
  try {
    const res = await fetch('/api/state', { headers: { 'Authorization': 'Bearer ' + token } });
    const data = await res.json();
    incidents = data.incidents || [];
    if (data.zone_statuses) zoneStatuses = data.zone_statuses;
    renderIncidents();
    renderZones();
    // Update alert banner
    const banner = document.getElementById('alert-banner');
    const openCount = data.open_count || 0;
    if (openCount > 0) {
      banner.style.display = 'flex';
      document.getElementById('alert-text').textContent = openCount + ' Open Incident' + (openCount > 1 ? 's' : '') + ' — Action Required';
    } else {
      banner.style.display = 'none';
    }
  } catch(e) {}
}

function renderIncidents() {
  const el = document.getElementById('incidents-list');
  const open = incidents.filter(i => i.status === 'open');
  const resolved = incidents.filter(i => i.status === 'resolved');
  const all = [...open, ...resolved];
  if (!all.length) { el.innerHTML = '<div class="empty">No incidents — all clear</div>'; return; }
  el.innerHTML = all.map(i => \`
    <div class="incident \${i.status}">
      <div class="incident-code">\${esc(i.code)}</div>
      <div class="incident-desc">\${esc(i.description)}</div>
      <div class="incident-meta">Zone: \${esc(i.zone)} · \${formatTime(i.timestamp)}</div>
      \${i.status === 'open' && roleConfig && roleConfig.actions.includes('UPDATE_INCIDENT') ? \`
        <div class="incident-actions">
          \${roleConfig.actions.includes('CLEAR_INCIDENT') ? \`<button class="action-btn btn-resolve" onclick="resolveIncident('\${i.id}')">Resolve</button>\` : ''}
          \${roleConfig.actions.includes('REQUEST_COMMAND_ALERT') ? \`<button class="action-btn btn-escalate" onclick="escalateIncident('\${i.id}')">Escalate</button>\` : ''}
        </div>
      \` : ''}
    </div>
  \`).join('');
}

async function resolveIncident(id) {
  try {
    await fetch('/api/incidents/' + id, {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'resolved' })
    });
    loadState();
  } catch(e) {}
}

async function escalateIncident(id) {
  try {
    await fetch('/api/incidents/' + id, {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'escalated' })
    });
    loadState();
  } catch(e) {}
}

// ── ZONES ─────────────────────────────────────────────────────────────────────
const ZONE_LABELS = {
  Alpha: 'Alpha — DeSoto Entry',
  Bravo: 'Bravo — Parking',
  Charlie: 'Charlie — Guest Village',
  Delta: 'Delta — Production/Backstage',
  Echo: 'Echo — Mobility Path'
};

function renderZones() {
  if (!roleConfig) return;
  const el = document.getElementById('zones-list');
  el.innerHTML = roleConfig.zones.map(z => {
    const status = zoneStatuses[z] || 'clear';
    const canSet = roleConfig.actions.includes('SET_ZONE_STATUS');
    return \`
      <div class="zone">
        <div>
          <div class="zone-name">\${ZONE_LABELS[z] || z}</div>
          \${canSet ? \`<button class="set-status-btn" onclick="openZoneModal('\${z}')">Set Status</button>\` : ''}
        </div>
        <div class="zone-status status-\${status}">\${status.toUpperCase()}</div>
      </div>
    \`;
  }).join('');
}

function openZoneModal(zone) {
  currentZoneTarget = zone;
  document.getElementById('zone-modal-title').textContent = 'Set Status — ' + (ZONE_LABELS[zone] || zone);
  document.getElementById('zone-status-select').value = zoneStatuses[zone] || 'clear';
  document.getElementById('zone-modal').classList.add('open');
}

function closeZoneModal() {
  document.getElementById('zone-modal').classList.remove('open');
  currentZoneTarget = null;
}

async function submitZoneStatus() {
  if (!currentZoneTarget) return;
  const status = document.getElementById('zone-status-select').value;
  try {
    await fetch('/api/zones/' + currentZoneTarget, {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    zoneStatuses[currentZoneTarget] = status;
    closeZoneModal();
    renderZones();
  } catch(e) { closeZoneModal(); }
}

// ── PHASES ────────────────────────────────────────────────────────────────────
const PHASES = [
  { phase: "PRE-OPEN", time: "5:30 – 6:15 PM", desc: "Setup, gear distribution, posts." },
  { phase: "INFLOW", time: "6:15 – 7:30 PM", desc: "Guest arrival, parking, hospitality." },
  { phase: "SHOW", time: "7:30 – 8:15 PM", desc: "Show-time lockout. Safety priority." },
  { phase: "OUTFLOW", time: "8:15 – 9:00 PM", desc: "All lanes switch to exit." },
  { phase: "CLOSE", time: "9:00 – 10:00 PM", desc: "Recover gear, sweep, charge, sign off." }
];

function getCurrentPhase() {
  const now = new Date();
  const h = now.getHours();
  const m = now.getMinutes();
  const t = h * 60 + m;
  if (t >= 17*60+30 && t < 18*60+15) return 'PRE-OPEN';
  if (t >= 18*60+15 && t < 19*60+30) return 'INFLOW';
  if (t >= 19*60+30 && t < 20*60+15) return 'SHOW';
  if (t >= 20*60+15 && t < 21*60) return 'OUTFLOW';
  if (t >= 21*60 && t < 22*60) return 'CLOSE';
  return null;
}

function updatePhaseDisplay() {
  const phase = getCurrentPhase();
  document.getElementById('header-phase').textContent = phase ? 'Phase: ' + phase : 'Living Nativity 2026';
}

function renderPhases() {
  const current = getCurrentPhase();
  const el = document.getElementById('phases-list');
  el.innerHTML = PHASES.map(p => \`
    <div class="phase \${p.phase === current ? 'current' : ''}">
      <div class="phase-dot"></div>
      <div class="phase-info">
        <div class="phase-name">\${p.phase}</div>
        <div class="phase-time">\${p.time}</div>
        <div class="phase-desc">\${p.desc}</div>
      </div>
    </div>
  \`).join('');
}

// ── CREATE INCIDENT ───────────────────────────────────────────────────────────
function openCreateModal() {
  if (!roleConfig) return;
  const zoneSelect = document.getElementById('incident-zone');
  zoneSelect.innerHTML = '<option value="">Select Zone...</option>' +
    roleConfig.zones.map(z => \`<option value="\${z}">\${ZONE_LABELS[z] || z}</option>\`).join('');
  document.getElementById('create-modal').classList.add('open');
}

function closeCreateModal() {
  document.getElementById('create-modal').classList.remove('open');
  document.getElementById('incident-code').value = '';
  document.getElementById('incident-zone').value = '';
  document.getElementById('incident-desc').value = '';
}

async function submitIncident() {
  const code = document.getElementById('incident-code').value;
  const zone = document.getElementById('incident-zone').value;
  const desc = document.getElementById('incident-desc').value.trim();
  if (!code || !zone) return;
  try {
    await fetch('/api/incidents', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, zone, description: desc || code })
    });
    closeCreateModal();
    loadState();
  } catch(e) { closeCreateModal(); }
}

function closeModalOutside(e) {
  if (e.target.classList.contains('modal-overlay')) {
    closeCreateModal();
    closeZoneModal();
  }
}

// ── UTILS ─────────────────────────────────────────────────────────────────────
function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function formatTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

setInterval(() => { updatePhaseDisplay(); renderPhases(); loadState(); }, 60000);
</script>
</body>
</html>`);
}

// ── MAIN WORKER ────────────────────────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    const JWT_SECRET = env.JWT_SECRET || 'jennie-lite-secret-2026';

    // ── LOGIN ──────────────────────────────────────────────────────────────────
    if (path === '/auth/login' && method === 'POST') {
      try {
        const body = await request.json();
        const { access_code } = body;

        // Look up access code — check KV first, fall back to built-in test codes
        const TEST_CODES = {
          '111111': 'safety_lead',
          '222222': 'parking_lead',
          '333333': 'hospitality_lead',
        };
        let roleId = TEST_CODES[access_code] || null;
        if (env.AUTH_KV) {
          const kvRole = await env.AUTH_KV.get('code:' + access_code);
          if (kvRole) roleId = kvRole;
        }

        if (!roleId || !ROLE_CONFIG[roleId]) {
          return jsonRes({ error: 'Invalid access code' }, 403);
        }

        const rc = ROLE_CONFIG[roleId];
        const exp = Math.floor(Date.now() / 1000) + (12 * 60 * 60);
        const payload = { role: roleId, exp, iat: Math.floor(Date.now() / 1000) };
        const jwt = await createJWT(payload, JWT_SECRET);

        return jsonRes({
          token: jwt,
          role: roleId,
          role_name: rc.name,
          role_config: rc,
          expires_at: new Date(exp * 1000).toISOString()
        });
      } catch (e) {
        return jsonRes({ error: 'Login failed' }, 500);
      }
    }

    // ── PROTECTED API ROUTES ───────────────────────────────────────────────────
    if (path.startsWith('/api/')) {
      const tokenStr = getToken(request);
      if (!tokenStr) return jsonRes({ error: 'Unauthorized' }, 403);

      const payload = await verifyJWT(tokenStr, JWT_SECRET);
      if (!payload) return jsonRes({ error: 'Invalid or expired token' }, 403);

      const roleId = payload.role;
      const rc = ROLE_CONFIG[roleId];
      if (!rc) return jsonRes({ error: 'Role not found' }, 403);

      // GET /api/manifest — role-filtered packets
      if (path === '/api/manifest' && method === 'GET') {
        const packets = rc.packets
          .map(id => PACKETS[id])
          .filter(Boolean);
        return jsonRes({ packets, role: roleId, role_name: rc.name });
      }

      // GET /api/state — role-filtered incidents and zone statuses
      if (path === '/api/state' && method === 'GET') {
        let allIncidents = [];
        let zoneStatuses = {};

        if (env.STATE_KV) {
          const raw = await env.STATE_KV.get('incidents', 'json');
          allIncidents = raw || [];
          const zoneRaw = await env.STATE_KV.get('zone_statuses', 'json');
          zoneStatuses = zoneRaw || {};
        }

        // Filter incidents to role zones only
        const filtered = allIncidents.filter(i =>
          rc.zones.includes(i.zone) && rc.actions.includes('VIEW_INCIDENTS')
        );

        // Filter zone statuses to role zones only
        const filteredZones = {};
        rc.zones.forEach(z => { filteredZones[z] = zoneStatuses[z] || 'clear'; });

        const openCount = filtered.filter(i => i.status === 'open').length;
        return jsonRes({
          incidents: filtered,
          zone_statuses: filteredZones,
          permitted_actions: rc.actions,
          open_count: openCount
        });
      }

      // POST /api/incidents — create incident
      if (path === '/api/incidents' && method === 'POST') {
        if (!rc.actions.includes('CREATE_INCIDENT')) return jsonRes({ error: 'Forbidden' }, 403);

        try {
          const body = await request.json();
          const { code, zone, description } = body;
          if (!code || !zone) return jsonRes({ error: 'code and zone required' }, 400);
          if (!rc.zones.includes(zone)) return jsonRes({ error: 'Zone not in your scope' }, 403);

          const incident = {
            id: crypto.randomUUID(),
            code,
            zone,
            description: description || code,
            status: 'open',
            reported_by: roleId,
            timestamp: new Date().toISOString()
          };

          if (env.STATE_KV) {
            const existing = await env.STATE_KV.get('incidents', 'json') || [];
            existing.push(incident);
            await env.STATE_KV.put('incidents', JSON.stringify(existing));
          }

          // Send email alert (non-blocking)
          ctx.waitUntil(sendIncidentAlert(incident, env));

          return jsonRes({ ok: true, incident });
        } catch (e) {
          return jsonRes({ error: 'Failed to create incident' }, 500);
        }
      }

      // PUT /api/incidents/:id — update incident
      if (path.startsWith('/api/incidents/') && method === 'PUT') {
        if (!rc.actions.includes('UPDATE_INCIDENT')) return jsonRes({ error: 'Forbidden' }, 403);

        try {
          const id = path.split('/')[3];
          const body = await request.json();

          let resolvedIncident = null;
          if (env.STATE_KV) {
            const existing = await env.STATE_KV.get('incidents', 'json') || [];
            const idx = existing.findIndex(i => i.id === id);
            if (idx === -1) return jsonRes({ error: 'Incident not found' }, 404);
            if (!rc.zones.includes(existing[idx].zone)) return jsonRes({ error: 'Zone not in your scope' }, 403);
            if (body.status === 'resolved') {
              body.resolved_by = roleId;
              body.resolved_at = new Date().toISOString();
              resolvedIncident = existing[idx];
            }
            existing[idx] = { ...existing[idx], ...body, updated_at: new Date().toISOString() };
            await env.STATE_KV.put('incidents', JSON.stringify(existing));
          }

          if (resolvedIncident) {
            ctx.waitUntil(sendResolutionAlert(resolvedIncident, roleId, env));
          }

          return jsonRes({ ok: true });
        } catch (e) {
          return jsonRes({ error: 'Failed to update incident' }, 500);
        }
      }

      // PUT /api/zones/:zone — update zone status
      if (path.startsWith('/api/zones/') && method === 'PUT') {
        if (!rc.actions.includes('SET_ZONE_STATUS')) return jsonRes({ error: 'Forbidden' }, 403);

        try {
          const zone = path.split('/')[3];
          if (!rc.zones.includes(zone)) return jsonRes({ error: 'Zone not in your scope' }, 403);

          const body = await request.json();
          const { status } = body;

          if (env.STATE_KV) {
            const existing = await env.STATE_KV.get('zone_statuses', 'json') || {};
            existing[zone] = status;
            await env.STATE_KV.put('zone_statuses', JSON.stringify(existing));
          }

          return jsonRes({ ok: true });
        } catch (e) {
          return jsonRes({ error: 'Failed to update zone' }, 500);
        }
      }

      return jsonRes({ error: 'Not found' }, 404);
    }

    // ── SERVE APP ──────────────────────────────────────────────────────────────
    return appHTML();
  }
};
