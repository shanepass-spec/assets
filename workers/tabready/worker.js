const MAGIC_LINK_EXPIRY_SECONDS = 7 * 24 * 60 * 60;
const SESSION_EXPIRY_SECONDS = 365 * 24 * 60 * 60;
const COOKIE_NAME = 'tabready_session';
const VERSION = '2.9.17';
// ============================================================
// TabReady Worker v2.9.11 (May 18, 2026)
//   - Fix: DB binding now points to correct tabready D1 database
// TabReady Worker v2.9.10 (May 18, 2026)
// TabReady Worker v2.9.9 (May 18, 2026)
//   - canSeeCodesFlag in dashboard now includes safety_consultant
//     (fixes missing Codes/Reports/WatchList tabs for that role)
// TabReady Worker v2.9.8 (May 18, 2026)
//   - safety_consultant role added to canBroadcast, canSeeReports,
//     canSeeWatchList, and apiCodesList. canPostWatchList unchanged.
// TabReady Worker v2.9.7 (May 17, 2026)
//   - My Team tab rebuilt: now D1-based, not PCO.
//     Stack of per-team directory cards (one per role you belong
//     to; admins see every role with data). Each header uses the
//     team's brand color from ROLE_STYLE (Safety yellow, Greeters
//     blue, Café orange, etc.). Same pill grid + close pattern.
//   - Empty teams are hidden (no clutter).
//   - Old PCO-based loadTeam removed. The /api/my-team endpoint
//     and PCO_GROUP_MAP are still in the worker for future use
//     but no longer called from the UI.
//   - Safety still styled bright yellow in Codes tab (unchanged).
// ============================================================
// TabReady Worker v2.9.6 (May 17, 2026)
//   - Safety Team Directory header: bright safety yellow (#FBC02D)
//     with dark brown text. High contrast, reads as "Safety".
//   - Close button at bottom of expanded directory (brown).
//     Tapping Close also scrolls header back into view.
//   - Card bodies: ALL-CAPS section headers (DO THIS, WHO HELPS,
//     ON THE RADIO, etc.) now render bold + darker than body text.
//     Detected at render time, no D1 changes needed.
// ============================================================
// TabReady Worker v2.9.5 (May 17, 2026)
//   - Safety Team Directory header restyled:
//     * Tab brown banner (#402020) with cream text
//     * Phone icon (📞) added to header
//     * Hover and active states for tappable feedback
//   - Foundation for extending pill-grid pattern to other teams
//     (Greeters, Café, etc.) — deferred to next session.
// ============================================================
// TabReady Worker v2.9.4 (May 17, 2026)
//   - Safety Team Directory UI rework:
//     * Collapsed by default — tap header to expand
//     * Member count shown next to title: "(22)"
//     * Pill grid: 2-4 columns auto-fit (140px min width)
//     * Each pill = name + phone, entire pill is a tel: link
//     * Lead = green pill with ★ on name
//     * Members without phones show "no number" inline
//   - No server/DB changes. Same /api/team-directory endpoint.
// ============================================================
// TabReady Worker v2.9.3 (May 17, 2026)
//   - NEW: Safety Team Directory card in Codes tab
//     - Visible to: safety role members + global admins
//     - Source: D1 users + user_roles tables
//     - Lead is flagged with green "Lead" badge, sorted to top
//     - Phone numbers are tap-to-call (tel:)
//     - Emails are tap-to-email (mailto:) — placeholder emails
//       (ending @placeholder.local) are hidden
//   - NEW: GET /api/team-directory?role=safety endpoint
//     - Auth gated: 401 if not signed in, 403 if not a member
//       of the role AND not a global admin
//     - Returns role meta + members with is_lead flag
//   - Data: 22 Safety Team members assigned to safety role
//     (loaded via D1 prior to this deploy)
//   - Eric Wyrosdic set as safety team_lead_user_id in roles
// ============================================================
// TabReady Worker v2.9.2 (May 17, 2026)
//   - Ask form submits on Enter key (desktop fix). Shift+Enter
//     still inserts a newline. Mobile virtual keyboards behave
//     the same way; multi-line input is still supported via
//     Shift+Enter.
//   - IME composition guarded (won't fire mid-character for
//     CJK / accented input).
// ============================================================
// TabReady Worker v2.9.1 (May 17, 2026)
//   - Removed DRAFT yellow banner from Codes tab (overkill for beta)
//   - Removed "Source of truth" footer box from Code detail cards
//   - Orphaned CSS for draft-banner and code-detail-note also removed
//   - tel: links: tapping shows confirmation popup (iOS) or opens
//     dialer (Android). Long-press gives Copy/Call/Message menu
//     on both — that's built into mobile browsers, no code needed.
// ============================================================
// TabReady Worker v2.9.0 (May 17, 2026)
//   - Phone numbers in card bodies are now tap-to-call (tel:)
//   - Email addresses in card bodies are now tap-to-email (mailto:)
//   - Auto-linkify runs at render time only; stored content is
//     unchanged. Edits via admin UI keep showing plain text in
//     the textarea.
//   - Applies to: Codes detail view, Content detail view.
//     Does NOT apply to: team notes (user-written, separate
//     escape path), admin edit list, incident report bodies.
//   - Risk surface: regex matches one number/email format each.
//     Tight patterns chosen to avoid false positives.
// ============================================================

const SARASOTA_LAT = 27.3364;
const SARASOTA_LON = -82.5307;

const WEATHER_CACHE = new Map();
const WEATHER_CACHE_TTL_MS = 10 * 60 * 1000;

const INCIDENT_REPORT_RECIPIENTS = [
  'ruys@thetabsarasota.org',
  'info@thetabsarasota.org',
  'business@thetabsarasota.org',
  'spass@thetabsarasota.org'
];

const RESEND_FROM_ADDRESS = 'TabReady <tabready@thetabsrq.net>';

// v2.5: Watch List standing language (locked, displayed on every entry)
const WATCH_LIST_STANDING_LANGUAGE =
  'Do not approach. Do not engage. For situational awareness only. ' +
  'Direct all concerns to safety team lead. This information is for ' +
  'authorized TabReady users only and must not be shared outside the app.';

// v2.6: PCO group ID → TabReady role mapping
// Edit the PCO group IDs once you have them from PCO People API.
// Until then, the map is empty and My Team tab will show a setup message.
// Format: { "PCO_GROUP_ID": "tabready_role_id" }
const PCO_GROUP_MAP = {
  // Example (uncomment and edit when you have real IDs):
  // "12345678": "safety",
  // "12345679": "cafe",
  // "12345680": "greeters",
  // "12345681": "classroom",
  // "12345682": "media",
  // "12345683": "music",
  // "12345684": "elders",
  // "12345685": "staff",
};

// v2.6: Photo retention rules (days). 0 = no auto-expiry.
const PHOTO_RETENTION_DAYS = {
  incident: 365,        // 1 year — defensible for insurance/legal
  watch_situational: 1, // 24 hours — matches situational watch list
  watch_standing: 0,    // until removed, annual review
  team_note: 30         // 30 days — operational, not legal
};

// v2.6: Max photo size (5 MB)
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

// ─────────────────────────────────────────────
// MAIN HANDLER
// ─────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      // ── AUTH ROUTES ──
      if (path === '/auth/request' && method === 'POST') return await handleAuthRequest(request, env);
      if (path === '/auth/verify' && method === 'GET') return await handleAuthVerify(request, env);
      if (path === '/auth/logout' && method === 'POST') return await handleLogout(request, env);
      if (path === '/auth/me' && method === 'GET') return await handleWhoAmI(request, env);

      // ── PWA ROUTES ──
      if (path === '/manifest.webmanifest' && method === 'GET') return handleManifest();
      if (path === '/service-worker.js' && method === 'GET') return handleServiceWorker();
      if (path === '/icons/icon-192.png' && method === 'GET') return handleIcon192();
      if (path === '/icons/icon-512.png' && method === 'GET') return handleIcon192();

      // ── HEALTH ──
      if (path === '/health') {
        return json({ ok: true, service: 'tabready', version: VERSION });
      }

      // ── PUBLIC ──
      if (path === '/login') return loginPage();

      // ── HOME ──
      if (path === '/') {
        const user = await getUserFromRequest(request, env);
        return user ? dashboardPage(user) : loginPage();
      }

      // ── JSON API ──
      if (path === '/api/me' && method === 'GET') return await apiMe(request, env);
      if (path === '/api/roles' && method === 'GET') return await apiRolesList(request, env);
      if (path === '/api/content' && method === 'GET') return await apiContentList(request, env);
      if (path === '/api/codes' && method === 'GET') return await apiCodesList(request, env);
      if (path === '/api/alerts' && method === 'GET') return await apiAlertsList(request, env);
      if (path === '/api/alerts' && method === 'POST') return await apiAlertCreate(request, env);
      if (path === '/api/ask' && method === 'POST') return await apiAsk(request, env);
      if (path === '/api/pco-events' && method === 'GET') return await apiPcoEvents(request, env);
      if (path === '/api/weather' && method === 'GET') return await apiWeather(request, env);

      // ── v2.1: REPORTS API ──
      if (path === '/api/reports' && method === 'GET') return await apiReportsList(request, env);
      if (path === '/api/audit-log' && method === 'GET') return await apiAuditLog(request, env);

      // ── v2.5: TEAM NOTES API ──
      if (path === '/api/notes' && method === 'GET') return await apiNotesList(request, env);
      if (path === '/api/notes' && method === 'POST') return await apiNoteCreate(request, env);

      // ── v2.5: WATCH LIST API ──
      if (path === '/api/watch-list' && method === 'GET') return await apiWatchListList(request, env);
      if (path === '/api/watch-list' && method === 'POST') return await apiWatchListCreate(request, env);

      // ── v2.6: MY TEAM API (PCO People) ──
      if (path === '/api/my-team' && method === 'GET') return await apiMyTeam(request, env);
      if (path === '/api/team-directory' && method === 'GET') return await apiTeamDirectory(request, env);

      // ── v2.8: SOFT DELETE + RESOLVE + AI CLEANUP ──
      const reportDeleteMatch = path.match(/^\/api\/reports\/([^\/]+)\/delete$/);
      if (reportDeleteMatch && method === 'POST') return await apiReportDelete(request, env, reportDeleteMatch[1]);
      const reportResolveMatch = path.match(/^\/api\/reports\/([^\/]+)\/resolve$/);
      if (reportResolveMatch && method === 'POST') return await apiReportResolve(request, env, reportResolveMatch[1]);
      const noteDeleteMatch = path.match(/^\/api\/notes\/([^\/]+)\/delete$/);
      if (noteDeleteMatch && method === 'POST') return await apiNoteDelete(request, env, noteDeleteMatch[1]);
      const wlDeleteMatch = path.match(/^\/api\/watch-list\/([^\/]+)\/delete$/);
      if (wlDeleteMatch && method === 'POST') return await apiWatchListDelete(request, env, wlDeleteMatch[1]);
      const contentDeleteMatch = path.match(/^\/api\/content\/([^\/]+)\/delete$/);
      if (contentDeleteMatch && method === 'POST') return await apiContentDelete(request, env, contentDeleteMatch[1]);
      const contentTightenMatch = path.match(/^\/api\/content\/([^\/]+)\/tighten$/);
      if (contentTightenMatch && method === 'POST') return await apiContentTighten(request, env, contentTightenMatch[1]);
      const alertDeleteMatch = path.match(/^\/api\/alerts\/([^\/]+)\/delete$/);
      if (alertDeleteMatch && method === 'POST') return await apiAlertDelete(request, env, alertDeleteMatch[1]);

      // ── v2.6: PHOTO ROUTES ──
      // Serve a photo from R2 (auth-gated)
      const photoMatch = path.match(/^\/photo\/([a-zA-Z0-9_\-\/\.]+)$/);
      if (photoMatch && method === 'GET') return await handlePhotoServe(request, env, photoMatch[1]);

      // ── CAPTURE PAGES ──
      if (path === '/capture' && method === 'GET') return await handleCaptureMenu(request, env);
      if (path === '/capture/incident' && method === 'GET') return await handleIncidentForm(request, env);
      if (path === '/capture/incident' && method === 'POST') return await handleIncidentSubmit(request, env);
      if (path === '/capture/person' && method === 'GET') return await handlePersonForm(request, env);
      if (path === '/capture/person' && method === 'POST') return await handlePersonSubmit(request, env);

      // ── v2.1: AUDIT LOG PAGE ──
      if (path === '/audit-log' && method === 'GET') return await handleAuditLogPage(request, env);

      // ── CONTENT ADMIN PAGES ──
      if (path === '/content' && method === 'GET') return await handleContentList(request, env);
      if (path === '/content/new' && method === 'GET') return await handleContentNewForm(request, env);
      if (path === '/content' && method === 'POST') return await handleContentCreate(request, env);

      const editMatch = path.match(/^\/content\/([^\/]+)\/edit$/);
      if (editMatch && method === 'GET') return await handleContentEditForm(request, env, editMatch[1]);

      const updateMatch = path.match(/^\/content\/([^\/]+)$/);
      if (updateMatch && method === 'POST') return await handleContentUpdate(request, env, updateMatch[1]);

      return json({ error: 'not_found' }, 404);
    } catch (err) {
      console.error('Unhandled error:', err);
      return json({ error: 'server_error', message: err.message }, 500);
    }
  }
};

// ═════════════════════════════════════════════════════════════
// PWA SUPPORT
// ═════════════════════════════════════════════════════════════

const ICON_192_B64 = "iVBORw0KGgoAAAANSUhEUgAAAMAAAADACAYAAABS3GwHAAC+RklEQVR42sy9d5gcxbXG/auq7p6wOSjniCSCACEQOYskDMbY2DhxjbOv03W2773gnI2zDY6YZDIGk3POIEBCEso572rjhO6q+v7ontmZ2ZnZ2RX3+77h2WfR7mxPh6oT3vOe9wittbXWIoRgOC8hBIV/Z62t+r7S/y/3vnLHyf1NuXMsPV7pMaodM/fzauc00vcX/GX0BRYQ1oK10b/C40X/N3Bttsz5IhBSIAArBIjoyFZgBAgR/o0UAlPm3ArvWy3Popb7MNSzLv3cwlcta6DwWKXPs/A4ta7bcmtCCIFT7UTLfVDph1Y7iXInPNJXucU91PFqXdi13sBaF03+wRlN/t1SIqREColk5K/CMzbWYrXGRP8vpEAiiq6r0qItXFzDWUTDNZRvx0sIMeTmG+5mzP1bGGPs27VIy1n8Sjd8JAv67bRUQ1mJQTfPgqXMArAWbUz+uqSUSFlhiQcB6XSK3t4eenp66e/rI9XTQyqVIutnyWaz0caxWCxKKrx4jGRdkmQySV19PfF4gkQySbKunngyAUKV/ShjDNaY0PNIgRRySOMghMRa87bd52r3u9zfVLL0wz2f4axlp9Yd9Ha9pJT5kOb/zy8hBCZvvy0Ii7ASjA0tLxYhJUpKnJIF39XZwa5t29m2ZQvbt29lx9at7Nm+g93bd9Dd1U1fbx99vX2kU33obJpAaywWaywyFzJZg7GAUniuRzwWI+Z5uLE4yvNINtTR1NLCqNFjGTVmNBMmT2LC5MlMmDyJMePHE0skoeC8LKB1kA+Vwg0RxlLhVRoMQS7gelsNTq2eOWc4Sg3R/m6Mquee8wBDWeJqF1nrDi/nFSrF7cPZxbVu1krHrnoOFqzVGGtAKBxVbHH37tnNpnXrWbtqJWveXMHGtevYtW0b+/buprurGz/rY4xByvABCyGRSuHGPDwvhuvFcGNeflMpIYmCfYw1BEEGE2iM1mg/wPoBWd8nncng+z7Ghp7C9TySdUkaW1toHzua8VOmMn3mTGbNm8eM2bOZMGkSXixR4CFseF4it+AtYMKEooK3GO5CryWMrZb3DRWKlXtfLeF8TRtgqASzlsVd6+IrDI8Kw4daN+LbvQHyCaoJF61UA3/XuXc3a1eu4vVXX+XNV19h3Vsr2bVtO33dveisDxZUzCVZV09TWzONrW20jxnH+ImTGTdhAk3NjTS3tdDQ0kxzSyuNDc3EEwmUUuHnRw9WSIk1BqMDMqkUvb299PT0kOrroa+nlx1bt7Fr+w527tpOV2cnHbv30LFnLz2de8mm+jHa4gqFSno0tLQwduIkZh0wl0MWHMHBhx3GlJkzUe5AABD4GoEInYYUw9oAw7HQ1Z7V22HpS8GZocJcobW2I83ojTGDEq5Ki7bagi084aEW80iSoVoTOWtMeE1Sogos/Ya1a3jxmWd57oknWPXGMvZu346fSoHVKNehrrGJttFjGD99KtNmzWbazJlMmzGTCVMm0zaqHcqkvcZCJtVPNtNPf18/fT29pFIpdBAgpMTzXBKJOjw3HnkKD8/zcJMxHEeVeRYBu3buYuv69axbtYq1K1ex9q1VbFq7js69e0n19WGCAC+RoHnMaGYccAAHHXYYRx5zDAcffhgNza0DoZLvgxADm7IG713JGr8doW6tiGM1A1nx/eU2QC0HKYUmqyW15RLjclakVgtS6wYYlHCHmeygGFdbg7XgFiysNStW8vTjj/DCU0+zetly9m7fSSrdD1LS1NzC1OnTmXfYoRy04HDmHnIIU2fNJO7FBz5bW3Zs3caOLZvYtGEDWzZvYsfWrXR3dtDb3UOqp5f+/n760/1k0hl0EGC0QeaSVilxlINUCqHCsEk5DolEgrqGBppbWxg3fjyjx09m3MQJTJk2lQmTJtE0qr3o2rZv3caqN5azfOnLrFj2GptXr6Fjxy56+noxQLIuyYTJkzls0dGceMZiDj9qEXUNjfn7ooMARypEFJrZCImqdUHWCmnX4hH2ZwNU8i4VPcBQO6fSgh4KJt3fOLLapqkUguV+brBRihfeEG00SkikktFi2cqzjz/OY/ffx+svvsTubduwWOobm5g4eRKz5s1j/hELOWzRUcw58GBE9HfZ/hRrVq/mrTffZN2qlWxcu45tWzbTuXs3qZ5e0plMlAfIKKRSqOi7AISUIYIkJELagYjcGKwVYKPE29owF4gQHmNCxMZxHGKeR319PQ2jRjF24iRmHDCLeYccxJxDDmPCpIkDIdy+Dla+9gbPP/kELz39DOtWr6KnoxPHChpampk4YwaHHXMMp5yxmEOPPALlxEKvEGiEIEyexdsDaw+1kKuF0eW8zlCQfNlaUhAEtpa4q1IxpdKCG27B6+1Oqip5HUu4mBzl5C3ZC08+wb233cqrzz3Ljm3byabTeI5D68SJHHrEkZy0eDFHn3Qyjc1NAPiZFK+/8govPfsMS194kY1r17Fv916y6QxgcVyFdBSu46KUW+CBwjBr0LWHlSzCt9ki5COHC+U9mRjwX4XXZYxBa03Wz6D9AGMMruPQ0NrM+KlTmD3vIA5feCSHHHUkEydNzn/08tdf56lHHuHlJ59iw4oVdO7ZRVYH1De3ctD8Q1l83vmcdM5ZtLWHnsXXGmktsiQ8+v9iA9Ty/qFy0aoeYDgLcKg4v9ZNValOUOuNKLsxokKRMQbXdfNQ5aP33c+/b7+d1194nlRXN27cY/T48Ry68EhOPetMjjzxRJqi2Hjr5o28+OQzvPj007z5+mvs2LKFdKofpRQxz8V1XYR0sDJEb4zVCAvKqkF5U5Fbzy3nqLqLGNgA4fnLQWFApfBDCIGVUT0i93s/wE9nSWUzWCFpbmlh6vSZzD/6SI495WSOOPoYop3Hitdf58F/38XTDz3EhnXryPaniDsuk6ZNZ9Hpp3Lmhe9i3kEHRyWN0CMUPwvK/Oz/Du5+O3KMQSjQSAte5axuLceUUuYXxUgX+KBjCoG1YAmxdGstrhMiHnt37ODOW27hzltuZsOat9DpLPV1TcyaO4fjzz6Ts84/jwmTpwCwc/MWHr3/AR578H5WvvYaPfs6UVLixWJ4XgypJNraMFbGghFIKxDkKA+5hV1guaOCWv5clczXd4UAFdEa/Kg2IOxw68Y271VszoMIAcIgsQQ6IJNOE/iaRCzB1BkzOeL44zlh8WkccUy4GbLZLM88+giP3HUXLz/zDNu3bsEYS8uoURxz8im855JLmL9wYZgnaF2A3tloE8uaC2QjgUCrVXaHgwZaa8MNMJIaQGlCk7sJw+HV7E+Fr/Cci/KAKEvLxfiOE1r87Zu3cPuNN/DgbXewee06Mtqnqb2NoxYdy7kXXcSJZ52BAHr27ePhe+/jkfvu562lr9KxZw8giMVjoZUXgkBrsBZbEjUKW7AEK7hegchvCmsMPf19UeXXRL8N72NdQx1WgDD5SlXFOLeW6nv+vVFVOGd4/EyGdDaDdRymzpjBSaedzlnnv5OZB84FYNP69dx5w/U8dNfdbFu/AaN9GtpaOeKkE3j3Bz/MkcceF+ZBOkBKgbL5bTAI2q4lMa3Jow/BDxtWYh4Ega3E86lWjRuJtR9J+bxcUl1pcwgLWoAxOh/jd+zexY1//zt33XQjezdvQUiHprFjOPrkU3j3xR/gwAWHArDyjdf51z9v5MH77mXH5s3EXY/6ujocx0WbEA0p3GwmohkgCjZh6HYqnme4li0OAmUFbiLBAfPno5RCKoXjOrjJOMb3efqRhxF+gKW6hxzOBsgZKCFE/phShXUOExh6+1L4qRStrU3MP+44llx4IaedfTZIRWfXXu658VYeuO0O3lq5jExPimRjA0eddjKXfOqzHHx4eB8zWuPWAHrUggwO5xjVNlu1NVaUA1TbUaWY/9tZoBour6PsA7chfSDA4imHVG8ft91wHTf94x9sXr0ahGXUxEmcce47uPCDH2TytOlY4KH77+Wem25h6ZPP0N29j1giTtzzolhcFsfjQuQrwUEQ5D1A3ihU8QCExV2MgIRw6Orp5qQlZ/HTq/5c9vo//r6LeO2pp6mrq0drU3OxqFJRD0BFhDyTq3cIgZA2SpIIwy0HsiaL35dBWsn0A+Zw5jsvYMlF76J19Bj8IMt9t97KLVdfy/Klr5L2M7S0j+Gsd7yDD33yk0ycNjWPVsnoXg23kjycutBQyOCQm6jWDVApWR0uHWJ/CVRlkR9LFO6Ecf5j9z/In3/5S1YuewUCS2v7KE5dsoSLPv4Jpk6bCoHm9htv4l/XXctby5aHOUJdAoXCGB0CpjKkGxNxBaUIE7++VD9KOdQnEyE0WRp+VdkAiPA9nnLY1d3Jd3/9S5ZceBGZTBbPdbEWfN8nHve4/cbr+e4Xv0RLUwt+EAwktcPdAEJgrUEKSSabJZtKE4vFiCXiCCUjxmpYBzE2fL+04EqJFpbe/n7SqQwTJkzirHe9k4v+4xLGTphIYAJuv+46bvnL31i7eiVCW0aPn8QFH/4QF3/sUhLJOoKoqJfDwAbOjZpqQiMNl4ez7iomwSMpOL0dIU+l9xa68ULUwRiNEBKlJOvWrObKn/+SJx64j0x/L/XNjZy0+Ew+9IlPM3PeXIw23HbDDdx89d9Ys3w5iViCRCIRJZ1Bbq0jpQ0TWanAQirVT39/P8n6Rk45+2zGjR/HzX/9M57j4ZuBJzokVAxhjGx8EqPauebOf9E+ZjyBHy6UXCIshGDv7h28/4yz6O7ch+N5SFv+mOXw7SLrLySugr7eXs668N3MPGAO/771Vt5auQLt+9Ql6/C8GELYcDPk4rrofIUIOXV+Jktffz9jx43jjAvexbs/cgnjJ0yiv7ePG6/5K7f99R9s37gZ7UjmHHown/6vL3H8aYuxkbd0VORNhSUkhFen1A8VcQwXaSxE34ruX7UNUAsTb6TUhZHyPgrDjcAEYYzu+1z3lz9z9VW/p3vzHvBcDjxqIZ/87OdYdPKJANxz6y3c8Jc/s+z11/GkQ0NdfVjgMSbE3o1FC4MUYQhlgoCe3l6y2jLlgDksXrKEM85ewqyD5qHTGd59+uns2rIF1/PQWtfoyQRKCbo7Ozntgnfyoz/8YSC8ETbyEAJjwVGKy77weW6//gba2tqw2pRN/IaCnyUC15H0+hn+cP31zD9yEX19fSx78SUe/ve9PPXow2zfvgUlJI31SaR0CELoLDqOzW9K5Siy6Syp3l5aR4/m/A99gIs/+QmaGprZsnkTv/3ZT3ni3/fg93bh1dVz+nnv5LNf+zptY8eEwAEhPDuYUV5bMjxSw1o1byztB6gl2RwqMX07cdxKHCQApRSrlr3BFd/7Pi8++ThGB0ycOJUPfOKTXPSxSwF4+onHuOY3v+ON554DR5JIJEBH3kOUXI+0ZLNZUpksdQ31LDhqEWeffz7HnHQy9c3NAPSlM8Q9l19/7/v8/be/pb21NXq4NfBPhMBVks59+/j2L3/FkoveQyYbhj9vvPoS8USC2XMPIgg0jqN45uGH+fwll1BfX48J9JDFv3L/lkKSzaaZdMAs/nbHHUgVw5MOIuLB7d29kxeeeJKH7r+fV55/nq49e2lM1oGUGG2ixW/zxTojAEciUll6e/qYMmc277n0o1z04Q8ihOLZhx/myit+xrKXl2KtYNKMaXz6q19h8Xnnh9VtX4fQr6i8xmq1/uVynWohfNkQulxDTDmYqVoZeqQtlSPJBbQOY31jNNf85c/c8Os/sG/vbnAUJ511Dp/7n28yfuIkNq/fwJU//xmP3PlvsBqvsR6rBdZqcnmflAIpFX7g09PTCxYmzZjOyWefxVnnncfsgw6KiGsWHYRMTyslnuOwfeM63r34TGRgwm6vWjhNQmCNpr6xkavvvIvWiRMIsj4xz+WX3/kOTc1N/MfnPo/vB1glMakUl5x7LhvXryfueZSzVUPRyYWS7N67m0s++Sm+/J3vkg00rpJoHRAEPrF4Il+MW796NXffcgu3Xf0Pent7qauri3KigbbLKJ3GSnCkJJNK05/u55DDF/CJL3+ZY085BV8HXPXTn3PL3/5Gf3cnTiLB4nddwBe+9d80NbcSBMEgot3+bIBa6dFlN0AuCR4OpXh/i2ZDeZiBmNnmq5TCGAKtcV2PTevX8+P//W9eeOwxJIZJ02fw0S98mTPfeT4Gw9W//yM3/PEqOnbvoqmxCSsgMBqsCZlAIswlAj9LT18fXrKOwxcdzTveeSHHnnISjW1h9TfrZwCJFArHGcg9lj7/Avfdfiv3/etOjB/U3FLqSEFXdxfHnXk2v/zbXwmCAKRCCfjIO84j7nn8/pabyWgDfkA8EeOqK67gDz/9Me1NzWSDgX7iAn9YWgYszg0w9GTS/OmGGzns2GPQgQapcKTI/7WfzaJUSL4DWPn6G/zvFz7LhlVrqKtvxJigyCjKfJEtNCJKSPp7+9BKcM6738Vnvvw12seO4fVXXuVX37mcZS++jLWG6QfO5avf/yGHH3kkfhCgRNgfYbElSbKtqQ4wXBJcoeHOG/bcBqil6Xy4G2UoXk7Vv8vlYjbkzyBAScUj99zLj//7m2zfuAkV8zjz/PP48re/S9uoUSx76SV++d3v8fILz1NXX4enPLQOCj7fhJZfKbQxNLS1ccLpp7N4yTs49MiF+XPwdYAiJKZhBdYKujp28+KTT3LXbbfz4rPP0N/bTVNDE0o6NcF6YTVa0dm9j2/9+Gdc+KEPks2m8bw4m9av5T+WnEegfa6+6y4mzZqNzmTxYh4bVq3kg+efj2sMxpa79+U3QA4wyKT7mXnQQfzlllsRnoMxoByH7Rs3svyVVzn21FOpbwrZn9kgwNeauliMXVs28bH3vI+OnbtxXRUR8wbnIDlo1xOhRe/q7mLcxEl86mtfYcmF78YEAb/96U+48e9/J93dTWNTIx/73H9x8ac/iQaM1oM66kaCHlYKy0vh1NICqrr88ssvr6WpvZKLGY4XKN0I5b6KS/oCEwT5otYff/5zfvPd79G9dy9No0fxxf/9Xz7/rf8hHkvw65//lJ/+77fYu3ELzU0NGGGx2g7inAkpcRyHru4uzj7/fL72/R8wdsIEfB2ESJDWKBnGqFIItLUoJfn9z3/Oj77xDXr27CYei5FMxBlUCh7i+rXWJJub+Pw3v0ljczNBNsBxHR659x4evfsefD/D5GnTOfjwwyN1B0tLaxtLX3qJtaveIhaLlbn/dhDWmn+4StGf6ufCD36QI44/Hq1DFqnrONz497/zna98lacefYTtW7Ywc/YskvUNIAQZP0NLazvNjY08fO+9xDxvEIepANkdoEkbaEwk6e/p4sF77mbjhg0csehoTlx8BgcdeghvLlvOnk0befaJJ9m4cQOLjj2GRCKJzt3zkrVSa1hdzsCWC91z/y5EEqsSTUorkPvzGqoPuPT3uQXjuC57du/ms5dcwt9/eQVBqo9DFh3NVbfdykWX/Acrli3nkvPP428//RlCg6pPkgoMmMqXprUm5sV48pGH6di5m2zWR2CIu2HTidAGbQxh+BvewGNPOp761mbceHzQ72p5QEopUqkUBx5yMOMnTUYbG9YtrOHBe+8l3deH8bM8dPe/0TpAOSoklynFyactJuNnoaYFYYtys/qGBo4/6aSIBqHwHJdMqp8nHn6Y0a3N7N2yib9c8Qu+9plPk0314lpDTLpYa5m/8AjqGhtCPL/KZyudq6VZskGAisVpbajnwVtu4dJ3Xsgzjz3KUcefyJ9uvoVjl5yLbwPuveFGPnPR+1m/Zi2O44SFxf1YW6ULu9IGGoyS7Uc1tvR7tZ1b6n4GbQgpCtQXwhY913FYsex1Ln33e3j8nnsIrOGs976PP/7zn8w+YC63XnsNn37PRby19BXa21tDKkQQFOjvlHehWmvi8Ti7tuzghaefwvNcHOWxdsUqrvj2//KfH7iYdE8fSIGSIW3giGOPZ84hh5Lq6UXIKP4dhgdACLTRnHDqKQgpsDpAuQ5dnR30dHYzdfZsph8wj6wfsGfn9qhxPSxiLTrtZMaOGY+fSZXZc7LoywiFEQIhIZvqZebcA5kx70ACGzXbKMna1W+xYtkb7O7swA98xo4axea31tG3rwfpevn+BMfxUEqFi7Oa5xd5FBcTUVF8bWhqbmbHpvV85ZJL+N1PfkRLWxtX/OVvfOYb/0OypZkVr7/KZ993MS899SSO6+IbA8aGz4/alCPKVbyrGdzSnzmVXFstVd1yGftQsX3FSp2N4kls6KZdh8fvvYcffPXr7Nm9h0RdE5//72/y/o9dSn9vD9/57Fe597bbaUokqKuvJ6sDhJV5l1yD2cBRlntuu4lkXZxbb7iRF599nnTvPnTG57mnnmTxueeGbEdjcVyHxWefzbJnnyMh6waFV1XXvpQYrWlobuao44+PaAkKgyXW2Mzvr70WJUPxK0eC9VwMBmkhG/iMGzeBo044nrtvvYnmpkT1ukOUE0ih6EunOfK4Y1Geh68DhFAE2jB15mz+etPN3HvnnTz9+GPs3rGDi997Ee3jxhFE+Za1lt27drCvq4uk41bt/rMlt9zakCeV9X28qOH/qp/9guWvvM53fvkLPvaFzzFz7mx+8I2vsXvrZr506aX81+WXc977LsbXBjUMXYpqBMxaPEARCrS/uH7VDxoK/bFgRMjg9JTL9X/9E7/7/g8R/RmaJoznGz/6MceddgqrVrzJf3/u86xe+jrtrS1oo0MqshRII4uoxoPPyQ76tzaWdCqFCTT1DY3E4zH6untZdMZp/PTKPxFonW9S37ZpEx8651xMJhU2hGhbIJ1SmcuilKK3p4cFxxzNb6+/Hm0FrhSYSGpFEOYaVtiQzx/F0yJKyGNejMcevJ+vfvSjNCbr8QNdGW4V4d8bA1kMV99+K7MPmk+gA5R0QwkWa4h5IUu2b98+Ojv2MHH6DEy04azWJOIJfn755Vxz5R9pbWrJb7ra8kAziAMVkw77OrsZP3sGl//85xx25JGseuN1/vtzn2P9ypU4XoxPfunLXPK5zxIEGinFkFBn7t+mQJdpuOtO1hqj15qUVAuBqt+y8PM95fLbH/6AH339v+nt6WHsnFn8+rprOe60U3jsgfv49Hvex6Y3V9DW3oJvfQJhsZLKwlVVztGgkEKRTNbT0NSEUYZ0kCUZj/Py00+x5q1VUc3B4GezTJwyhWNPPJFUfyqMN0XtxsAYw8mnL0Y6Tlj9NZHWkAIUKEfgKIkrFI5QKBV6CCkdTGBZcPTRTJs+g2wmG7JHK4lvYVFC0Nffx0GHH8bMefPwAx+JwGiN54YNPAGGVDZDXXMzE6fPDGkgVhB3PRLxBPffcSe3Xns9bY1NRQnwSIyjsoa0yVLf1siejRv54gc+wK3XXssBBx/C76+/gflHH4MNNFf94mf88nvfyzf9D7WQc51wI2EU5M/tsssuu3wotzGSBT9k/UAIBhRpwl5dJSVXfO9yrv/DVUitOejII/nVP65m0tSp/PPPf+aHX/8G+AGJZDLE0Ak1bMImFFH2vIqRrBwHJfwSeRwjxLVlFEcrx2Hvnr20tLax8NhjyQQBnpJIqfBiLo/dczeeG1EGKlj93DUqARifeHMT//nNr9HU0gpWoCXojM++zr309nTT1dlBx9697Nm5mx1bN2OzmnhTI8JaAmtIJpLs3r6L5596hngyEYaeg4KP6Eoc8PszfOiTn+bgwxdgfB8jFI6juO26a1m17HXGj59AQ9T8ns1mUMohnerjofvu5car/sSffv3LUPRLOIMMS6UCaTE2VPIlJFZbYl4Ma3weufde/GyWk846i9POXcL6tWvYvHo1S195hR07dnDCqaehRainKqNW0KFCmxHVqEpbImtl09XKEq1YocypklkTNn5Y+MHXvs49N92IFYKjTz+d7/3iCpINDfzs8su47sqraGlowsoQHRI1bLjh8o4KF25/Xx+TZs7gmjvvxEnW4QgLQpLu7+Nj55/PxjVrULE4NuLylAtJrBQ4WPp6ejj8pBP4/fU3gIFAGxzX4forr+RPv/wVzc3NZDKZkK0Z+HR372PhwkX86eabQCm0EDhSsvL1ZXzkggtwciS1SECrMOwTWLTQeE6ca+6+m3HTpmKyAcJx6O/t5ZJzl7Bl7RrGTpnGgkWLeN9HLmHGvHlkMgGOI/nHn67kF9+6jPFjR+ELAX6uWYdB4ciIQ2dpcZB0dHVz3vsv5rKf/BSL4bIvfYH7br4NYyxnX3QR3/n5L0K2baR7mi/EFagL1iLLUy2JlpU6q4aL4lRCgAZb4YKmEmtCN2/hsq98iduv/QdBOstp572Dn155JV4izv988XNc94ff097UjCHkmYsa6cCl11YrFGuNoa6ujk1r1/Dyc8/iKokxFq0DEnX1HHnSyXT39iIFFRdCjhJtpaA3lWbBUUdjtI3U3AzWaJ5+9BG6O/fQ1bmH/t4udCaFMAH1dXGWvfEqq99agZACtMEPAmbMnc3MeXPo6+tDRcoWCFuMwClFqqefOYcfyrjJk0Oyn5RIKVj2ykt07NpJ25h29uzazg1//wsfee9FbF63Dsd1CLThI5/6DB/99KdJp9IhgxNTNdzI/byWtVBEd7CW9pYW7rr+er78iY+TTqf57i9/yzsvvhhPKh687Ta+97WvIazNh8e1GOjhRiyy9AdvpzjuUD+3Fhwh+f7Xv879N90KSnHGxe/hu7/6NX7a56sf/wR3//NG2tpG45tiaPP/WltUSolj4f5//3uAx2MhwHLqOUuIJZMEvl+5aEjYk+xns7S0tXLWknNRSuFFGp+9+zrYsGoVdQ2NYd+yECAVQjkkYnF0KsvD996PEKH2qLLguR5nnHM2GosjVdk6nBASAstJZyxGKIUwA1HSo/fdx/at29i9pxOJYNL4CXRs38H61aujxR4+o8UXvhMVi2F0ENKka+BrVQ+JyiB+WLJBlpbmRh696w6+8JH/oKuzi2/+9Gdc8JGPoITg7htv4Ptf/xpOBaRnpD0DRTBoLclGOSJRuXa0SicWWqqIyx/FzUFEDfjJZd/i39ffiCMES97/fv73xz+ht6uHr33iUzz76MO0trbhR0plA4iRLaxD5pM/IwTCChzro0UYzw9XO7KwCOcl47z8xJNs3bie8ZOngjUEvs+cgw/i8CMX8fKTT9HQ3FSxYCht6DlaxrTzxAP3Y6Qkm82ipGLzurX09PTiOR6BDkLBLgnShGFNY30D9910K+tWrCSVShFk/XDRpNO0NjVhwmwlpIkU8mh8n9YJ41l03PEDXV8iFMb90Kc/xdQZM3j4nntZs2IV+/bs5fCjjuKQIxZijcFzFUIIGptaUI5DOtuPLAAly6NOYKNGbEEozx5xYxE27KvIbayBNZOXwCDra1paW3n5iSf58qWX8rM/XclXvvsdgqzPHVf/gzuuux4vGeer3w6JfI4EicWWUcWuhPsXtoIOWqfDkUWpprBVC4EpR3DTWuM6Lr/78Q/5+69+DUJy5oUX8t1fXkFvXx9f/tjHef6RR2ltbY2S3aFjTYkBBQaFCCCQAmXNiBKlfHyooGtvB5/6729y6We/gO9nkQiU63LXzTdx2ee+SEtzU/4ci85PEArdEsKd3b09+IGPNRZhIe7FaGxoDFWhozCiyJJKiQ4C+vr7BhALFVZyY/F43rAUbj7Hcejt6eaU88/lh7/9Q8hrCgIIdEgBiaBPsKx6cznbNm9i/uELaR01KlSmI9RLev2FF/nYuy8kHvdQVkQMqsrcMCNstPijJDxqjw4iWRc1BIcHaYk7Lvv29XDIoqP42VVX0dzexmVf+AJ333wTQlg+9l9f4uP/9WWygY+jylcKatWtLXyvuuyyyy4vl0yUVnhHsilKraGVAl8HeI7LtX++kit/8hNEYDjurDP5/m9+Qyad4auf/gTPP/IwbS1tgxZWJVxfSIHQDqm+LIHJklBJBLqoZ7fS9Q2x5QlMQPe+bs5914VhZxYS32hGjxvN4w88QHdHB0KpspXnfNM8kEwmSSSS1MUS1CXrSMbioRZ/6caWOcnykIOUTCaJxeLEYjE8z0M55cl3Mqreeo6ir6eXLZs24cU8Ro0ZTSyeQCpFNtAE2QApJaNGj2HazFnE6+rCUEdKgmyA67rcfM3VvPTMU9TX1YWQfpUQR+TRPIOQBm0NqV6NCSwJz0FajRWyaourEGFBtT5Zx+a163jttaWcctYZnLZkCWtXrWDz6jUsfekVRrW3c+Chh5GNuENlgYdhNlqpyy677PLSkGUohd2RwKDhYtLEHId7bruNH33zv7HWcNgJJ/DTP/4RIRVf+9SneO7+B2hpaSMTBDUgPSCVQGcDbAxO/tAi4m0OO9Z34Dkij10M1edcOVa1OHGPPdt2cNjRRzF+0hQIDI7nkEzWs+z5F1i9cmUFklrJ52mbr3YjJFaJaL6Aiu6hzG+GHMafky4XQkb/X7jPRPk4WEJ3ZycvPPU0997xL5557DH2deylobGJUWNG4zjh52XTWfxMSHEQMpRo8WIx1q1axRWXfxtPCbQMQ8qhWJrSgpUWYw1OQnLMe4+gZVwjG9duJi5CeZehGQKgrSaZTLB+9QpWrXqL0846lxPPWMyrry5l27qNPP/MUxwwby7TZs4iCIL8pi8HegwbBi3XiT8cGvNQFWAdaBzX4fVXX+E/L7qYbHc3Uw6fz++v+Qdtre38z+e/wF03/pNRLW1kc6JQRbz2KK0UJl9ddKUi6A1wR7ks+fTJTF00iswuze+/cit0GqSTUysTNYVtgyyUAEdJujv2sfiiC/j+r35Hx+7dPPXoo9xz++2sW7acII/qhLKLOS03keNkyLArSxDJIgYBgdZkfR8/CBCE2qRKyqhFc0AHFGtDvn3uQZuwPdFxHVzPQzkKaVX4d4TW19jwvimhMFqTSafIZH0am5s54qhFnHr+ORxx7DGMHjNh0PUue/llvv21r7Fz/QZcz8E3NqyUVpF6sVGcr6RDV2ofRy4+nDO/cCyp3hSv3vMWj137InEbB09jrI8wucEcosiQDXyMxXMkHR37OP38d/GD3/+Gjr17+fTF72fdstdpHTWW3/3zembNOxDjB0hHhYauBsmUsqhUtX6AoWL6WqXQTaRKsGf7Tj560bvZsno1oyZP4vfXX8/0mbP4yf/+D9ddeSXtLe0hZ6XEyls70JEUWmaBUtDbl2XsAa1c8NnTUKOSeMaw/OG3eOiGF3CNm8fH92cDuFaSDXy8pnrOOOccnn3ySdaveou4UsQSSawsKKiJsKorhUSbAJPRZFNpskH4oBL19bS0tTFq9ChGjR5Ny6hRtI4ZTXNzM/X19SSSSYQKufdBEJBOpcn09ZFNpeno6GDPrl3s2b6D7du20rm3g3RfP4EJYWHHdYl5HkKFg/LCLxNWlWW0GTJZEIbR48Yyc+48ZsyeQ3NbG5l0mreWL+e5xx8LdVHjCUyOb2QHmpLKxv/WIKTFNR5Zm6VhXJJzPn4qjTNdHKHY+NxO7vrzo9g+8JwYgfXDVLlCYUsgsMLgSsXujk4u/sTH+Op3vsu61W/xuQ9+gF2btzBtzlz+eMMNNLe3YwBVZjhgzX0rw50PUOt0j1LXZLThCx/4MM8+/CBOSwM//9vfOf74E/jHH37LFd/5Lq3NrQSBrowbo5FIpFYIB3p6+ph08GjO//IZeM0eIq148qbneOnOpSS9BgIVRNamuFpaS2NFnmQVtgmHqBWWVG838VgMLxY2wmst8jRcpRyECcimU/RnfZTr0j52HFNnzmT23DnMnjeXqbNmMXrMOBqbm3BjsZFRf7H0dHXTsXM32zZvZvXK5Sx//XXWrljF9k1bSKf6cJQiHvNwYw4IhbUD5ykxUSdcP5nAByRO1PCeSMaRUmGNLDI41YpJ1hqQoIxCCRXSoRvg9I+fwJSFY3GFYstru7npin9Bl4tb52KNodyowAGgJEy7HeWwr6ubz//v//LBT36CF558nC99/OOk93Zz0tln8eO/XkVgwUHmC2Wlz3hIUYZq8wFqYYXms2mligoiuTg2CMLE6lff/z7/+N2vUY7DV3/wUy78wMU88K/buexznyOZqM+L11a8KcIgrUAJl87+vUw5fCrnffoUVF2Ak27iwWsf4vVHVlMfbwZSgEM5rmKtG6Aovo5CMOFYtLVRb65EiRCpSaVSBH5AU3MjM+fNZeExx3HY0YuYccAc2kaPGsx7ivRErTFII/LNNzZiUoq8dbXonIqCCd+DkigxGAPp7+pm7Zq1vP7yyzz/1FOsfP019u3aieu4JOrq8l1w2uh83B/SUWwepQnVIEIlCWqpqkYeQhK2X4QOUKK1JpCaMz58ErNPmYSv0+xZ3c3Nv/k3eo8kHk+E11nxWUSqpjLcJj39KX7w+99z2rnncv2f/8LP/vt/sNbwya99lU/813+RDQLcqMe4VAYltw5z8vSlDOaipvjCN+0v3AmWwBhc5fDQ3Xdz2Wf/E5P1eedHL+Wrl3+bZS++yKcv+RAi4yOUm8ezi6gSNsSYhQCExhUevb39zDxuEmd94kQCz2D2Ke666l62vLKbhmQjWRsg8JHWjZiatZftB9U1RC5AzSWDBuVIHCEJMln6UimceIyZ8+Zx0umnc+wppzBj3hyUcvOPUUfsS2FFHvGgRCsoT+G2hZEwBRXv6B4bk1/4+XkB0UNW0ayB3Gvn1q289NxzPHLvfSx94Xk6du8i4XnEE0kMEqt1qBEaDhyOxhdbynUdDxkOW4GVJhpAYvGEQGhFl+7iuHcdxWHvmANS0bO5h1t+cR/pnZpY0gm77ayMppOFFfjQ4JiIPhTNR/YDVLKOP9x0IzPnzOOyL32Jf137D5LJOn7+179z9MknoQsYpAZboBE8RCRTuAGGM7SukmBt0Y5Tiq3r13Ppu85n77adHHnCKVxxzd/p6tjLxy+8kG2bN5Osq8MEQdliS25kpxACTzr0pHuZc8xMzv74SfheP3qvw42/vYftb+6iMVmHNiY6jijOGWqcMDLIu4VE6zBRlQopLP2pfjK+z6QpUzntnLM5+eyzmXfIfFQkwpvT6Ze5jSNF0YaqxHQfrr5qOU9c+AwKRzytX/UWD9x1J/feeQcbV60m6cVINtRjomYfYQZmF7wtLwtSGIy09KT6OfrcIzj2PfOwyiO9Oc2Nv7qd3l0BCbcOo/2wfdUWrj9bJLOulKS3r48DDpnP7667FqlcPv+hD/Pac08zaeZs/nTTTTSPGlVWoHlEG2B/hhHnjqG1RRrNFy4J4/6xU6bzu5tuYOKUqXzlox/n0Xvvpbm5KVRFyxnAnK69hUAEYA2OlRGRK8UBR0/nnM+fSqBSBHvg5l/dw94VXSSTcdK2H2m9gqnpclASXMsmLgbXDY4AJR16+1OksmmmzT6Ad77v/Zz1zgtoj8KbQOcmLoYqCSOhjwzyPEVxRm1gREG+mtfnRKr86Ke+7h4ef/B+bvvn9Sx/5VUcbUgm6wmsxeRV4WpY35XuX8TqNQKENQgRTr3s60uz4Py5nHDRQqSEfZvTXP+z2zF7HGQsrFILVEFdoPhEdCRW1rWni3Muvohv//KXrF2xik9/4GK6tu9g8QXv5Du//U3U8+Dk3WctpM6yhbDh4fsMsrKhdo/i77//Pbddcw0JL85Xf/hDDl+0iKt/+3tu/stfaG5tDtsXiRJNUYJpI1BIHCXoTvUy/uDRnP+ZxRAPoDPGbb+5h52rdpOsS+KbILLTIn+cajlNNf5TISPUUQo/HSaMsw6bz2e/+S2+ctnlLDj6aJJ1dSFFIzd3V+7fgOci4h6CWhtkq5EQQ5w88krWEE8kmDVvHudceCEHHHgge3btZs3qNeHwvFi8OPwsJIuXqROVvdYIcpZYjJAYBNJaYrEEm5fvwrGa8QdOwmtzmTJjMq+89Do2A450C+69yOcAA7IgoXdK1tXx6osv0TqqneNPP426ZJLHH3mUVcvfZNTYURx46OH5sVeI2irCQmttaxlVOpQSlxThojXGoJRi2dKlfOqii+jr6OSdH/gA/3PFL3j+6af54vsvIeaGAlPW2PzQCAZZTosnHfpSfTRMbeB9X3knTqtGdLvc9uv72b5sD4mkS9pmwq4q4yCEGXJzVov9TfTwXCkIAp/unj4mTJvOhz7xcd7x3vcSSyQwgAmC4o4lKg/gq9WiFs8PyLFJBaKou0rkaQa1hk9iYGVGAl8GJRXKCafCP/jvf3P1737PijfeoCmZxHVdskZHcxZkHgqtRQQtvzlsyMvK0dyRlgQOvek0R79nAQvfNQ9tLetf2sztVzxAHQ2gTFRDsYUq8xHNJby/VkmktohYjD/cdCMHzDuQr3/6M9x70020jR/H1bffxsTpM0K6uZI15axFHqAWq1+J+SdERHoylsDP8r9f/Dxb3lrN7AMP5Nu/+zVBJsvXPv0ZuvbuwY052EKVMzH4MxwhCQIft83j3V88l9hogdMf484rH2Dja1tI1tUR6AAZtRSWus3hVn1zd9qTkp6+HqTn8qFPfILLfvkLFhxzLFI5A4Pi8hVIkSeBjWTxF1tTixAyTOBkjiIR0kesiPg4UWU2n1Db3NywKnSPfDNJQeU46qkAmDVnLue86wKa29pY/sbr7N27h2Qigcp1F4jiMGyoxZ/znoXtMLmhGcqTrH5jHfWJesbNGEXTpAQNDU2senkNcSc+UFPJi0INNCuF1xsWAdN9fax5aw1nnHceCxYewZOPPMj2LZvp2NvJaecsIbAmL7NSKtZQuiHU5ZdffvlQhKFK1rQojJAC31g8R3Hdn/7EXddeQ7yhgW/95CfMPvAgfv3d7/PE/ffT3NgYFbuqF92EdvBjWd71hSW0zIwjfMUDf3uC1U9vpKGukSzpmsYH1cwJUQoV+HR0d3HoMcfzg9/+jnPe/R7iiTjZqKVQRrSFig9+GPFy2XCsYAheCM4YMDpkVZoAoTVWWIzVOdwkj3/XKmsvRPHC8AON43rMX7CAU846i917Oljx2htIofBcF21N7d6r0uZAhP3OWJSjWP3yBtrGj6Jxapyx00dhM4K1b26gzq3HGJtnl5bSXnIgQyLm8taqFSAdTjrzTBpamnnmoQdZv3oN06fPYva8uSEQIYdeH9KWuLfiAW0M2TyS/7c2uFKyed1abrjqzyjpcO7FF3PMqafyzCOPcst119DU3BAuJls9xhVC0mP2cfqHTmDMwc24JHj5jmW88dgK6pMNEX1YDMvSll14Ed7tuA6pvj58x+OLl3+bq268gXnz5+P7fqjfI5wCCu/w0JtqXnWQVTImbECxMpRxlCCVh1Qu0okh3RhKuZFciYdSLtYwZPJa7OGLP9tREmHDvoXxkyfzo9//lu/97tc0jhtNZ08XrqPy413LIXW19AEIK9BofBsgtSIuE9zz14fZtywFWI577xHMWjSZ/v6+ELywtuziz11LNtA0NzZy9e9/x9Jnn+ecCy7k2NPPwKT6ueqXP6drbwdCyprWclEOUEn6oqZB19qgXIevfebTPHzjzcw8eD5/uPUmHOXw0XddwKa1a4jHY5ggxMRL8zxhQcsQ6+/u7eGocw7hpEuPxBc+6x7azl1XPUidV48mKHCRtSeYORca8tejaFtYXBQdXV3MmT+fb/7oB8w79FC00RhtUMqJimA5EhtF+PJw6Lg1Q5oiByMKOjYtZc/yh3G82AAvKkd7MQG4CSYvei8q3kRE26xaDS3rtaLago0a942wuMplz47t/Pzy7/DgXXfR2FAfhmLGRENAhtl7a8GI0GNJoxCOJsgIEqMkH/jmBXiTJWaH4Lrv3EbPjhSO56FzJGw7wKvKFd6MCBuCUt19zFu4gD/dfAtbt2zhU+95F9u2buHSz32B//zGN/F9HxWJj4kKg/uKmuJrlUgsfWkT9rg+9eBD/OFnP0NIy2e/9S3mL1zI73/yUx78979oamzGBKayJUUgHPD7sow/aAxnf/xUgliajpW93PW7B3DwQjdq9mOmAAPJtpISbQN6+vq48IMf4ru//TUTpkwh8IO8xQvzUFtWkW2kiM9QjNkQBdZIqeh86wm23n8V2e1r6N+4jNSGZaQ2L6N/03LS616lf882xh5xNjJWX4yBVqQt2AqUWpkPvxRhflDf1MRpS5YQiyV49uknscYQc1RUYRXDvayBHEmExJaYE6O3u4/d23dw0IJ5OI2S9vGtvP7cSlwbH+CgRLlRLtcKUaZQZTueTLBu3Xra29s55pRTyAQBLzz1DOtXvsWxJ55A+7hxaBtOx8xtgDJp3/DgtnLXJoSgP9XPX375K/yefhacdDJnX/gu3nzpJW7+299pampBD8Ht1wqEr3AbBYs/dCyZ+j70Xsn9f34UmxahDo+xVcOwoV6+DAdhOEKRyWQJNHz1Rz/g6z/+YZhUBzlJwhJI8m18VT/nHAs0/JfjeiQamvHqGnHidahYHcpL4sbr8eqaSTS0FtQ7hh4wV5vorMBRDr7R+EHAh//zU/z0yiupTzaS7k2jXHfEYWex0dTUxxvYsHQbT978HCYwjD1kFEedv5DuVBeecVFGhegVJj/kfGDVSQJtqU8muPJ3v2Hb5o1c/KEPM/eQg9m5fRu/+8XPEZEaXjkqTMUNUE3WsFwDtDYGRynuvulmXnvlRVrGtPOZL38VKRS//8nPyARpPOVQCtIMzjc0vZkuTrz4WFpmNOBmPR6//ln2bujGicfylr9a407RNYjBniaclhJCq15TPb/4y5959wc+RFb7WEu+eppDecq1fBZNiawhZxpJfSUPy2qD1j5GB2GhymiMCblIImrezzUjGmv3awxV/ncyRH4cEVaTs77P8aedzu//eR1jZk6le19XfhZb6bEq8cQG1SysxAqDNgEN8RZeuHsZa1/YDFiOPPtgph0xkV6/F6lUvs8sF0oNGIiw2TLuuezbupWrrriCeH09H/3c50g21vHkgw/y5MOPhkxYY6sBf9SU0JTj+pioZrBvz15u/vNfsUHA4gvO4+DDDuWhO+/i+Wefpq6pPoQP7eCQx+biQinJ9KWYt2gmB58yCyklq5/YyPLH3yKRTJA1meF7qSheFdEDtdYSl4q+7h5GT5jAH6+9hqNOPAk/m8UL6WBlH2ipKln+xkk5siCnlgJjbpNpTeAHoeezYZukzCfOEc8op9RQIbQcKTomwk5FPOWQyfrMmDePK/95A3MPO4y9nZ1RW2ItzKFKy85ihCZAE6eOB699hr7NKayX4YwPnECs1Qk71bBYK8qGzAjQ2tDc2MS9t93By88/xylnnc3RJ55EpqeXq/90FYGfrd6pWMnaV3zgeSTBYmz485uu/jtrV61k6pQZfPgTn6Kvp5u//OoKXNdBBeFOLRxHFO5igZGhDqTxNY3tDZzy/mMxMkvX2j4euukpYm7I71FaMlgHv7pHyXVRRUE1nuvQ09PFxANm8Ltrr2X2gYeQ9bMox8XKAfZjuUVfavUrVo9rZM9WkhAJPddAFTOEP3PN5YU1k1Crx5piCMgOY6OVSsWU1f0PPyUUAQsC2keP47fXXcexp55KZ1cXruNE8bUYsnBaPCwwWtQmLIbKOPTtyvLoP59FBi5N05OcfMExpDN9SGRR/C6iApvFIq3AGtDKwfg+f7/iCqw1XPqZL9DcPorXnnmKJ+6/H6VUWPcoA2DIYaMYBS15rpLs2baN22+4AaMNp7z7fCZMnsKt/7iGFcvfJB5PlB3yHD5oizQCR7ik/H6OPe9wkhNdshnDw9c9S3avDudYjVT9RAqMFAhtiElFz75ups6Zy2+uu4aJ06cT+D6ucgd9QNVS/wji+kobpRyPpvxlFBS0Cqqy1oQ6qiPJQarnAOU3UU4lurGpiV9cdSXHn7GYPfu6cJQ77M8uvb9ZC/V1ijUv7GDF05sRwuWgk6cx8fAJ9KUMbgkMWrrpbaBpqq/nuWee5pH77+PQRQs5ccnZ+L0prvvTn8lkMyFJDjvyJHjgBuW4GeFCuePGG9m1aRMTpk/hPZdcQteevdx49d+pq09Gu678RQthcaVDf6aPiYeMYe6JMzEaVj25nvVLN1KfrMNoM2wLm7cSOZVp5dDV28OkObP51d//zphxE0kHPlK5gyT/arGatRQFB78nyp9sIeXbFlhDm58yPzCHK8pFovljomB0aX56I8VthYPEuYZIeiuJnVWqDeUsqUrE+eFvf8Oik05kz759UaN+bflOWe9nNdZIkl6cZ+94gf4tGYxnOOaCwzDJNFrnUrrycK6M0DoHwQ1//BO+7/Ohj3+SljFjeOm5Z3n83nuRUkbUdFv7fIBKNy8X++/dsZN/33YbSgnOfe97GDNmHLf8/R9s3LShSLqjrJUJfSw2FnDyu49DNAnSOzTP3/Eq8VgMX2SHPI+qVdjogfX3pxg3dQq/vvqvjJ44kcD3wwEQYnCMX/rg9z+WzlGzQ7FbJVVErZb571LkIFdZhuMj89bfUlJ4JBoIUTh82g4foaw1bCsMhXVgSNTV89M//J6DFh5B175OXNfJe6zhonSOtWjrQCxLamcfT9/6HKQcxsxsZuEZs+nPhNqleZnRUtqOAN8a6uqSvPHCSzxy3wMccOA8jj79FLLpNLddex2B7xdNoam6ASrJCOYWirEWISV3/fNG1q14k/EzpnLBBz9EZ8ce7rj5RhqSDVHBi4qdRVJK0v1pDj/1YCbMaQcNz93zCl07+hGOgzCyKu+kEqqRd9lS4mdSJJoa+ekfr2TcpKlhYUSpMPyqIPhaLbmttOHKFQtzHB2EINBp+jMd9Kc76M/soy/VQV+mM/z/zF76Mx0Y6w8K93KeoRAaDZP7geQzp0KXl4yw+08NKUXBSr2G6yh0EFDX1MzPrrqK6XMPIJXqx3PK52rlcowi74JCCI0NHGLxOl5/ahWbl27FOoKjlhxG29QGdDbkYRlpBjxlDpm0IIxEG4FQgn9e+UeCwOcDl36UCWMn8upLL/Dso4+FXXHWFvHGnOHmANZaHKXo7erkjltvJqs1Jyw+g1Gjx/Kn3/6arZs209bcRDbC/WW5DSDABIbk6BhHnDGfrPLZ/uoeXn/sTZLJJNoEEfw10nqSCJs8rOI7v7mCWQcdiJ/1UY7KqyZU2vDldERrQcfK/t4apFS8tf0VXlxxD27MDUe0RoxObS2B8WnyxrL46A8Tk25+2krxIim5eftRhBtKG7XWiZdSKXzfZ/TYsfz4yj/yiXddRLa7B2KqIl5RC03dCosyDo/fsZQL552C29rIUUsO5/4/Pk49STBhWF2OCWMiyvQbr77Kk/ffz8nnLOGIU07k39dfz83X/oPjTj2lyEMVeYB80/QQw8py/ZSP3X8/m9euZsLEiVzw/g/R272Pf19/E7FkLByrWQUjlkLS7/cz/+QDiY9z0D3w3J2vIlNOPsMXdrhrviAsAvb19PClb3+bo086hZSfzWPX1Qb/VZokWMtiKkKNKO6wyvpZ+vVe0rqHtOkmpXtI6S5SQQ9p3UlG94CNFZPiGJi0IijsjqMIE8/lDILap/xUyw/KGYNK1A1HOfhBwLSZB/A/P/4R3dlMEeZemiNVqgsUbXZjiccS7Fy9h5VPbEAhmLVoMuPmtZPJpMNQUVRfB46S3Pz3q8HCO97/Phoa63nxySdZ/sorqGgA+JAhUKXSuVSKwPe569ZbMb7PqWedxdQZM7n3ttvZsnoNsXiMwJoyrtjmk87AD2gaX8/BJ8zBSsPGF7eyafk2vEQcbTUDkwOGbd9wHEVHRwcXvP9i3vmhD+D7PjHl1gQmlUsMR2JJc15G5Mr5FhyhcIgjjYPQAmEUnogTF3FcGQ2EEKbi55dtgzQlaIitrf5Qauiq3YOhZoMpKclmfI4/80w+842v0tfTh+e5+ab7kXirAE3cU7x035ukdvbg1AsWnHogWZsN5fGrHFJrTaIuwSsvPs9LTzzDUcccy/wjj6C3o5O7br99EFwsy6ECg1AAwrjJmrD76dXnnuO1Z5+jvrmNd1z8PnQQcPdNN+MkPAgs2HK71GCkRgmHTDbNwsXzqZsYw3QJnr//VZRwQ+kTE1UKJVXHqA6yHliUA6m+bg49ehFf+va3CyixxQWbWvHxUjnwcgMBK1nW8P8jVr00IFxkWNQPq7bhKEAQDloKJD7CiJIsVlTHoweRakVVqz9UcjrU1PWy0KkF13HwdcCl//mfnPKOJXR2doCwaGEwamAT1DxMxUiUB707ennt4bcg0EyZP5aJ8ybgp9OD2k4HPR8gyGS5+bprUVKx5N3vJZ6I88QDD7Jr85aifulhBNoDH3rvnf9iX2cnBxxyMAfOP5TnHn+cN5ctI1GXrNhYLXFw8QiyPqOmtHDgMbOQSNa+tIWd6/YS8+IjGsuan4krJDawOMl6/vfHPyJel6wY0w71ObVOuxzKU9iSImIoBQJSDejYGGNGXusoqYyWO42RVqxrziPyqIxEW/jqty+jbdx40ulsOO7JjgCYEgZtIR5L8Majb9K1rRunMcaRZ8/FShX2iZcLn6IvHWgaknU89/QTbFi3llPOOYfJB8xm0/r13HfnnXlBL4j6ASpZ16IBdsYilWTXjm289ORTJJN1LD73XISQ3H7D9VF/b7WQIRRDyug080+Zi9cu6d+T4eX73iAmEpgo9Km12FRqnVzHYV9vL5/68leZMXcefqQdOdICVrlkuPYh3xTH6xQzuHNSj6HaoY1EcqvZ+nLWO1rw1lY0VLUmtqV54HD4Srlrk0ISaM2osRP46ne+jR+RDkWVhppK919isFaCFPTtTvHq/W9iA83E+aMZf8AY0tl0/tkW0d3zHkAiPZeujt3ce/MtJBsaOe6MMxAYHr33XvxMFhlVl2WtVcGcZssTjzzCtg3rmTZ1GqcvWcLGzRt5+Zlnqaurqzq+UytDOpuioT3JtCMm4RPw1isb2bVuL25MYghGDGIrpejq6ebks87ivR/5CEGgcYWsGQqsFhKI/UJchtp8w/e+hRBrTlDXDhHz78/A85oUNEQIWnjCJfADTjn7HM5/70V0dnUhHTUswxM5AKyVBPi4cZeVT28ktaMHrzHBgtPmEjCgFVt4dwrHtmasJhH3ePTOu0mlUix517sY1d7Oqjfe4LWXXkZKGSl5FMS7FWHA0JdijeXxO+8h1d/HghOOpaW9nbtvupW9e3fjKAdMhYUESOHiZ7LMO24mdaOS+N0+bzy+GsdRaBkgbHnewyBEQgxocYYisBrjZ0g0NPK5r/93XkzJ1hBXlLMewyngVAudCgWt8vi8HagK5xaOjaZcWmwkAlboB8N6RaivYJDCRmFUDssurSyXJ6cNl9YxVDW3rIeI2HMyGif1iS9+kaYJY8imMgN0jhpzES1kSLQzIJVLX2eGVU9tRVqYdvgkxkwdTZBJIyRoCZLBhldpQZ1Xx9oNa3nm0YeYdcBc5h12OJ179vDwvXeHn5PzAIWurxwKkaM8r121ktdeeYW6lmZOfce5BL7PE/fdT8IbSh4chDbUtXgcdMwBKFew7Y097Fq9C8+LU85L2kpSiYSsyFyBTTkunT29vO8jH2Hq7Bn4WT/Eekvg3P8LC19DOWKQJyhHGaieR9j9GgdVq9jBSI5bafPoIGDU2LF86rOfpSeVRilVk0EqCvnyYafBc+O89swKenb0oRrhgEXTSPkBWBdr9aCyQ8Szi4IhePDOcMzViWeeQSye4JmHH2bf3j14jjPQE1yt8pt7PfHg/ezesY3Js2ax4OhjWfHaa2x86y0SicSgCSeFx1NCkUmnmHTQBBomJPH7NMseX4P0Q7WDUAvKVL3JgyxT1BDe19fPrEMO5gMf+1ioRxQNq6hFGrsWxKMSNaAa+a3S/Ry8GEV5jL5cJl2wqWyJSoMo4ggNP9+ptQha6V6VXrNUkkAHvPO972PBscfS3duLErIIVSu3MW1p1TsyGJ7n0rWth42v7ABgyoIxxNrj6CD0kIgSsQKbKzQakvEELz/9LDu2buGUs85i4rTpbF+/gaXPPxu11dTwklLhZ7M89eijWOOzYNEiHMflntvvwE+lsM5g2LNY5MoiXMnBxx6E0+DSubmPTW9tx00otDChro8dvnl1hCCVSvORT32auqZGTI7eUCMnpnDKeLWE+f/SS/y/+Sp3jSMZKjHUBpGRvIt0PT7x2c+Gvcb7421FgGtdVj27Dtvr0T6pmVmHTibwM+EAvZJlLAHXRJw112HXjh08eu+9tI8Zy4GHH0pvbzdPP/JocR2g3MMWImyEllKweuUK1r+5gqaWNk456xyymQzPPfoYsboEaMosYBn200qLn8kyftJYJhzcDtqw/sVNZHuzCOkgTG7gRa3TaMLdLaWlv6+H+UcdzalLzsFonZ+caAX5/tGh4vRaxqfWGjsXC1xRRNYalBTntYAKLGEpF8hEI2WsxJroOxEBzsrcCJECGFRULWTVeo2VEDdbRiCr0uA8VzoEWrPw+OM55rRT6e7txlWiIlJV7dwCbZBxh01vbWfnW7sgbpmzcDrKNRirMEIPQqVsQQOF57g89fAjABxzysk4sRgvP/c8+/buGboSnBs88PKzz9HZ0cH0A+Zw+BELWfrCC2zbvBk37uUnPxbHYUGoqCAkWR0wcf443EaH7l19LH9pJZ5yo9a+sp6+Stw6UPQIgP/49KfwvFhRVbTcQqjkrkcSH1cK9YqMSAUOVC4JzikemGGhQQN0gfy5D3HfahE6GElyXNPvoplnH/74x1Gx2Ij6F/Jwh4RMKsvyl95EBJKxs0bTMK4ek9E4qIo1GGsMiWSC1SveZPfOnZxw2mmMnzyFzRs38vKzzw0kwVV54lrz/JNPkvV9DjvqKNxYjCcfeAgdZMMGJmHLpDHREAQrUEnF5MPGIZRi+8q9dO3oxnW9mmLWwZY69Ej9vf0cvGgRx556SthyqUTZc6+lFlBu8VSq+pYu+ooMx4rjWcvE0bZCMUwM1A+K/iZPjy6QZcTW5JmGOv/98XqlP89x8A9btIhjTjqJ7t7+PBu3muUfXJMK11TcTbL+jS1kd2uSo2LMOGIy2g9QBRug3PFcz2Xvjp288PiTtLS3c+Ch88mmUrzwzDPFwljlLlApxY5t21i1bBnJZJJFxx6LMYZXnn8ez3UiVeFSWXERIbWKbDbN2MntjJ82BpsWrFu6GRV4+42ta2N57yWXoFw3H0bVshCHa+nLHeftQFVyXiLftkltQmTlEsWhNnVpLaAazfztHkBuI2Gf9334EqTr5Dfu8DxACHrEXI/eXf3sXL0b5QlmL5iJG3cICKoifQaLsIanHnoYgEMXLsRVipefe24gBCotb8tI5xNg1bI32LdjB+MmTeSwo49hw+o1bFm/DjeWIGQmlaAZeY0agZ8OmDhnFG6doGN7Bxvf2IrjOqHA1XBCjigcVsqS6ethxkEHcuwpp6G1RjiK4UyBGW5MXLb6WSW8ymdBIppxbARYfxBanbNsAgUDapwDko9G5wfvhamAwAiFtDoUn8UiCWeEaWSOHlTz5MRyG7tw8uJwEK6KRUoh0drn8GOPZv7hC+nr70MqUTPiF6JiYc5jpMFkJateXEfQm6ZpYjPJ8Y0E/ZkimHXQ+WtLIpHgjddfJpvq47BjjyNeV8euLVuGQIGiA7383HOk+vuZOmsWDS3NvPjMU/T0dIfuzIqylUppZRjzxQzjDxyDET6bVm6he3c30nErWoGqPJwI+kxnM5x5/nkkEom8NEgleHPodsWhE8FqAzaqeYYcGc6EmtL5+L+4mWPAWCApiustIQWl6OFGqtQWEFZjjBP5Wh0V1Go3AtVaFmsBEKrd08JwzViD63icd+G7yUbzIIZjfGxExdEmhLnfen0DnVv7cOp8xh84ikw07abSeRlrcWMxdu3YzhuvvMwBBx7I5JmzECbSDRq0o3NuQ0p04LPi9WUIpZh36KHRhngWIWRFLyyEwEFhjM/YKe2MntqKyVp2rdyLkk40VVxW5OaXa6W0UaQQ+Jq2cRM449xzQ0dTgbtSTsmhcGOX4/VUUoOotUdgUA4RWfLuzN6wKGPt4CdbEM7kp9tEPzDSLT5XQESQIkIQ9PegU13hOdsg7B/IjWTNjVmtwFuqeQHXAExUy3msDUeoWms5bvGpjJs0iXQqM8yEfKDjznEdUp0Zdq/rQUifmQePw03GwjVVraYjJdlUhpeffR7XcZg7/1CymczgJHgAwTAoKdi+dQtb12+kvqGew45cRDadZfWyN4jHYlVH6khhkQJam5oZO2YUfsqyY8UeYsoDkRke6yeanaWkpK+nn+NPOY2xEyaG4c8QVdXiRRzx7XPQqzVlBK5M/ssYU5Bg2gELnq/O5n6We78OcyLCBnjlSPr9TjbteAsZTS4pWoQyFH1y3FCA1hQ0twA48bp833DhwD5jBVI6mHQve1c/Gw4lsQqpQ6kUU9AoYwpoLpW+avUAxpiqvKKy3iTybto3NLe3c/xJJ5Hq6x8hSzVseVQWtq3ZRVPDaFpb6knE3HwFuOzyiSReXKV4Y+lrAMydfygmCIpbIvMfY8iLEa1evoKOXTsYNW4scw8+mPXr1rB72y48zxs0m7XwwrMqwPEctq/ayV2/eZBUv6Fjdw+u6xIYgyyoeA4J20VNr8pYhCc59R3nDFAsyjSNGGuRwhKOuxiYYvm2vmo4XFZ38fyKe0ll9uE4TiRrXrIJEDQl2lHSwQThSKMcjBBvnQDxxkhATEQTHG0Y9VtLLB5nx/P/on7SITROmR+OFh3BpYQNPGGIZgjFZIeTL1X1iBDK06jw7086+xxuvu56hAk5UBIQxpbtohw0gotQLS/meqx6fhXO7ySbVm8myAYoKaL7GwoMiJKBi9YI4rEEm1avpb+vl4MOPRivvm7w/cpN/s4nwG8uJ9XXy9SZM2lqaeGBe+4m3Z8i1hrHVND7FAhkNoZxsgjhsOzhzRhhcDyHgTkgw8OjhYBMKs3UmTOZf8SCsDlHyvJV3yiqCJvyNUIoOro30J/tG1hIMj93JJ+P2EGdaCZ/5wvHBhUMVcs3/ucKdMYKjA3o6d3O+m3L6UztIhYL4cDSfmQhQKEY1zYNiLRPpY2CIEP96MnEGkcRdG0Jy/061EwOG0IiEa10F6v/eRmjDjyBxMwjcL36sGk+asiXIpRWMUYXeKuBGoLX2E6sdUqZ8hRlG+OrLdDK7w3rAdZaDl14BFNnzWTX2vWouhjUKLZb9DmOxO83vHzHS3ieh+O4+MaihUTakE5dlJdGSLPjOuzeuZM1K1Yy56B5jJowHqeQEVkU60Yeau2qtzDWMn3OXKy1rHr1dZBD8EowWBXgk0QHKeL1Cm3cqBezgMs+zDJ+dybDUcedRF19I4EfCtkiyrnvPHgeoipC8sbaJ1i340UcJwaEsbE2DAyHE2Bzqmy2CAMo4OCIYqTMWmTBxgisT2CCCNbXuI6H58QGlOrkQNglZcifT8bamdQ+OzyKoyItNgHaoGJNNEybz+7n1uAmkuGdFQqFycsjGulis31se/om7NM3I1QslASXMpo/LPObOQyFgjy8bTJ9tB31Hmae+yWCwBBOFapcOS7Mq4aS1B9UyMISBAGJZJKjTzief765iqb6OgKbDb1AzXLzAmEDlBDEk62krMXXWTwZ5lwCE3XeFS2McB0oQSrVy5uvv84hRxzBzNmzB/cD5Ljm0pH0d3ezZcN6ErE4cw45GCEEG1etwvGcIbJ4QRaHuPGZ1iJwgpDvIwUj7vY1VqMcl6NPPHnQ4qx8GgMW15dZhHJQrodyPJAuUrkoJ4bjxXHdOJ7j4Skv/O54OMrFkeGXkh6uiuGqGI70cGUMx0kgnRjC8RDKQ6kYMSdJzE2ScFtwZBxjTX7jiJJRRul0mrHt06mLjQ77LaQd6Ne1AmsF7YeeDcpBByEL3hU63wcABi/oQaChvhkn0YjnuuEsY0eglEAooi+B40k81yXuerjKDYEIE3lxqYasR1Qv8FUpbEW0jtzvjjv5ZFzPwwaWYUpThV5TKAyKXp2i0etlWlOAZzLEo7FRg3BBS97bCwQrly0HYNbcecV1gAFPEBJJd27byu7t22lsbWHmrNn09naxZcsWYo5XlFiFJ5bjpxuQgsBPc+5RSS771KGcvWgCQWCLejmHgyULIdAZn7GTJ3LwYfMjoVhRU9HL5scoCRAGIUw0/zcItXhEAARYwu9YP/xOADb6jh/9PIvAR4jwZ9ZmMTaLNVmMzeQ7vaS0IFPhcY0ijD7CXmcRudfAgOckmDf1qHyHV05DX0R07kAb6icewJj5J5HN+jgxFyFBGRD4aCvpJ2z9jOk0jjCgJDbv3UL40GgTqUoLrFAYobBSYYQccPURf0swtFLecDrMCiMMFU1zn3fIIYyZNAHtp8gj6cNARIyVWKuoczL857kz+MaHj2DGuPpw+pCwEV9qcA5pDbiuy6bVq7HWMvegQ8pvv9xC2rp1C737umlsb2PilElseOstOjo7UMIti71H7DqsNcRdyYFTRuPqDA1JQRDUNoe20g3PZrPMP+JwGltbMH7YPVa1QmtzMXn4Dym9CInJqbDlQhc5UGsUMvyKKtnkFohwQORaUxj4soUTDaNBfdJEi8qJMuUI0jQWbTVWODiOxOqAow48n7b6ySGykhN3LrgmKQxC+4xb/BkaJ8xEB1mybgM+Dj4OjvWJWR+JAukVTL+JCmqCImGt0Aqb0DNKgXIVQo0kbR7aiJVDeXLUiKbWNubMPzhsbRQwnE5AGyV30hjq43W0NLjEVC8TxybJBGEviBTOIAdgAYzAdT12bttKd8c+5s47KKRCVNwAGzfT399Pa3s7yaZmVq98iyCdJQoWB8Gn+Y4tIRld79JUJ+nv91m5uRM/yFbEiQtvZPmSvUADhx15VBTNDhSHKk64FAO6OoWqkqZCo00hz6L0ngyMRC3U8azUOVWg1CYKG+ItxjpoNJn+fhbMOIN5k47L616GsbkezMMSEq9+NDMv+Dq6bhxubweeymKtQouwb1YpWaAXZMrWOkqpJAKBkqp4odr9G0BSCpkO+vyCY81fsADfhHwxMUTdoXSdhbUFy97eNBt39aPTmvYmF1eFkYsVA7qpA9cQrhnX8+js7GTr5g20jRtTmQ0KsHH1WozWTJgeogTrVq6CwISSJRXxf4G2hlENcerimkwqy7bONFLJEd9MbQJi8SRzDz60oBo6fNZm6eYqHPxWq0eqpahUxNWxYT+FUhKt0wRpzaGzlnDo7DMx2kR/ayJPVGqNJUIqhM7gjZ3DgRd9g6B5KqmePcSsxrgJhOOQm5+VkwksxvkLRc9UVHsIjYjv+wQRkpdD/ezb0PpQjkOVr15H92reQQfjJZMY3wzZC5I/jhhIBBSa3oxlW0cfrpaMbo+RjLm5aiFFY2FLxsRmUim2rF8HUgxOgnMsPqs1G9evB2Di5KkAbNm4EaEYxLsoXQC+b2iqc0g4llQg6U3potFDtfBwCkWcdNZn1NixTJk6LUxwcgPvqniSAU5TjlIQojO5BSmIwhsp86FOOH1KIoSKvudmduXUmKPfRV9SSBQSJUI7JvLNCBIpQn5SYLMEuh8dBIxpnMgZR/0Hh89aHNJE8klnYShW7LqFMVjpgJ8lMf4gDvnYL2g65gP0qyQyvRdMGilyc7BUvl2UqNCmJDhSoATRVwSNWovRGpMTMogGnYv9aKAvR0UZRBeJvk+bNZPRo8eGEz9FrWHxAAxtIiJhR7fBKGivj5GMeWR1OFa2HCEwJ99ijGXz+g1hsbGc9VJKkerrYffOHUghaRs1BoDdu3bieKpsoWRAOdqgdUBzg4MnFX2+JZXSONIDa6r2hlaadxsEAdNmzCTZ2ICvA5SQgxLhQaEVIqwBRDdN+5ZskCmyIjIyKrkY3BQkTOFBShalCKJwJYyvhVVRPmEj+ojGRgCckAJHetS5TbTUT2Da+IVMHXcQjgwlxqUYaNwXQg2wnQo3dlT1Da9VYYOAWEM7c97xFbqPPIddrz9Bz6oXyHRsw+peEBqMCL+i8EsrlyA3kcWCND7ChIiS7u/B6KBgaYkwiayRTDgiRqwQBFrT2NbGxClTeHXbFpIxDxGYoWsOBeS4QApcCV19Fu06NASWeAwy3QEJoQahWYWTjZSUbNm0OdwA5UvX0N3VTXfnPhzPZfS4saT7+unq6MRzvXzxp/z1SSSa1kYXpUKtnr6MwXHK9s2UdZu5VsVcTuEbzYy5B4RWSpvQlFG5Xzi3QK0Np6xbYzh01onMmXwkUihyp19MO6NAbCNKGkVQUiAqZp2Gvzf5YpqwCoETcVcg5jZQn2ghGUsADtaExiEPY1bg05fnwQikilo4kTSOnUfj2Hn4x7+fVOdWMj27we/PJ/e5WojE5PsNwpkJhfUMQ2L0FKzV+XqBHcSqLd6URXMiCnKeYYW3JoRlJ02dyguPP46slxhhhtSFonDap9UgHLr6UmSyEPegtcFh3TaD9STV9BOllOzetQtrzcAGyC84Y0HCnj276evpJVlXx9gJ49i9cxc9PT14jgptXBlZwJybiruKtkYHY6GzO0NaSxpdU3UDlO78XIHJiLCUPnXWjAJEa2BmbOmDySMehGiHjRbkmOaZ/H/ysharLdbqPEBQWjWtZYpMrtIsRCgDYiOLKRN1NCbmAHP24xR1PhSziLKCRoM3qSjA1ysvWlkwsFqUdPRPmjYVo23Rcyy/pgoKWvl43oCK0dWfpqdf09BsQ6NbYVZaobS/oxw6d+8hnUkPbIDCBnaAfXs7SPf3MnrcOMaMHce61WvJpFKomFcBzoxgNyReTNGY9NBWs68vHJA3HAORVzoQFowm5sWYOGVKVK9RQ6o4DNwAOWBBjS3uHS2gUBTlESXusrgyKsoWWAbzkYo3MUiQJl8nGGlSWQBwYlQIyypjMDbAiJAKoKxF2vyphRpChXSPgrlpltwQjgFaSO6+DMwcyAdn+cF0Bk2u5lqW5VrBq5c+n8nTpiMcB61NVU84OCwOz9uR0JsJ6E1lsM0eLQ0eSBlqy1ZAs0QUHfR0d9HX0xtugKIBD9EbO3btIpvN0NjaSmNzK92dLxD4PjoRVfDKxuugjSDhSZKugzGGfSmDQGOFWxY6rMQjyQtFBQGN9Y20to8qWtuDrP6g4xYcJ3L/yqr8NYbTI8Vgo5afyCgGendL7o0tWiTFnJMwEbb5RDTsiBr4g0J4rloeVLnlcgBtC5uKwwXs2HDSipUFjFJRuI1tMXlQFAxdsmYglBG2hMBQ4MnyAISDMBol8iczsHmGolALEYHairETJpBIJsOKnaCsGPHgMU5hfcRahUtAVgv6Uz6QoDkRDlMXVha1XRbnqBapFL2pXrr37Qs3QLHKcvjq6tyH7/vU1deHHmFfF1ZH404juK0Irck9cK1JuIJYPJzG0Z8KkCMstkghyAYBbW3NtLS0hNrzI2xFtMbiRwmqjSyBLTMsIx/vmkJPYcsZ/rw9LgaeCmLkgub1QuExUaMCxlCImQWMjMIXMdBNZm2ZixIFIUvBBs57Cgo3jhgo8A3SVwr/QEuZb/JXVgzMZavQI1zu2lpbWmloaCDd3Y10VF6wttxkmmKvTNTrIAmMpC8T0kiScQclQiq6QJQPM23ISAgyWXq7e3AqnVx/Xx9WG+rq68KkeF9XyMBEoG0Z9YGoOc9an7gj8FxBgKUvFRTrOBaEgeWIVPnYMXpPoDUtbW0kG+oLktvaWx2FlFhjBg13/n/75ft+ng5QjThW2FA+kNMM3vjGWJTMFdoG4EEhTEnoViq5botjm0p02kH/XzywGiFDI5jLtywVPFZpQ77Je+ZEMkldXR39XftQwqn4HEvvlbYhnCsEaOuQzhqUsCRjCkcxyBsNKmwKiR8E9PX2VqaPp/tTSCGoa2wIPUDH3gHrNgj7D2+oxIYjLxMenoJsIOjP6rDcbcsWG6tgH2HMqbWmta0NqZxIfHfooRVFw7y1RinFP/78J5a9+GLYRkk0vSXvxoonEOak+WxuMrkYgAlL34sokCopSAhdx6F19GhmH3wwhy5YwPiJk6INHaCEKqPtX0whGGgpjFiqUVASqmyHbrwn0GzuzrK7q5+etE9ahzo5A3PDRBHEiaitndOWwNxhuDXQWyFVGJounNzMhHpvELhRPZnNnUeo1hBPJgiCAMeLVcntbFHyIAq9tbH0ZS1GCJKeQikIbOVMK9+jYAx9PT2Dk+CBDRB27SSiEKivq2sgBhSlpeCwMCXRaCQxx8FV0J+GdGAjApoqst7V+3HDmy6lxBpoam6pWCeonCzZAWaAgpcff4KH7ryL5paWonGZlRCYatKKlVx8YaVZSokSYS5R39rGCacv5uJLL2XG3DkRMS03zHuwgbeDxUQj+kW4mfsDzeubO1m6PcWO/ih+zxftgjwMKqL2yKJFU2j7bbHlFvnaREnFPIfIRYUSz9H4gWLeOJsPlwS2YltqWZqDsTjxGPHGerSOELvBsVvRmedZ7iisNQQy5AT1+oYASUxqlAI/Gyb/xlZA1WRYi0j19g1sgNKHnEr1A5BMJMKQqL8/jwuXt9e5RpeAeMxBCElg/AherQG5qQLoJOvqBnvmqn8jcqz6/KuhqYmWtjbqGxoIgqCspDYlZXsKfidKs/0K7mwASQkxeIUhSPVx743/5Il77uWij13KJZ//LFYpCDQU8ngoo7VjJcoGoUdULmv39fPMmj1s6VcY5ZGIhbRPEQ2CLvVUg0LnQtjSqpJLEgP4finuTliLEELhKlHQICQYyYSPXMG1saEhMhxi6BpRDomyA8CCtRBkg+gegCNlUVRSNhyzYR9Iqj8V5gDldmoqnQYsnhdq+GQymfxcWlEG/Q3Rg1Dj03NDF21sgDYmLEYN4yblDV70J/F4bCAsqjBsbZCCQwmerQNNJpMhHo/n5xjkrF5p4/xQSVxNu9aEJOucZHiysZ4gyHDF97/HsmVv8KNf/wYvkahY/c5v5chrGuXxyvYeHlq1F63iOK4kbrIYK/ItkoMEYofQ4KmkjJfjBYmixUd+MJ+PIetDkPd4dpBBGdrLh++LxRNFYEQ54l650DaktjuAJAhCKXUlIsq9CTnjFRv4o3uayWQGa4PmkyytMSZkzxVZX1spYi/ExcPbF2iD1rZMIja8l+fFak56C4loomDjZbMZdKDLNohXJF+NAK/PicNKKVEIpJbYALJZH20tY9rbeOS2O/nW576ACYJQ9sQOTj4HGvQ1Qrm8vL2H+5bvwagYntCIIItvJRqZZ6vWqthQnthX+XdFu0pYrA2lTozefxEtVcYDDuk9xMAQ8dxay/VROErVCBQKAh0Uj0kt3gCmgLBF6KpzaIMoY/KsjNxrxGyM+mWFFZFE4kBsPNSDyg+ZjrZW4YTvmm4QdlBVTCkV3eyhB+QNNTKqUiJZKiKbJ+HakEgnrcJqwajxY3jw7jv5y69+GQ4IyUmdWDNowIaUkq3dGR5f2Yn14ih0NC5D5Pu3y31+NbLi4KS3IOEveUYDkiwDQzkEYQ0lR2ESFA/CKxfOVStyFX522bWQJwuGfRy5cFvYkO9lZdihkauyCzFErghhsdDYwcpwRYWSEqRCiOphS2nLH9hIBWwg9RpqRm05AMCOhJBlC6VLwIvF8Dwv2ggq0qgUZRd+NcpzrmWx8KusfihUnBxvtaG9rZ2r//wX3ly6FDca4D344VuyCJ5ZtxdfxahTEaLG4BFI+QJfAdJR9CUGdHNyjTfYYsmX/CmW8dchKJGrZxTmDPvXN2Br4IdVKnIW5nz566+xTpTLl5xKHxhyOAbcspADBRZTYnlyRZjcTg2CkPQVzpENFQ5yyUclK1X6/7kEzmKjAclDhz/l8IPc8YKsTyaTIRaL5ReMyZPESrkmVDxmQUdJMXSaiy2j//c8D8d1ioYy5xI5ow2OEKS7uvnrr3/NT//85yKy10CSKFm1u4c1+wIczwUTUp5lweeagqpzVpv8cxEFQ+REVMuzpSXigrh+oEprQ1WJwusV0fgSG026BAKTUw63+yVBWXYKUBXEbYApQBE3DMKwLFSglkXV7sHV5KhF03HKcIFyyUksjP2zmVDFy3XdmvYVWAI/jLWVIvQANif1MRIUSJBOZ0YUjxdOj0401FPf3ExTS0s0siccqmy0zk85HMD0TVmXJ4oQotx9FwM/F+E4Kaylp7ub3t4+Guvq0UbnRa+IvutA01zfwItPP83alSuZMW8eJgjyFO9Q71Pw5o4+fBSuzRKgGNC8EXm1icAY0FnqVSSZIgRKlk/a8pXwErXpgSp2rvBGHt4svBXahJYzHpMknP0fwZrNpPdDaDgknzsqZCYZE+YlZaWlxOD5y47jlPQDFOxUNxZDyLAZHUB5LroMnz/f0WRVtJAyZH0frQVxV+DFc42qQ0NdpYlsDqZOpVPFWHWZ3TwIQsx1QqnQyvzXZZfxn1/7elHYYk0xDm6oPh19EKwoQnJZ4QYAg9CwZ88ebr3mWm675hoSnhOyWsPu3TyKJj2H3u4uXn3+WWbOmxdJv4fDMKS0dGQNO3sECSkjCJK8Xnoux8jqgClJyYLp7Uys83ClxAgxsEkKCG6FIWURoi0KuT+VY86Q6xVes4Ml4Yg8tWA48KeIhH4xhlRvH8jam+wBFCHLQFiDth5JZVFC4xsHHZD3xNhKJjf8uXKdkkpwwSKMJeJh+1hkfRPxeCTUyiBaaxEPRihSmbAI4SpBTKmoEVvUBBfbAo6OjeLW3q7uEUOSOSSoobERGssWFt/2lzWGxrZWvvK97xCri/GXX/+alsam/KYspDNYa3nj1aW8+z8oHnkqFPv6+sgEASgV8qAoIiGhtWZ8g+HCg8ZR55rIxOTGTeWSBVmB4iAqJFmi0E0UgR7WGIQzMKUzJwwwLK+cg02lwM9k6e3pHZFMoigg4CTjDkJJ0oEOp8kMIduXW8OxWGwwFyj378amRoSUpPr6okJSYz7+s5TUDkSuQyrU/+lOaXxtSHqQ8By0SQ8wMWsgfOX7RwFXKbo791E4Tqja+J9KIk2hZme5G1Fs4avnFYNb/QrDCRHxGwwW7fsoqfj45z7Po/fdz65Nm/FisfwmyBd2hGDrhk1oPxuSBgtaX/elArI6nNA5sFkHcjSp4ZjJo6nzFBnj41kvDMOkKcu8LScSTJS75AXL8sUw8q2n0hTcAZuzrHIQ8lPLYMKc8RRCksn69Pb2oqJ+8UHIU+nfF1TFbdT4pkRAfVwhhKQvnSKrDUqFSGSl4quI7l8ymaysSpSsr8dxHHp7esINUN9QFh/IQWgm4sMIJOksBIHGUZL6pMdIZy6E3f+Kro5OsqnKsWJpIassKlEG1VEi3wUc9vQOgQJJBNIW/41EIEykqBP1FksknnSw2hKvq+fwwxfgZ7OhonbhnK0Ink319eP72UHXl/INvh2gCA8gMWHC57mS9gYXqw2OjeULPEKHMwlk9J+wEmFCXSKJRNoQQhQmhKmVDX+W+x7+XuZ/b0X0hQShItXqytD0UANEch6+t6+X3t4e1DDZwvn6s7EoZalLhIFlKhMQaDM07EvYV9LY2DRYHj33psamVqRU7O3cC0BLcxuOCjn90g6OjSGc16qUJaUhmwYhHFpiOqxUioBKw9HK8nLCzmekctizdxdd3Z357qJKOH0tHJRi3kvxeOkh4bwozi9RNc9j/aGHNPk++1CkyRJP1oUN9Kpg9poxCBvi0CYXHZqQQm0ioVoRCckPkBBlFAGDbyWusCSkDHv6C5JVUYxJFPOBckzegv8KvV++TdOSV6UuOo4NY2+wFb3L0CNkw3937t1Duqc7ErYdeo5B7hlpIULmgRW4UlIfd5E6S1fKDweui9wT1QVDxQsCdWNxY3HqW5sGy6PnXi2tLSAFPV1d6MBn1JgxuJ4bdQRV0I8RAiUlWV/T64cqak0JL1otcticEYtFOQ69Xd10dXSOjJZQ5UGM9GUwee560f0r627DiiO2wnCMQWG5GBDzEgIpVX4hWmvCzrbIgiopoz4MWdzdVsOUlyGC62HlR8O/l+HBd27fEWr0F8x2HvpYUYJvLdpYPFeSiCu0kXT16igcl2V5QLkE3BhNXV0dTU3Ng0Og3I1raGzA8zx6u3vo7Oigpa0VJ5JEN9girXghZFFJ3Q8Me/uyIDQt9V4kWOTUxA0pHAZhAaEk2f4Uu7ZvH+Q1RvoaquI7VBJXKVeo6HlsmEAW6mPmQpqy2HeFRWkLqtwipyGao24XIWiVRyPVOiqp0mYZ6t+1bZhw3WzZsJFsNlvzZht4PiHB0mBJxiVxV6ONoqdPomWOQyUoVA8svB/aGOoa62luaSmzAaLvTa0tYbNCfz/d+7pobm0hnkzgB0FxG2DJhBWAIIDOngCsoanBJeaZkS9YKTF+wJaNm/NIxP+VB6hlmnotk2IGeYzcYI4Sr1EUr9jhyYwU0i3295UX5K3xvbUajKq0AWDT2vXlShVVPMyAzKMgXMgN9XGScUnWt3R0ZxEq1LcpLbAVrlOjDY1NzdQ11IdkuKJFHP1B66jRNLQ046fS7Nq6ndb2UcQbGhAZPWjXlAofaQS79wVILWmuc2mKx6JJ4bVRGqy1GGHCIXFGE6BZ/9Zb+Tg417s6XAJY6fuHmngylPcY6nc2vwGiOF8Ux8z5ekdBfaV06EdRtTbfXjn0wqt1UGAlD1Btce+vFxYiRAQ3rlsbyscjhpzrNqByB1YoFAEWyZgWRZ2I0Z0N6OxNg3CjxveoaJgXMhug+AR+QHvbKKRyynsAYy319fW0jR6Dn82wfesWlOfRNqo9Gkskq94gpSQdPT5pI6lPurTUuwRaj4Q2Hmq3OA6r3nwz7O5y/m/EXN9OD1KknZNLLI3d788S+VxgZGHfsL1LGW9n9tcDW4tSgu59nWzbvBHP82ruky6FsKU1jGkJ61WdfZqeVBpHyLJzk0UBD0obzajRodjbYBRISow2eLE4o8aOx89m2bp5AwATJ01CG4NUsrKbEuAqyZ4eTU9WEXMMbY2h1PfwkqgBjxSLxdi8fj27tm/Nt1cKOzxiXS3zfkfiUWq6JlHhd5bCVvTys7IHmGdlK66ihmvf381fbjOMpGeiMMLYvGE9nbt34ziqqM+j+iimKAzDYlA4UjO60cUIw54uS5+v8QBL5evPnff4KZMHNkD5/QXjJkzEGsPWTRsBmDJt6pBxpzUWJQV7uzN09mWIOYbRLYlQWbMCb12U7TEesBiO67Kvcy+rViwvwJHlsB7ggECsHLoKXWP3WjVl7UHXJ/evJ6Iy4jQ8rf634/P3x8Pk7s+K5ctJ9/WhlKh9c+ZsrDUEhlCArSGEPfd0B/hWoIp73gYjb8bgei5TZ0wPN4CtIs83ZfoMpOOyffNmsDBl5iyUE8J0tlqZGUtPOsuuvSkQMGVsPXHPIozGorDCRIX0SgunUIkgjONMYFj+ylIgVAWgjHuuZfRnrQu73NjUWhZFkRBrDmOPPFbpyNIB6LJ4PnDpHRXlrq2gmlwkYFVDeDacwSS1WPrhjGHNb4CXX8FYSyAGqc5UvoZ8fqjQVtNa79JW72Jx2dmZQqPCwSf5Wk1hKGpCLpMOqKurZ8qsGfjp/tCMlioRiPwGmEayvoHdO3fSuWc3Mw6Yg5eMY7QepL9uC8ZxgsUPJJt39aMRjG+rp7kujo9EiQAVDakYIlQsuiExz+O1l1/BBDq0puJtaF18m6xmJTGrQarIdrCnKeW3W1vS0FMQAlU8twKyW62hSC0DskcaNlWCT40xKMehr6+HFa8vIx6PjTinsFozcXQDTXUxejOW7Xv6cGRu1mXlECrwA9pHj2b0mHFsXLt2oCWyODYOpeXGTZ5I+5hRdO7ezYY1a5k0bRpto8eg/UyRxEZhI0zOsinlsq0jIB1IGuKWUfWCjBEoGYmgCmfI1rU8jyfaAG+9+Sab1q7FUbICK7X8A6jlQY4kNxhqYRU20RSXaAsdXXFXViE5rbB5pRjXNsXGquDQpR13ldCdSn3V+7PgKw0az4WfNhrcvW7VajZt2EAsHg+94xB5S2F+GcUtoA3jRznElaWjP2BPjyauJAYZcZfKdAUKgR/4jJ82FS+RYNnSpQNJcLH7hsBo2kaPZuz4CfT29LB65Qpc12XSlCn42Ux1JV8kSdeysyNNdx+4ToYJrRYdaISNoaXBSFshfhVAiRu1Fkcp9u3Zw/PPPBPWGnK69m8DujNYvGn4xxsZNFiGnmcpM3UnwsCx5V3k24T+vB05Qi1G5oWnnyXd2xdu1lA3YFg1C0uo/jCm1UX4GXZ29NCbUTjShhug3JKSIakkCAKmz54FwMqVywe/Nx9XGo3neUyaOQ0bGFYuXwbA9Dlz8bM+g9sIBprphAl5JDv3pdm+oxslA2ZOSOJJiTE5MVVTLsLLczdKvYoFYo7D0w89GIVBTsUKZiljs5LVq/Tgh/IgteYa+TFOhaOVCrH+wrFLBYhPcVU84s8bgdUDGp9SFIwWsjZP9huut9tfVKiWGQKhcpxFKIU1hpefehLXc9GRzpBlaM2nHNtWAL7WtDTHmdQYw8/6rNrWR9ZoIMT1zSAgJTdUA5RUzDn4EADWr1hdvAEGWIo2n5jMPvBAHC/GmpWrsNZy0KELENIpk5gVdJNaS2AlXVlYs6mD5kQ9o8c2E48HaJFFGAd0JSEkWzaKM9aSTCRY+vLLbIzCIKqIMZVLjPfXwg0l371fSIvNQb+ljjEPfRR/loyoFJb/11+1AA+Di0uh1V6/eg0rXn+dZDIZzTooP5apYhKNRWqH0U0uY8ZL0irO2o0pwKCtrcDHCm9foAMampqYc9BB7N25k41r11XSBh2onM2ZdyCJxgY2rV/LtvUbOPDw+TS3tqJ9P993Wm4xSJsllqjj8bVZ5FNdrN+0FxskkE6AxUReQA7CjyodzwqB4zh0dXTw9KOPMu2A2WhrUZTnoJd2jZX+bqRwXjWB2+qdZKJkJNLAXi9a9CUK0jneffhYIjgXOUj4q7T7qdo5jmSTDueeDb4PAoNBIXnywQfo3LuXtrY2iMLYSv0d5fsMwonvW3f2c/Pj3aSzgk17+3DdeNiuWYZSEkZAglQmxdTpk5k0dQrPPvY4nXv3FsuiDCyWAU71jFmzGTV2DJ27dvHqcy8wdsIEpkyfTjabrXiDjQWNIimydKcFNz22jjc2pnGQaKtDybpBGHZtYUjC83j0wfsxfoAUskS1QgwhrzHMAtYQ51PJMwxUHYtnLpQzTYUVytISTqANfemAvlRAv58lowMygSETGPozARlfDyTYw8DrR6p5tL9eIwiyPPHQg8Rct0iecsjjF3Sk5WgyvnW5//lOHnhlNzjukIP2hJRkMxlmHjAbqRyWvboUtBk8KDv0tmHiFRhDY2sr02fNIZ3O8tqrryAQHHLkkfi+juT4KFaIyKOukUochqZEAkGKfdl92HQfWjhYdBStDVYyzg1tKLLYhA3Zybp6Vry6lDdefCHqnx3QrRnqoVXS9qnl4RXKm1eyjoPrDbYoXxWl748SgoHJ75H8YDQEY1yD4qiJHoeNdTlstMehoz2OGOuwcJzHovEeh4xNoCRli5MVh1PAiO/B8HODaB1pjVSKV55/keVLl1JfV5fn/5dHIUt6vG14R8IWTNDZXtLpXmIiTV2dxTVO3tOWu67cDE5rBQcfdSQAr73yEvGYW14dWuQtuQEpOeSwBdx3222sXPYG1miOOPZobvzz30IMN9/aJ0s2rMEn5LIHGmac80Gmzj+KR/72W4Jta3BiYcfU4ES62s0PF4ufSnPnLbcw/5hjBsS+SzxXLWHM/r5nRGE+g0V8i6bzRBsnsDCtvYEZ7Y1VjxkS+qpr8tea/FerCYwoTyhalvCvm24mm0lRF08gtK3dC1uLlQaFIpVOM+OUJUw79QKW//Mq9r31HFK6xVIu5fB/HdDY2MyRxx3P3j17WLtyJY7rDQ6B8uoGBS78sKMW0trcyvaNG9iwdg2HHrGQ5jHtZNKZvLUqG/lasCb0FFNPfSftJ7+DWWe9FzdI4UinKOyqlFSVJpZaaxJ1dTz64INsXbeuqJ9UVmkEKe0lHurh1lJHGKrjrHA27ZCfVSTbPKBc5puAwEZfJkAHAcbXWK2x2lTF0EeygAspI7XUQ6pyrKKpL45y2L5xI08/9CDJuvoCTVGqFg8LEspwLKr1cRqbOeDs99N83GlMW3Q8fsoQFMygLueJQ2mdFFNnz2bqzJm8/uKLdO3ajevFB88JLrRWMhoqNuugeUw9YBb79uzm5WefpaGpiQMOnEt/KoUjZOWirgjHe/Z3d7Lppafp7Oxl3LzDcNomEuhg2G4192/Hcdm7cye333hDnh1ZKzcoV60eyeIoHeFT7nflH2LtnsRGSbAUIZ7tWAdlHJR1UDgI5YCjMEJhhKzYoFKoXPd2oD6VDMFQ99FE9/qeW2+jZ89uHNctW8KoRskRFqSM4/sBbbMPQoybRmrzFta+8hK+EyC0GeL8IetnWHD00YDghSefJNXfy9TZs4tzgKLm8uhkdBBQV9/A/KOOwvczvPDEkwAcffwJSGuwjh00Rqc0a5fCsP2lx9G93SRGj6X+wEVk02mMUgirI6xYFrEFq20EYwyN9XXccdNN7Ny+HaUkxuqaLHq1WH64MGg5OLCsRbaDYV5rTeWnVTCe1EgTfomoRyIaexqJklTtSisVCxiqcl1qzYfLHyryFjbXtK7o2LOb22++mcaGhnyoMjy4NZRjNMCUo07Ba2ild+c2tq9Yiue4SKOrnq+1BuW4LDrhRIy1rFj6Ckopjjj+mMpms/QhLjzmGGKJBK+99DK7duzipMWLaW1rI9B+gdhT2ZWHl6xjz/oVZLauI9HUxOxjTgjTEq3zkwZrX5BhbhKLeezZvp1brr0uRBiM/v8EE6+lQGYpmDdWuAmi0UKh9yhMjAdYEjkinYga1UsUKfcrTi9dKHKYIsRDYf/ahAPBb7/hejavX4/nJSKDOLxE20qLzPRTN24iExeeQExZ9ix/Edu9B0clCKoRFaUkk84wftJkDl5wOKvefJMNa9bQ2j6KI084bnAOUPrv3EyrQw4/jPYJk9i8eRPPPfooYydNYs6Cw8j0Z5DKyeu+lZPUVk4cke6n45VHUUIy7qDDaZg6B5lJY2UsYndr8g3PQ9zZUNUNWhoaufPGf7Jj62Ycx8GW0gX+P3qVokCi7DykgR6AfA5QYEX+L5Lwoc55uMS0in3HFrQN+0b27N7BHdfcQHOiDj/w0VYwbPqbAj+dZcxhJ+K1j0Kn9rHnhSepc2MEUlSkhYRy6ZJ0JsNhRx9DPBnn8bvvZe/eDqbPncu8gw4ZDIOW2wjaaNrGjmX+EUfgZ32ef/QxAE48czE2MBQ2H1dwAsRcyebn7qdvx2ZkwyimnLCEtDV40mCkmxdnsnZoXo0AAmuRjmTP5o1cfeVVSKEiVIr8fK//CxrAsPKVIjqAHRzpRDBDjt9ih8nqrBbODNczVCvsVWsBHZR4R1LpxhqUVNzwp7+wZeM63IRHECU5ktoVnIFwxkJ9PZMWnY4xgo5Vy9mzbiluJLtZqdPCEqrvuW6MU885B1/7PP/wo/has/C443G8WLEsSiVCWA5rP/70xdQnk7yx9EU69+zhhNNOo7l9dEiOE+WojpGrNz7C8+jctImtrz5NgGTiohNIjJoIfgorZdgnUEO8WtTbaSyNjU3cecONrHrtdZxo6DJSUi73G25RbH8SxrIhUEGto3AnFBLeisCP/UhgR0LmGwS+SFlTH0Rp8qpNgKMcNq9Zwy3XXEt9QwPZwM/Xa+yQCx8kBmEFRimy6RTjDjyc1jlzMVnD2icfIEj1YKSDrNJqKrGk+nqZNmsmRx57LMtffZVVby6nsbGRo086KXxPNdiwcAawxbLohBOYNmMGWzZv4IkH7mfM2AkcuHAhfb09g4ZPhJTdMLaVwmKsAinZ+OR9iGyaxnGTmHjkKaRTAU5EkR4OvySMiyVCuWR7e/nV97+HCfxBEoJDFcaGY1Vr/X0lecZQ+3Og4GULRhvlwqRqaEglJKawH2O4m6ESgbBaUllOpDj/XViMCftFfvPzX9DX3YXneGExK5e8D0XWE2BEOChdWo22hiknnEss3kT/zk3seuFRkl4SrUXRHLfS63QUZP0sJ5x+Gl4szuP/vofOni7mHTyf2QcdhNa6uCe44o0SgiDQtLa3c+SJJ5BJ+zzw77vAWk5fcjZGOUOUogVSG1SdYt+bS9n35qtIJ8GEU8+C+tGIwGfIWnaFh6+NoaGpiaeeeJy7br4R13EwNYxTHQ51udqi+/9DvlEVgaoxzKlURR5KB6j0mFobXDfGo/fczcN33U1rQzM6qldUK3YWhfzWhmwBx0K6n8ZZ82k+7Fj6A9j65L9IdexAKDcysKJCwdHiB4ZEUzNnnX8B2b5+nnz8MZBw8tln43kexuiwJbIc1lv0JQagzhPOOpNksp5XnnuOla+9wUlnnsGU6dNJpVJl9TeBkKUnDI6NQ6aXN+/7B+l0D22TD2H8cSeQ6UsjVHUEolxhKkcFNsbQVFfHH37+C3Zs3oxSimAImY1qhZfS6y8XCpRCoGVpFtYWOyNbIVYtHKM2RAV3qFi/GkPVjgCCLHfdhfBq4TGNCblJXR2d/PZHP6XeDZ9D4QT5Wry7FOFs25iVZIRi9jkXkmxuo2/vZtY+dhfK88I5DPlIowS6xYCCnt5e5s6fz7S5B/DC08+yac1bjBs/jhPOODPcaEqFG2DIUIBw+JixlkMXLGTWvAPp2tvBPbffQSKZ5KQzziSV6sctilkHdnyeE+5LZDLJ5pefYPfKpUgV54CzziPW0Io1ItK11xEYUnu4YoGYF2PP9h38/LvfC+NMY+BtstBvByQoynSEDTw4MyxYsCL2PhyG6giT5op1DhsmnFJKfvOjH7F5zRriiTiBNcPG5awIcHDJ9vs0Tp/LjCNPwpGGvU8/TM/2DXgqEQ2ArnTNoVixNpZ3vOtdANx35x1k02mOOO4Yps2cnh+6Lis1URRZuIiz5uuAZF0dp5yzBCkljz9wHz1d+zjv/RfT3N4WSsLl50zJiB8ko6BOhb0AwkFlNBvvuw2tU7ROnsek45ag+7tRSg5KBktb7SqhQr7WNDY28vC/7+amq6/Gcwa0iMq16g1lFWvBxMvFyIXN7QMkuCpSiqJgvlWEoAwHAq2F81Nq0cs98+EUugZtHGvxtY/rujx8z93867rraGhqJBPkqjzDMybaKhzr02cNc864gKB+FP17d7DykX/hxOJgg6qhqUSQ7U8zc+5cTltyDhtWr+GFJx4lnkiy+LzzBryxqMAfGHSDIlUzJ9KiPPPcJYwZN4ENa9Zw/7/vYur06Zyw+Ay6+vrD+cBFlc7ikzRa4yXq2PrSo/SteIHAqWPGWe9GNbeh/CxWxkEKlNDDskYCsNrQVF/Pr3/4Y5a9+CKu6+LboKhnthrkW+rmh5Ms546rtf7/QSVi/3KearF+2TzMWpTrsm3TBn75P98Jh6lEAMiIwi5Zh852Mm72QYw5ZjHaSDY9eif9a5cj3SY02arHcaSkvz/FGee+g0RdPf+69Wa2btvG1APmcMwJJ4abJAq55VAxXxGeTZgMT5wxneNOXwyBzwP/uhOjDRdc/D6k4xFoHYY7FdxrmFModKqXlff8jSAIaJk2lSlnvZ++TBZPWAIhi0HxmnDpEFURSqLTKf7ni/9F5+7dKKkwViOEKRKNHWpxDyecqFgNLlRstmWoFBROWxRA+XFPtaJXI+FWVaIjV2sTLW02QoBNZ7n8S19h945tUYJpRhxCugSkVIKDLvggscbRsGsjK++5DTcmEIHJB4zF9zq3eSQZ7dM8ZhRL3n0hnZ17efTuf6OE4Ix3nE+yrpEgCAqg0go3qMhVYgchi+/8wMW0tLXy2osv8NTDDzN/4ZEsOGYRfT29odx1tZ1uNIl4PRtfeJrU0mcQMsb8My+ifspkgkw/INGoaORS7Ti9ERBon2QywaY1q/nOV74WEaUE1oiyygzD1cmpJY6ueLwoJ8rL0BS44mpepdZwpdJGHEoMrFzIV00kQBZcd2DCCTa/+eGPefGJJ0k21hMUyObUWtWW2HAmnJBk+jqZeNhxjFpwMq7OsO6h2+nfvgmTqENZDba4H7ywsuIqRX9fH6ctOYdxkydz+z9vYu2bq5gweTJnn/+O0FsVXKscCubLD1OI1M2UCgc7H7JgAQcfeSSde3Zzw9//AsAHP/VxPMdF2eoyJSL6ZIFk2W1/w093I1vGcuB5H6Y/a3GLqDO1w6PCWGQ0prWlpYXH7ruHn3//uzjSCcd65rayrDxsbyjR22q/r9gRZnOEnsEhYX5Mk6gOEQ5bO3OYG2bQiKpqUoiRRwuCAM9xuOHqv3LtX/9Me0srWpshJSgHX5sFq0GAtD6B18Ds895LVibZtWk1q+6/lUQigQoERtgiq52T5BeYqAbh09TczPsu/Sj9vd3cdf2NZAPD8YvPYMykyRgTIKXKI1mDhLFq0ZY0JpxmeMH7LqauroHlz7/IKy88z6ITT2Th8cfRF0leVNTTlGBNQMxrZOuKJ9n8wK34VjPh6AsYe+SxmP4elKv2A3QRBMbQ0trMjX/4M//4wx9w3bA+IMtMu89x4EeKAg1VJ7BYRiKLWGvuMRRKM5KGmIqfHc3mCkyA67o8et99XHHZd2lK1mGMrohoDQF8EiiJ42mCVB8HnHMhdbOPxg/6WfXPv5Hetx0iRYmy8C65ucqKzp5eTj5nCdNnH8A9t9/B1jVvMWHCGN79/vfnG6ZMQeOUrBTrVbJ6NnIhWmuOW7yYBcceR6qnm1v/9ndA8N5L/4Os1fkYsNzNz0krWu0TcxxevumvZLesxE26HPH+LyCbWzA2KsUPUaQp+3Aj7pk2hpbGBn79gx9w+w3X4TouQdavKMVXjgo8VChSC8yYl+mzpXi3KJ64jh2Wxa/UTF5LnjNU11ehsSsN43Q2wHVclj73HJd/4UsklYPAotGDELxaDEi4ID1MNkvdrEM5+IKPEpeSXa8/y66n7iSerI+Km5XvgxGQzfrEGhq4+GMfw89mufeWm7Ha55Ql5zDroIOjyq8s2XrDuCmlJ+3GYlz80Y+QSCZ55qGHeeaZp1l00kkcfuwx9HR34ziqrOEL9f0lwmaxbjNBx07evO0vONJnzLQ5zD7/I/i93UipoqpAbXO/iq4hGnjtC0NDPM5Pvv4t7r/jX7gxDz+CRwtnZFUKefaveFRSEMMOBs/381XOQA2HAjFkbF4iha8Djee5vLl0KV/99Kew6RTSU+GEOCFq6s0ebP/D6m/gKxZc/HFU23hU/z7W3Pg7jFNeRrPIWAmL4yh6e3s594J3MWvOHO65/VZWvbaU1tFjeM9/XBqlX6JIbRsKxHEr3ZRKCZhSDtpoTjrtdA48YiF79uzhT1f8Emssn/zi14glEiHyIvJE6eKbbcAIhdQ+ifoGNj55H9tfeJJACg4643ya5x5NqrcHqSRaGKwwQ4YRpYtWEg3DloJE3ON7X/4Sd99+C57joH2dL7fJYaFNlR9uOTmQgR2fi/cHhL9sEWu1mAtUaxtmNbhyuIW0igl1OI+OQGtcz2X5q6/wpY9+lGz3PpykIgg02BBosFbVTLcY4D4o+nr2MfGkJbQfdiwiCFhx3w30rFmBSiaRZaz/gEp21A3oG8aOn8BHPvMZ+np6ueaqP9Dd3cPxZ5zB7LlzQ+sfddCJSh6gltiyaNCANUjX4z2X/gduPMHLTz/NQ/fczYJFCznj/PPZ19uHkmoIF23RCJSQvPq3n7J3zzbSXhMHX/o5gvp6vEwaITyGwyIPcfzicEZIiecovvv5L3Pb1f/A9Rw0lkBYjKxEUah9ZFLVEISB+Wm15hWVCla1eqXhCPtW9RACjAQd+Hiuy0tPP8UXLvkw/V378LwkWstwYZnh1xqEEAilyAa9tE2cw6wPfBqjk+x48znevPWfqGQMG5jw+ZTTVo3shue49PT2ceGHPsj4SZO45Zp/sOqN5TSPGcv7Lr00FG2ocP9krYWTctVYpRx8HXD84sUsPOF4gv4+bvrrXwmyWS75z89Q19xCNutHgx2qLCSj8RxJx6b1LL3mF2hf0zxjLkd+6HN0GoGDxgwxZXKwJSxeCDoalJ30XL7/jW/wp1/9EkeqMKY1pqhppVy1uByqVdg4Xp4BWqKHUgINDuhj2bCKUePgvlpqFLVIxtcyLNAaQ+D/P9W9d3hU1dr//Vlrl5nJTHrovYMIKFKkCEgTRFERu2I5KpZjAfVYjh48duxdVLCi2MWCoALSpUoRFUEUlN5Sp+36+2PvTApJCMjzPO8715ULJWFmZ++17nWXb0miqToLv5nFuH/8g2RRCbqqYZiWx9D0jasPB16RknR0bFQnna7X30xaemMSJbtYOuUpLHMfiqug2QJDdarNGKWQRONRGjRvyjmXXcrunTv46PXXEbbLiNHn0uqYYzBNq1oq7BEDzh1cpOMiHFAVjbHjbyYvN4dfVv3Ap9Pep2nLlpx3ySUU5hdU22Ep38c1HBc1PcLWuV+xb9kXRGSIZgPOp2nfIVjRAoTQDwt3c9AidlxM28JSIJIe5uVHJjLxzv8gbBtNKpg+Xr0qXEnlB3sonPz/H141R+pyJ44U6FqQD99+k9uuvQ5hGEg9QMK0vAEjTiojKNU8re7+HFSvCEkyYdDh3EvJ69KXkG7z+ydvENuwxpPhdwUJFQJW1RwC17++kliMf9x4PZnZObz20iT2bPmTpq1actk1Y3EcF7WS4mCFZ3mkN0+4pY7bEsuy6HpiL0aMPodE0uCN555n11/buGTstbTv2IV4tKSCrVKVN99xQdhk6SFWTH2F4r/WE6ybReve/Ugqqo8QrGETCXCFg4OD64vHaopSao3gke5LHdJdQXZ2Dh+89Ro3XHope3bsQNN1bMfGES52inxeZuxXVR1U1XS0Ot3/qggv5eXQXWo2Dj/cXN49DKvUip/l4OJg217UtE2LR+++m0fvvJuwKpG66vnElRbIUvHvt0ARXkHquA7SBUt6NWDlha8gEdJ7MkpmLi1PPgWRlsv2lbPYPOMD0tOzwZS4roN0XL+uqCQ2hoOUDkVFBfQ5eRAjz7+I9atWMuujD3FUyTmXX069Ro2wHdu7xmrup6xVnnaoaCcEtutwxQ030KBZM7Zu3syLjz1OekY6/7znToRUUaRSYx6tOQJhg6O6WHt3Me+lh9jx7bus/vJDAlL13clr2JR+USkcMJImsXiCZNIioOopvq2QZUM907LIycxgybx5XHb22axavBhN0xBIHMtXY3YPL5rWprNyaB+sQ7us/M8eDRLbAVXV2LX9T264+GLeeWUy2ZF0ENJb3OW6KY6PFFCkgmnYOA5ogYAHN3CrnuSXLmNNOLixAtZ99CZb5rzH0peew1ISmJj+OKEs0JZrH2L7cueqDWmZWYybcDe4Lk9NnMi+3Xtp26kLoy+5BNO2PP1at+omSY0boKp+uDhIutvf0dIDj9Vp3ISLrroKV8LM6Z+wdN539B86lBHnnkdBfoFniFZVd8IFQ7hYCOLCRk1TcDasZ8FDdxH/9UcUTcdwnTIziKrgB45nvpBIJMmuV4/HJ79Ku67Hc6CgCF1Tvc5LpSrKMAyy0tPZt2M7N4y5hDeefwHpOOiq4lErK+h2Vp0eHQrCUFoEl/+z8qHglqsVjtTD+FBF9EHdKl+Cxi1XeziOF601RWX+t99w5bnnsm7p99TPy8OybRxXIMp1eVy/1SxwKY5FEWkhHnj2GfoMHEA8HkeTStWpi/CErhzHJaAI/pj7MWseuh21cC+2lo60pD+oFAc1EzylDBdNUcgvKuLCf/yDdsccy0dvT2XpvO9QdZ2xt9xCOJLhL3CJW0NLWx4OIKqmlFFDYNkOoy6+iE49u1FUXMiLjzxONBrlynE3Ub9RI6IxDy1aWcUYDy1NwJHojuZBpwM6WkRD11QcV0G4IoWdqcoEWQrhYTxUhdsfuI++Q4fw1OtTGD7qTPbs3edtEJ987viLwhYutmMRDgYIaQovPfwQ/7zkYv7YuBFNV72D1nE8CEUV4C4pxSE9syo+PHEwWE6Io8ZbOKyc33G8L7/1atkWqqqSTMR48v77uOvKa4ju3k84I5OEbWBJT/RYOJUCkBSYSYP2XTrx6vvT6D98OE1bt0JRFFRFTXW/KkJhvLLfFio2KqqejkwPYAQgbBq4in2wn1q500OXkuKCQlod14kx14xl57btTHn+RVTb4dQzz6Df0CHYpkNK+VM6Nc4gqs0Va2sSUUbpcAmEQtwy4V5ysnPZ8ONapk6aRL2GDbjp3/eQtG2kWuE8K5suOyJ1QUJ45ArX9KKE4joolSNb6enjQ2wCmkZBfgFjrruOfoMHk0gkCIcj3PfcM4y79z8YloORTKDrCgjXJ14rKELFdSWOq5CZmc7Sed8x5syRTJ30Eq5le9inVBT1JAt9mF5K9Yzq2HT+VapC8ZWsBbgyZeKMK8sULA7RTi2v8lYdLr9G/JUoa8UKH5fkAo7lsbg0VWPlooVcNWoUbz3/IoGgjlQ1LNPy6iaHUqYJQrhICYoicByLnAZ1eXrKZNoe2wnHcWjcpIXX1yrtrlXiQ7gIVDc1HUJaDrYtkLbAVgSukFUetR5P2NMbUoIh7rr/EdIi6Tz32MPs3fEXjVu05qY77sLxtSVd4a9Ml6NbBFdXB0ghME2T7j1P5MKrrkQ48NHk1/lh2TKGnHU6Z19wAdEDJQQ1jfJeWFXPRsvIzk4VsjqiQidAsrcgn659enP1DTdgmh45w7Ac4qbJZdddzwtTp1K/RXOiRTGCvgyLqBAQvZ+NZGRgJ00e/+99jL3gPNYsW4quqCiqiuk4mN7tPUibv6rIX8qFMrHA0wTw7VLLY99lRYlz99ADpNpCIKprkzl4eb5UFFRdY9e2v5h4x13ccOllbPplA7nZ2diO47WOD0UGsm0S8TgJw8C0LISQNGzcBMWXQC89YQ7anE75QOGA44EZHUekoCopV0j/gUsHgopKcTTK2FvHcVzP7nzx0YfM/fQLVKlxxfibqN+sibdpRdX6EwfVAEdCkqiphyx9nNCVN95Ix25dKTiwn0fuuYfCwnxuvOMOWnXsSElJiZeu1NCrru4zqjLOSJoGkZws7p44ES0Y9ODYwiWgqwQ1nYRhcEKf3kz+4AP6Dh3KngMHKkC9yx6EwLa9/LJOTha/rFrJPy++iPtuuYU/Nm1EV1Q0RcWwLVzHQSJqlJQpbVy5rqAov4h4NI7lekBCTVG8L1VFVdUKKUVNPfxDEVXcalrDpfm6ZXnphaYqxAoLeX3Si4wZdRafvPkWYVUnFEpL+a9VjQgVFVQohJTk793Hti1bPUEC16Feo/rk5OX43aLDpV26B7mV+uIZaIpKQVEhfYcMZczY69i8aQOP338fiZIofQYN5szzzydpmb57UPUzrfIvZcKECff+XRnsyket47oEgkGat23JzJkz2Pv7n0SjMQaPPJ1WHTswY/onCNuL3NUpQ9dGctAbximUxKPc++hEuvXph2laCAmKVFkw+2vSQ2lkZGURTySIpGcyZOQI8gsKWLPoe9LCaRUWjHQVPy13sVwbPRBAQbB2xXK+mv4J+/ceoGmLluTk5iClLBPaLTd5K78IJRJHCFq3a0fTFs1BlcRKiokWR0lE4yQScYqLiwmlp3P2xRehafphQxYqY3aqSolKr1NRVRRFEisu5vP33+fh2+9g1kcfI2ybUCQNxy073SqfNFJKFEXxn2/ZyaCrKolEkm59T6Jdx444tkMwFGTujK/Yu3snuhYoky45Ej1WhO/tJUnEE6TXy+Wxl18mLZLOv6+5no1r1lCvRTMefWUSGZlZXppabu5UHTq29O+UCRMm3FtVHVA7R3cq3KDS70spMW2bRo2b4toWPyz8ns2bfqVpq1b0GTCASEYWs2fNJCOUhut6wq/l8fNVP/wyB9jSFrumqRQU5nPOZZdz+T9vJJlI4rgOuqazcvEirh9zGd/Pm0e7DsfQuFkzkskErisYMHQI+w/sZ93qVWQEgliU5qqlHRGJQPjYdkgLh3Etm1XLlvLtl1+wa8cO8urWpU69einYt2WZKSHEUh6sVLz7kZmVRefu3Rh25lkMO/MM+g4aTKcTutG8TTuy69alebu2DBg8pErRzMoS8qX/Xb4eKE8LFa6nOeQV8B7xW1VVpJQc2L+Pz9+bxmP33MP0994jVlxMeiQ9BR/3mgnyoJNFURUc26S4pAjTNNB07/0cBIqqYxhJ2nXqyAm9emOaFnogwJJ58/jj102EAkGqo8WX91eucYNLwHWIJ5M88MwzdDmhO68//zxfT5uGFkrj7sce5/gePbBtu0K7vVq16fKBwrardiqoLVqwOg6BN+l2wLG54dLLWDZ3DvVbtOCFt6bSvE1r/jv+FqZPm0ZudhaGZfgw1aouttx74ZZbAAqxWIwW7dvy2iefoqWFcV0HVUoKdu/hkrPPpnjvHnBsXEXntnvvZeSFF6TG4lYywZXnjGbL+l9Q0gKe86RLhU5N6WeCly/risQ2TQqLYwTTM+jWrzennnUWvfr1I5KemQL5WZblmdgpZTwL27ZBCDS1Sk8SbGyvU4Ws0S+hKhIP5Tpbln8a6OU208Zff+Lb6V/w3ecz+HPLFvSQTjAQwrYs7HKiwuX9fEs/R1MViosKaNyqFaPHjGHhvAWsmPMdpm0SyUonGApQtL+QIWeM5MEXXiQajRMOp/HkvffyzsuvkJOVjWlbNTrrHGoD6Ipgb+EBrrnjTq65aTxL5y/gzuvGEi0s5Kwxl3HnQw9hWVaFCfShhBQqpEBHNAkuZwJdLUBLgFRVjuvenYWzv2XPX9vYuOFXhowYQe8B/Vi5YgVb/vidSCiIY3uHrxBVdzcqf6Zt29hS8uTLr9KoRQtM2/HyZxcevOsu1i9fRSSShq5KVGDWFzOo16gBx3TpQsI0CIVCSAHffvkVgUDAg+RV7j5QZtfqOg6ma2NJ0EMBHNti84/r+fazL5gz6xv27NhJIBQip042WiBQdl8cJ7X4hRDYtseVsBzbLzK9ibOC9FCpVdQTVT5UP9VKpTdSokiJKiWKEOz4809mz/iKFx55mFeffJplCxZgGHHSImGEkGX4+hSM4eB6RlEU9u3fT5eePXlyymR6nTyI4WeeRdc+vTBti11b/yReUIgrJKFIBiNGj8JxQdM0/tq8mQVz5hAKhaqeQxxiMl3696qmUZifz9Azz+T2Bx5k6+bf+dfYsezftZO2xx3PA888h1DVKhWna7O5qj0BDoU8PCTryBd/tU0LVddYNGcOd1x9NVYszumXXMy/H32U7Vu2cOW551C4ZxeBYBqOXYYnqewxAE6qUaLrOnsP7OPWe+/joqvHkkhaqIAaUJkz8yuuG3MJjXPr4rhguSaKVEhEEzRp3YJps2ZhSUlA1dj0y89ccfoohHAQ0kW4lY9/O0VYKfW8soXX3VFcUBWvZjASSSzDIBgJ06xNG7qe2JsTevemXadjqVO3biXEh4tr++TMckOwlONmDXDn0parKJ15lD9BDIstmzezeukSli5ayI+rV7Nv105AIRyOoKgS17E9/JnrpnyGq0u5pJRES0o47ezR/PupJ3DB035SNDRdA2DzLxv45N13+OaTjzFsl4/mzSarTn00RWHJN99w81VXEQ6lHURmqY3ihPBdQaPFxTTveAwvT3uPgB7kuksuYPWiBWTUbcDkjz6g7TEdMS1Pi7SmtVpjEXwQAvAQcntV8Wmryl1ECitk06J1a6SQLFu4iF9/WkcoLULfwYNpf2wnvv7icxTHRSjS661Xvp7USNxF6JLi/EIGnXo64++dgG157CQPHWJTr34DNE1l8fyFqK6LnqbjCigqKqZVhw6cce65CCFRFE83fuZHH2OaCRSpVtAnLW3PCakghIIjvEmol+M7KKVGpUKiahqhtDSkEOzbtYfVy5fzzWef8dUnn7JswSK2bv6daFEhQghCoTT0gO719RWvsFQUpYKjS/mv0u+X/xlwyN+7j00//8Ki72bzydS3ee3Z53j3lVeZ9/Ustv3xB8JxCaeF0YNBb6rqVMIUVPH8Kptr4LpoAR0hBA2aNCYSSUdRFM/cxHHIq1+PPgMHMmTECAKRdFq0bE12bg4AsXiMrz+d7plXHAanQgiBKwWqFJiJBKHsXJ6cPJlGzZry0L/v4Puvv0ZTQ9zz+BP07NcPwzTRFLVGalGN+q2lJ0B1OX9Vm6IqDHy10oN+pLNsG13VuGfcTcx4ZxqRrEzuffYZBg4/lRkff8SEm8aRmZbmA9fc1AYqP1RSgGQyTqROHaZ+/iV5DRqkNF4EAsOykcKLzN/NnMkTEyawa8sWEAIlHOGFd96iW68+mJaNqkg2rF3HteeeBx6fKUVnLVsUNrbtYhoW4bQAQpX+ANWfVJaae5SfSfjzEMdxMAyDeDKBaVvowQDZ2bnUr9uAeg3rU79RQ+o2qE92nbpkZGYQDodJS0tD8aOrZVkkkkmS0RixWIyCfQfYvXMne7ZvY+eOHezasZP9+/ZREitBAKFAgEAgiK5qtaJvHso9svT70VgUVzi0OeZYhp15JsPPPIN6DRunTh3bdtBCuueF7VsVSUWyc/ufjBkxkkRRIVLVqhxGVS9KBrZtkXRcnpzyOn0Hnsybz7/AK088jmVbXHHTOMbeMp6EaaCrGsJ2ceXheyp4rWrHcf83RF5dx8VRwIjFuPmiS1m7fCmZ9fJ44uVX6NzjRN588SWe+u995GRm4WCnTPpS0UkKJC4lxSU8+voU+g8dhpFIIjSJqgi2bNxMi7btcFzX32wqe/fsZPrbU9m7dz+nn38enY47HtO2sW2LoB5g0qOP8trTzxDOimCbZadMCitkJqhTryH1GjbmxzWrMeIlBINBQmlhpFBxK3GfK5Dg/X6iVEilG67tXZtpWximkaoNFEVB1VR0TU/hZxzHxjBMr4D0IQsSrx0opUSqCoqmeZNs30LUdh2kA0ol2l+F55tiUrkV2qTVzRsUKdAkJEyLaCJObt16DBo2glNHj+LYrl29QZ9lYts2mq5TOnw1rAQXDB/B1o0byYykVzu8OzgySxThUGwmuffJpxlx1ig+fXcaj919N1Y0zuBzR/HQc89h2LanUuIKamKbHKoGOOwi+MjdBxVcF4KBIN369Gbh3Hns376dpYsX0aPvSQw8dTi267Bo7ndeUew4ZdKCQqArCvFkgjE3XMvoMZd7ZAwh0DWNhd98zeVnn0uypIRuvXp6inCWRUZGJif07sNJgwdTr34DDMPAsh1CgQC/b/qFR++ZQECCLVxvBpAqwL33LYkWc+GVV3Dfc8/So29v6jZsREkswb49e4gXFyIQKKrqtQ7L5/OVDMDdUlcUKRGq4qVMwZD3FQgS0gNoqobinynSZ8hpioIS1AkGAgSDQYLBIGoogKrpCKUcrslxPCM5twxgUj6tURTFc9BxHBLxOLFolHgshmGauI5T9v3KEo/+vXAc75QNBoIk43HWrljOjOmfsv6HlWSEIzRp0Qpd15FCgOnZtmrBAPXr1OHrL2cQDOh+e9atETPl1R6C4licf93/AGedfwGLv53NfePHE40Vc+yJJzDxhZdQVD0FSeGQQOWj1AWqLcOopn+rSM90LzM7my7dT2DujK/Yv2MnK1auoM+ggQwafirJeJIl8+cRCgWxRanpkcA0DSLZ2dzz0EOkZWRiWxa6rrNrxzbGXz0WJxbl+4UL+WPjJk4edooHxLLAdCxMy8K2bBwhSAsEKD6wn3+NvZbdf/2FHgiW6qz6QTNlyoWiKFx9y3jqN2pC/YaN6N6nDyPPGc2JJ/UlMy+XgsJidu7YQVFxEUKArmsIKXF8jRohJFIoKc0fr0/v5eOu7aZShlJyVKl/gANYPl0T19OBdVwX23URPi5EOB6WqdwMzlv80kvKFG8aiGtZxKNRYvE44cwM2nXqxPEn9qR771607XgM4cxMCvLz2bt3D7qqIqXA9lPQUvku1y/8HcdBKgqBtCCakGzd+BuzZ8zg+/nzsC2TRk0bo6cFQUhs16FVu3YYyQRLFy4iLRTEtiwfB1Wx2+e1nx1s4XIgv5Dxd9/LhVf/g7Url/GfG24gXlBI0/btePaN18nOrYNrOx7LUFTCxVQTpI+4C1TbSrq6k6Ky3lDpn5blacp8P28ut1x9NWZJjGNO6MaTU14lt249Jt79H9566SXy8rJT0UwgSJomjVq2ZMIjj9Cle3ds22L85f9g2fzvSM9Ip6SwmCYtW/HWzC8Rqle86ZX67ht+/JEH7riDjWvWkp6e7stsl/J1HR974hKLxWjeqjVvffUlejDsLVo/Eiqqt/CS0Rg/LFvGnG++Zsm8+WzbsgXpuqSnR9BU6Z9gMiXJ6FZRU1XOu2Up0E6UhXNRzldFuNUHJMdxURQH4bpE40lKjCSR9Aw6HXc8g4YPp0+//jRp1QIqtHtd/vr9Dz597z3eee11nKRBRloI2/W7bv51VxT/9RafJzBlEy0pJm6YtDq2Iy9PnUrdhk28Aadr45gWY8+/gHUrlpMZjmA7Pha0PCdeghQuuwsKue5fd3Ht+JvZuH4d4664nH3bd1KnSROef/ttmrdpi2XbKEKW3Y9a1K41ruvyRfDfrQVqnR65roe50VVmz/qK+2+4CTuWoFWP43n85ZepU7cBj0/4L2+/8jJ1s3OwXBvXscAVRONxFF3jjgcfYNfuXUx+6HHy8nIwhU20qIS+Q4by+JQpxOJxgsEg307/jJXLltKwUSM2/7qRxfPmkyguJi0Y9JwlK8waPFcbISX79u3lkmuu5fYHH8IwLXRVqZBXx0zD6+qoXtEazS9gxfffM3/2bFbNX0CsuABHSL9z5B6Ss5tCuJYueuHVTW4lxpio4USW0oM5SF2jQ9cunDRoML36D6Bth44e5BywTLNMoQIXFAVVUZDAupU/cNfNN1G0fQehYADDsXAECNupsHkraDP5Ra+uaOQXFDBoxAgemTQJy7VxXAdV0dm8fj03XXE5icJCTxe23PBNSolQoKikhBtuu5PLbvwnG379mfGXXsru3/4gs1F9nnvzLToe1xXTNlGlWpFD8TcDdoU2aFULuKrj5O+Ks0p/SmrZNm3atqNeo4bMmT2HnVu28sOy5fQbPITBp43AcW2Wzl9IWkBPwXfTgkFUAfO//po1K1YSDOpYjulhRRJJjut9Iv0GD/GKMk3j2+mf8dLjj/HjDyvYvGEDIUUhqAewfIJNxQjqRT2heEXrNbfdRuPmzXEcB0WRLFu0kDlfziAvN5fcvDw0qeC4YBgJAuEQLdq2ZcApp7B84UK2/L4ZRVNTaU5N90pVVRKJBIUFBUQTcRKxOEY8SSgYRChKrfgCUkoSiQT9hw1nwlNPMuaaa+jasxe5depi2QaGYaKpaqqlqvp/4oJhmX4K04RefXvz9cwZ2EkDKX0VNbeqjmAlaLrjkB5OY93aNYTCEY7v0ZNkPAlA3YYN2bN9G+tXriIQCvhDT++aLdOisLCYm+6ewGU3XMeWTRu57cqxbN/8O5GcbJ6YPJku3XtimRaaolaZ8tS0AQ61JtXa4iZqmk6WT3lqI/fhcWBcVCkxDZNTzx5NwjB49K5/s3ntOm67+momTprE9bf9i0AgxAsPPkRmJIQS0MBxUFSViKrh2C6GD8xybYgnkmTn5Ka6CQCOdMnNzSU9KwPbMHFdF9MxqUl52k4kaNmuHV1OOCFF2AHBB6+/yRcffMAbL77EMZ0703/YEPqefDINmzRLtUG3/LaJNWvXomk6juNWm/KUPSAwEjE6Hn88zdt3wEjEPai2bbN8/iLi0RJcKXAd24eFHByFS1/JRIJQJEz7Tp2IGyauaSGFQFV1FNXl13U/snLRYjb//huOgM7HdWHYGWeSFknHsSwMw6BF2/Zce+utPHj77WSF0srSuHIg8IPXhHcNhmURCYeZ9MSTdO/Zkw5du2Ikkjz13/uY/v4HhMJhLyBIgS4EhpEkmkxyxwMPccHVV/DT+rVMuO5GDmz+k+zcOjz40nOc0KsPhml5/G738MSSDyU6nNoARyP9keWQnYfqN5eHvSuagmVZjLrgQnRF4fF7/sPGtWsZd/nlPPz881x54w2kZ6Tz+L0TCFuCgBbAsCyvWYxAQaa0N4WikJOX53WQ/I8sKirESpo4VqndUym4yDmYDiEEUhHEi5Oc2L8/oUg6hmGg6TqbN/7GsiVLaNyoIbaZYOn87/h+7mzqNmzAcT1OpHf/AfQfOoTFc+ayf+du8nKzPIBZDSeh46dcFg7/uncCrTt3qfAz99x4IzPe/4D0nCwcfHWDahaA47qE0kIsnDObfdu3k9uokU92UVg8dy5vTHqJ39b/QnF+AQgHy3H4+M03mf7+hzz83HM0atoUVUoc2+HUM0bx3uuvseWnX9AjER/WLWqghHr31bEdNEXFjMV4/KH7GXfXPTz3+BOs+m4ekUg4peof0DQSyRhuMMCjzzzLkNNHsnrZ99xyzdUU7dxLRnYODz73DCf2G+BPeZVyHbbaoUprIwh8WISYyk4ttVUuO2QV7suFJ02L0849j7semYjUNTauW8s/x1zML2t+4LzLLuOJyVNQ09IpKI6hSRUsO0VT9Fp9klBAp2F9D6GZMLzbXVJUVKbDX1rUuVUXTdI/nWQgSO+TB/rzC4+ssW/nbtLSIpTEE0RLomSGwzSoUwc7FmPul1/yn3E3cuEpw3h30qtkZaTjVGLNHDR08oNGYUkxx/fpS8uOHYklEli2TdI0cByHU844HVuRPvegZtlZ13HQ9QCF+/axesUKT7jMcRAStm/5g6Vff4PEJpKbQUZWJnnZ2TSuV59NK37godtuxzCTnru7YaKHggw59XQShokiRa0Ek0vXheM4pIWD/Pbjj/zzgvP5een3ZOdkI3xslKIoHDiQTygnj2feeJshp49kwexvuPXKKyn4czuhrCwefPkFThw4kKSZ9I3aay/ZWR0ltdp0/Ehx2odz5NTm/XVFwTBthp51JhOeeAI9EmH7n38ybuxVLJ0/n36DB/PC1Kk0atGcvfsPeL3wcu9tOw56UOe1F1/i13XryIpEcF2XaEnUmxZWoJu5B1E6wXMWSRoGzVq2oqM/NFNVFcux6dmvDx/N/paHJ01i2OhzCOXksqeoiIJojGBaiKzsHAoP7CdaVJBSthY1JatCoEmFgKJy7kWXIBUVRfGg2Jo/ze3epw8dOnUkkUj6MN+aJVOEEGi4LJk/NxXfHNel35BB1GnWhETSwLE8PR/btUmaSbJys1i+ZBGLZ89FCknSFxDr1qsP4UgGogYsf5VCWEJgO8KXoPFwWx5TTKDrOgX5+bQ+rjOTpk2ja48efDx1KnffcCNF+fnUadaMF95+m179Tsa0LDRVP5hrcRSHttVaJP2dLtDfGBWjSEHCtBh8+kienPIadRs2oWjHXm6/+iref/012h17LK9/9CEDzxhBYVEBAVVB1TxdGtu2UYTCjz+s5oqzR/PBlNdSngZCEb6siqBMp5QKTpOlgDQjmaRH/74eB8B0PBFfKTFsk0hWFoOGD+eBZ57hzc8/4/4nn+akIcNA1bCTpjcM0tQyHwK3mnvk10tGMknn40+g94CTsSzHG4O5Dq5lY9gWgWAaI0aP8qK7oh50YB9sUWqjB0IsW/w9+3ftQlElhmFSv3FTOnfrgZ00CUo1pYVqA3HHwjQN5s6YmUpJXaBBk8bk5OWmCtbaaBWVuWN6swwbMFwbKR2k61BQUMjpF57P6x9/RIvWrXn20Ud4/M47SRwopGmbtrw07V06d++OaVjehnfdo2o3VRUiVR7JQq5t6nM4m8b1CdsBRWKaJj1POokX336LZu3bU5Sfz8S77uDxCf8hs04eT7w6hatvGU9xMolpmCgSr+dsu2RE0lFdl0fuuZv/3HwjhXv34SoCx0dClnnVHuxgYtsuuh6g75CBKTiwg4viuOiqhhTeYC0ej5NXtx7Dzh7Fk69NZtqML2jZthWGaXpTYYcaOzcunpBU3DQ45exR6MEANg6aqjL9/fcoLshH1bz+xKDhw8mtm4dlmt5QrZrCPVVUazp/bf2T5YsXokiB5dogJINOGYajOEjFL38c1xdLcAnpAXb8+SeuY3s6SkAkI0wonIZhmBzuMhTCReKi4BKQCiUlMYoSCa6/83b++9TTqJrGveNv5q2nnyMej9GxZzdenDqVlu06YFmWpypeXln7CFzva+NxnEqBjqSdebRPitRD9PNE0zBo0a4dz017mxP69UdY8PHrr3PzFVewd/curhx3Cw++9CLh9Cz2793nwQz8HFRRVXKzs/n20+n89vMvaJqO6bjVjPrLrieeiNGsdRs6H+d1f1zFI2ndf8cd3D/+FpbOn0+isJhQKJTqeiRMA01V2LdvP6qqVuvWXkqAF8KDOcTicXIa1mfI6SOwfZ2bgv17eemJJ9n0889oQiGRTNKwcTOO69mTgmgJUopDm3kIF+m6LP5uvkdo8VuHPfr2ITu3DomEkWopI0BFokkVVdMqoESNWJxYcdQr1J1D01PLt0URoEgFXQ1QUFhCnYbNePL1N7j0+uvZsuk3rr3oAmZ/Mh1NKgw7/1xenPYO9Ro1xrCMVKp3tDOQ6q5b8n/wqolIXlrYKponvJuXV48X336LUVdcjqIorJozl7Hnns/CuXMYMGQoU6Z/yIlDhrD/QAGO7aBqKrbjYBomwWDAUy+DClIb1UWIWDTGib37EkyLYNg2qpTs2raNuV/O4LP3pzFuzMVccfppPHbP3axYtBAzniCo6cz9Zja7t+9AKdcJq8pIu7QaVxAUlRQzePgwsnPrkjQMpBAs+W4+e7dsZdmChanJrotgyGkjSNqW721btZ1RytDCdYiEQ6xdsYKi/QcIaBqmZVO3YQPadexISbSkguaOoirEkgmatW3lpXqGgXBddm330Ka6rlcpTHCwgQgpBQgpJdgOhdEow845m6lffk7fgScz65NPuHL0aFYvXISjCC4ffzOPPP8SwTTPuE6V6pEY6dQqcFeHQ5JHU4KvJl2amgZpVSMFQRUS27JRA0H+PXEi4++7n0A4zPaNv/Gvf1zF8xMfpkHTZkx6dxp33PcASkinOL8ATUpcBSzhIqTvxFILb4FAKEDvgSd7+bEvljtnxleUHDhAwzp1CGWG2b13Fx+/8Qa3XDSGy04/gxcmTuTr6Z8R0gMVImU1vUoPYu1aZGfncNZ5F+DYHjnFMQ0+//BD0iNhlsybR9GBfALBALbrcOJJ/WjRti3xeOyg1KeqWkrXA+zavp11q1enagMhJP0GDSZpWylRWVVTicZiBDPTOefii71JuB/Jf1y5EjORqLABqiTouC6yTAUAKaAw/wAyEubORx7mgWeeIbtOLs8//DAP3nIrBTu2k5lbl3ufepqrx4/HtDxErSKVMvuq/8VgLA9noVbF2qlul1V3VFdnt1n5M0tRjcJXXzMti1GXXMITb75Fo7ZtiJWUMOXpp7n63PP4Y9NGLrl2LFOmf0LvIYMpKi4EyyKgBlBTVEO3xhmGZZq0at2Gjl27Ypug+2YK4XCYpm1as3P/fgp2FyBtSWZ2Nmq6zl9bfmPKU0+x+ZcNaKEQtk9PPLjVWyoo7AlKlUSLGTBoMK06HINhmAR1jZ9Wr2bN8qWkpUfYunkTq79fgiIEtmkQTs9k6IiRxBNxD3FZQ5CRrkcocS2bJd/N82sZ7zl079ubnJw6uEmTRDTO7l27UbQADzz9LG2O7eT18TUNI5Fg1vRPiYSDnnpcTcELF0t6Di2OYVFcVEL/4acy5dNPOOOC89n4409ce/6FvPPyJEwzSZdevXj5o48YOvIMLMvyO1/g4OAIDr3Bj3KKfkRt0NrYB9W6Y1BNQVf5sxQhMZMGXbp3Y8rHHzDk3FFIRWHdgsXccOGFfPruO7Rq056n33qLOx97lLSsHPbvzQekL4noHhJG0GfoENLSI1iWCVLFcV1GjxnDO7NmMfG11xh50QVk1s2joKiQ4oJiAqpGTm4eQpHeRFqUbly3yqGfKzzRXVSN084b7X224n33w/ffZ/+BA+wvKmTX/n28N+0dXNsbZAGMHHUW2XXr+QbU1S8K10+DgiGdH5Z9Tzxa7LVyLZsmLVvRoVMXCkviNGnbjsuv/ydvffYZA4YPI2HZWHhkoncmT+an9T8SDIWwbMeTh/S/DtpwiooUgsJ9BWTWqc9/nnuOJ157g6bNW/D2iy8x7qIxrFu0EE3VOfuKK3nhvfdo06E9ZtJICYKlnEhrCWSrzbqqbj0dpJhXWzToodKemlj/R4LSO+jf+H1Fy7a8GQDw6bvvMOXJZ9i3eweqptNvyFCuue0WmrZuw+5du3jlyaf44sMPcU2DSHoYnEoO8D7KUkpJNBrjqvE3cs7ll5OVnZv6GW8zSM9MAygoOMDapctZMOsblixawI4d20gPp6NI6ZtsVH+iulJgxGK079yJVz75GKnovnmI4IdlSykuKMA0TWzLQAkE6TtgEHpAw3UFqiK47ZqxLJg5i0g4UsHsuUKwcMFSbAJCkogbPPbaq/QaOIRE0iAQ0Pnxhx9IJhJ07no8gWDIkxtJJJF6gIAi+XzaNO6/804ygro/XxFV1Bxlki/R4hICwTROHX02V986jpy8Ovyybh3PPvIgKxYswjUdmrZpwc33/If+pwzzhAB8WDXl4NCH42d2pJyUvwWHPpINUPnnStWH/+5nlPbwVVVh6++beeb+B1g29ztM1yQnty7nX3Ell157DUJV+GHJYl55+hmWL1pIQNUIRyLYto3lqzEIvx0ihMCxbXIb16db9x70Pnkgx/XsSU4dj9Ruug5m3CAYDFKa2eXv28O8r77i2YcnIixPTdqupEVZ/ndQNJXiwkLueugBzhxzGYZheXUOLloVtrCJpImqSmzbU7mbPeNL7rruerLCEV+drgq1YyGwpUtACvL3FXD2FZdy5yOPkjAMVB8EB2CbNoZlEAoEQQqMWJw3X36Jyc88S1DTURVwkSkSvQ/g8njKUhIriZIwTXoPOJmrbr2FLid0JRGPMuXxp5k+7R2KCvbjaCqDThvJuH/fTb2GjUhYFro3Ai9DFrmHRhIfSdCsKrM4og3wdz68ti2r2qJIKxxnrlfcqZoHj/106ru8+szTbN/6J0jB8T27c9W4cfQ52Stqv/roY6ZNfoUN635C1xT0kFdgCtsf4Uvh0Qttm1gs5sm9N2xI97596H/KUI7r2YPc3DqpNCOZSBIMBlizfBnXjj6HcCiIBVRnYyCkxLEssuvl8ebnX5KVm+elM1JQlT5DeSSF43gw6MKifC497XTyt29HBjWwS4dFboWCQ7heyzWRiNO4WTPe/PJz9HAEbMfbbLqeav/t2bmTRXO/46OpU/l13WqPviiUSqT5Mk2mZCKBZVu073w8F429iqEjz/CaBV9+yWvPP8+GtWvBtmnari1jb72FYWec5Z+klg9roNoa8GgG3KN2AhzuBx5Sh6Ua47fDPhF8TLjjT3hVRWH7lq08P/FR5s6cgZNMkp6VRc+BJ3PxlVfT8fjjwIXp773HtMlT2LBuLZqmkZmeDhIPHu2U9dkdxyGZ8OQLVU2ncePGHHdiT04aPIjje/UmKzcPgAdvv51P336LzIwMrBpupSIV9uXv4/x/XMFdD0/0FoSqUFJYyLY/tvjDH7BtT0dIKhJFKjRu3pS0SCaGaaLrGhPvvpt3J71Mbp1cXJsKKtRV1TZJw+SF997h+J4npv5+17a/WL5kCYvmzWP9D6vYt3MHUiqEgiFs2/HYZP6zVBUFKRyKolESRpK2HTpywZVXcdaFFwKwZsUKXnvxBdbMW0QyHkdmpjH8rLO5ftw4cuvVI2nbqBzMJahpvdS0MapKhyr/bM3OnZUyktpsgKqIzFWbwh29VmpthxrCxXN7tG0CmkdOWTx7Dq+/8Dw/r1qJETfJyMlh4MjTufi6sTRv0RLLMpn+wQd8+u40Nqxbhy4gmBZEoKTSCg856vpgMIltGyRjCWxXkFe/AT369qVPv/5MevYpdv+1FUXVcJ1yBO0KDCrvVRAr4dX33+OEPieRMJKkBYI8fe99TH3lVXJzMknaFpbl4tg2qqoRjUW59tabuPLmW4j7BJ91q1Zx1VmjCQVVj15YDi5QGaauqirRwgIuufGfnHvZFSz9bj7fL5jP6mXL2LNrFzqCcLqnRGFZjmcK4m8cRVGwbYuSkhIc6dK+cxfOvuBCzjjvPBRN5/dNG3nv1SnM/uxz9uzfQ0gP0v2kk7hy/Di69uzppY2WiZQK4ihmDTWlSbWtQw/7BDgahstHewOULjLplk01HRxsF3RFxUgm+XjaVKa9PJmdW7YiJNRr2JABI0Zw7qWX0aRFCwDmzpzJ59PeZfmihSRK4kTS0z1oguvimI6vpe8iFU/iwXZckvEYsWgMRdFIT48ghYvtuFSdzJASmTq2ezde+fADLCHRFEnR/v2cN/xUovv2EwqoWLjg+lRKAYlEgubt2vDWZ5/hSAUhJKoQXD36XNavWkE4HKlQ1Fd42K7raRZhoUTScFHJ37UHKSRpaSHfAMTBcjwPNeFTIIUEy7SJR+OoeoCOXY9j9JgxDDvzTAB+37SRqa9MZtGsb8jfuwtburRo24FLxo5l5DnnIFUV0zSRPsHdB36kGGW1gcofjQ1Q2wyjwgaozQX9T9UER3Pz2LaN8Iu1/H17+XTaND7/4AO2bf4dy7TIa9CQISNPY9TFF9GmfQcA1q1awefT3mPJ/AXs3bUL6UIwLYxUFaSP23fxFA9AlkVf1ykzuKhC1rHUozhaXMy/H3qQ0y68kHgsSnpWNh+//TaP3HEH6ekZ/rBKpBTiHJ82WBiPMvn9aXTr0y/1vp9Pm8a9428lMyPsX4+osZ3sut6poum676Xm1wo+hEEBXNumIFpCzEjQqEFjBp5yKsNHj+K4Hj0A2PDTT3z67rvM+eILdm7bhiIlzdu14ZxLxzDy/IvIzPB+h/Jc8CMtTI80vT6S7pCwbds9GoSYw+/kHHkr61A5Y+n/W7aD7oPK9uzayQdvvsWMjz5i119/gmNRp0EDuvfrz2nnnEOvfgMAKCzIZ8HMWcz+/AtWr1pJSVExAU0lHAoiVM2XNvS6Io7fc6/2usotTSEEOXXyQPHwQMG0NPL37iNeVFzG9z1o4uoSN2I0a9OGNu06YCdMHEUhUVjE2lUrvZVr19AjLycullKTlv7EFo/AYsTjOKZJICOL5h06MHjYqQw7cyR59esBsGjObD55dxprFy+lMP8AtoQmzRpz2jnnMWrMJeTVqeerY1spaZW/syaquo/VeZ0dybo5CBLxdzbA/8bGOeJcUXrYdNdxsRybgE9e37NzB7M+/YQvP/yQPzf8huNYhDIzaH1MJwaPPI1TTj8t1fr8/dcNLPh2Novnz+OXH3+kML8QTXqbIaBpoEhv+luFf9hB9kQIkkbCtw3yXnoggJDKQe3h8vdVShfDNDCTJjgupu2gqArhSMTn4lbt61Z+wZRKKjqui2skSSYTJEybtEgG7bt04qRTBtK7/8keeR7Yv38fc2fOZM6nn/HjyhUUlBSTFkyjZfv2nHrOKE4ddRZ16jbwTlvDQqiyyiK3dvRY96ittdqkPQdtriOZA1SWPPmfmBv8/ROnLAZ7GHywXU/uG6C4oIBvZ8zk288+YcOaNezfux9VU2jaqjXd+pxE/yFD6Hlyf3TdGwj9tnEjS+Z8x/JFC9jw088U7NsLPnRA03VUVfFanaXuKbbr9c9LvQdKjRtkmd+T6zhQzo2ycoei9BdRpURI4UmluK6vfuekBm/eSN/jPijlfBosy8ZMJjEMA9P2/M7y6tWlTceOdO3dm74DB9G2Q3sADDPJorlzmT9zFuuXLWfnX9sojscJRcJ07daVU847j0GnnkqG776YNE1Pnc498mdaG/3+Gr3patFBOqw5QE1HzKEutjo7zv8rR3VR3mazXNJbKvyqqJ5/uG1b/PD9Er748ENWLl7C3p27sZJJgnqQBq1a0rV3L/oOGkj3Pn0Ih8NeNyf/AD+vXcvaZcv5ad1a/vjtNw7s2UMiVoKDQFU1AloARdO8Pr9bRrksb4XqOE7KprS6++kNt2TqV5G+gYedgsnbpTbgOJZHbjFMEweBFgiRk5tD0xbN6dC5M117dKdztx5k5Xkt3GQiwQ/LlrF47jy+n/8dWzdtxI7HCYXSyGnYkON79+bUs0bRo28fFNUToLV8zkOp11llDdfDye3/L9fHUdsANU16D+cXrDI/q6G1VVOueKhIUfqwbMfvc/sPc9df21g4dw5zZn7F6hVLKdh7wOO4poVp3qIFXXr2olvfvnTrdSINmzROvV+8qJhf1//Ez2vX8usv69m2ZSv79+6iML+QWEmMpGEgHN9lUvFcWBRF8Qw0VFlmb1SuZVqq/S+cihxsx7axTJOk5eDYtvdemkYwFCI9I53cBvVp2qIFHTp1okvXrrQ8pj0ZGVmpa925Yzurlizh+wULWLtyBXu3/kWsqATTdciuU4fOJ5xA/1NO4eShQ2jQrJkPh/A/S8oqN6tTjptd02lQXVT+O52hv70B/qfFcY9cS/TQEuxHevRW5gN76nBume6Ma7N+zRqWfDePVUuW8NuGDRQdOIDrWAQCATJzcmnUsgXtjulE+2M706ZjB5q2aUUoECrbFLE4O7f/xc5tf7Fn9x52bt/Onh072LdzF4VFhSTiCSzDwE4aWJaJaVpYlunLklNGKtF1NE0joOtoAR0tLUQoHCYzM5u69etTv2kT6tWvT72GDWjctAk5deqV+91s/vp9K5t/2cj6dWtYv2Ytf/62iQO79xCPxdBVhYzcHFq0b0fXXr3pP3QIHTt3SXWiTMvG9eVr/r8UzWtjtnEoX4vU2vq7WKAjjeK1gTwc0oPg795A4UCpaKsrfMdIUrl0aZ6+6eefWbp4McsWLuCPnzZgxmMkEjFK4lFsBOH0TBo0akzrdm1of2xH2nQ4hqYtWlCvUWOCoVClX9DBtR0SyQRGMomRTJBMGl5hGo9jWbbnGKMqBEMh9GAQVVUJBgJouieUqwUCUIkeieOwY/t2ft/4G7/+9BO//fIL2/74g907dlBSXIRrmwQ01YNBaDrN2rale5+T6D1gAB06HYv0JSRLHWykFCm6VKlxyP9K86IWm+jvbIDKr/8Ho5N+tFuokHEAAAAASUVORK5CYII=";

function handleManifest() {
  const manifest = {
    name: "TabReady",
    short_name: "TabReady",
    description: "The Tabernacle Church — staff and volunteer ready-app",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f7f6f2",
    theme_color: "#aac27f",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" }
    ]
  };
  return new Response(JSON.stringify(manifest), {
    headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=3600' }
  });
}

function handleServiceWorker() {
  const sw = `
self.addEventListener('install', (event) => { self.skipWaiting(); });
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', (event) => { event.respondWith(fetch(event.request)); });
`;
  return new Response(sw, {
    headers: { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' }
  });
}

function handleIcon192() {
  const binary = atob(ICON_192_B64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Response(bytes, {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' }
  });
}

// ═════════════════════════════════════════════════════════════
// AUTH — UNCHANGED FROM v2.4
// ═════════════════════════════════════════════════════════════

async function handleAuthRequest(request, env) {
  const body = await request.json().catch(() => ({}));
  const email = (body.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) return json({ error: 'invalid_email' }, 400);

  const user = await env.DB.prepare(
    'SELECT id, email, display_name FROM users WHERE lower(email) = ? LIMIT 1'
  ).bind(email).first();

  if (!user) return json({ ok: true, message: 'If that email is on file, a login link is on the way.' });

  const token = crypto.randomUUID() + '-' + crypto.randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + MAGIC_LINK_EXPIRY_SECONDS;

  await env.DB.prepare(
    'INSERT INTO magic_links (token, user_id, expires_at) VALUES (?, ?, ?)'
  ).bind(token, user.id, expiresAt).run();

  const loginUrl = `${new URL(request.url).origin}/auth/verify?token=${token}`;

  let emailSent = false;
  let emailError = null;
  try {
    await sendMagicLinkEmail(env, user.email, user.display_name, loginUrl);
    emailSent = true;
  } catch (err) {
    emailError = err.message || 'unknown';
    console.error('Magic link email failed:', emailError);
  }

  if (emailSent) {
    await env.DB.prepare(
      `UPDATE magic_links SET used_at = unixepoch()
       WHERE user_id = ? AND used_at IS NULL AND token != ?`
    ).bind(user.id, token).run();
    await audit(env, user.id, 'magic_link_requested', { email });
  } else {
    await env.DB.prepare('UPDATE magic_links SET used_at = unixepoch() WHERE token = ?').bind(token).run();
    await audit(env, user.id, 'magic_link_send_failed', { email, error: emailError });
  }

  return json({ ok: true, message: 'If that email is on file, a login link is on the way.' });
}

async function handleAuthVerify(request, env) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  if (!token) return errorPage('Missing login token. Please request a new link.');

  const link = await env.DB.prepare(
    'SELECT token, user_id, expires_at, used_at FROM magic_links WHERE token = ? LIMIT 1'
  ).bind(token).first();

  if (!link) return errorPage('This login link is invalid. Please request a new one.');
  if (link.used_at) return errorPage('This login link has already been used. Please request a new one.');
  if (link.expires_at < Math.floor(Date.now() / 1000)) return errorPage('This login link has expired. Please request a new one.');

  await env.DB.prepare('UPDATE magic_links SET used_at = unixepoch() WHERE token = ?').bind(token).run();
  await env.DB.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").bind(link.user_id).run();

  const sessionToken = await createSessionToken(link.user_id, env);
  await audit(env, link.user_id, 'login_success', {});

  return new Response(null, {
    status: 302,
    headers: { 'Location': '/', 'Set-Cookie': sessionCookie(sessionToken) }
  });
}

async function handleLogout(request, env) {
  const user = await getUserFromRequest(request, env);
  if (user) await audit(env, user.id, 'logout', {});
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
    }
  });
}

async function handleWhoAmI(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return json({ authenticated: false }, 401);
  const newToken = await createSessionToken(user.id, env);
  return new Response(JSON.stringify({
    authenticated: true,
    user: { id: user.id, email: user.email, name: user.display_name, is_global_admin: user.is_global_admin },
    roles: user.roles
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': sessionCookie(newToken) }
  });
}

// ═════════════════════════════════════════════════════════════
// JSON API
// ═════════════════════════════════════════════════════════════

async function apiMe(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return json({ error: 'not_authenticated' }, 401);
  return json({
    id: user.id, email: user.email, name: user.display_name,
    is_global_admin: !!user.is_global_admin, roles: user.roles || []
  });
}

async function apiRolesList(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return json({ error: 'not_authenticated' }, 401);
  const res = await env.DB.prepare('SELECT id, display_name FROM roles ORDER BY display_name').all();
  return json({ items: res.results || [] });
}

// v2.9.3: Team directory — returns roster for a given role from D1.
// Gated: user must be a member of the role OR a global admin.
// Query: /api/team-directory?role=safety
async function apiTeamDirectory(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return json({ error: 'not_authenticated' }, 401);

  const url = new URL(request.url);
  const roleId = (url.searchParams.get('role') || '').trim();
  if (!roleId) return json({ error: 'role_required' }, 400);

  const isAdmin = !!user.is_global_admin;
  const isMember = Array.isArray(user.roles) && user.roles.includes(roleId);
  if (!isAdmin && !isMember) {
    return json({ error: 'forbidden' }, 403);
  }

  // Get role meta (display name + lead)
  const roleRow = await env.DB.prepare(
    'SELECT id, display_name, team_lead_user_id FROM roles WHERE id = ?'
  ).bind(roleId).first();
  if (!roleRow) return json({ error: 'role_not_found' }, 404);

  // Get all members. Lead first, then alphabetical.
  const membersRes = await env.DB.prepare(`
    SELECT u.id, u.display_name, u.phone, u.email,
           CASE WHEN u.id = ? THEN 1 ELSE 0 END AS is_lead
    FROM user_roles ur
    JOIN users u ON u.id = ur.user_id
    WHERE ur.role_id = ?
    ORDER BY is_lead DESC, u.display_name ASC
  `).bind(roleRow.team_lead_user_id, roleId).all();

  return json({
    role: { id: roleRow.id, display_name: roleRow.display_name },
    lead_user_id: roleRow.team_lead_user_id,
    members: membersRes.results || []
  });
}

async function apiContentList(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return json({ error: 'not_authenticated' }, 401);
  const url = new URL(request.url);
  const lang = url.searchParams.get('lang') || 'en';
  // v2.8.3: admins see ALL content rows including flipchart codes,
  // so they can use the Tighten button on codes from this list.
  // Non-admins still see only their role-visible non-flipchart content.
  const isAdmin = !!user.is_global_admin;
  const sql = isAdmin
    ? `SELECT id, title, body, tier, role_tags, event_tag, language, source,
              is_emergency, version, created_at, updated_at
       FROM content
       WHERE language = ? AND deleted_at IS NULL
       ORDER BY is_emergency DESC, updated_at DESC`
    : `SELECT id, title, body, tier, role_tags, event_tag, language, source,
              is_emergency, version, created_at, updated_at
       FROM content
       WHERE language = ?
         AND (event_tag IS NULL OR event_tag != 'safety_flipchart')
         AND deleted_at IS NULL
       ORDER BY is_emergency DESC, updated_at DESC`;
  const all = await env.DB.prepare(sql).bind(lang).all();
  const rows = all.results || [];
  const visible = rows.filter(row => userCanSeeContent(user, row));
  return json({ items: visible, language: lang });
}

async function apiCodesList(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return json({ error: 'not_authenticated' }, 401);
  const isSafety = Array.isArray(user.roles) && (user.roles.includes('safety') || user.roles.includes('safety_consultant'));
  if (!user.is_global_admin && !isSafety) return json({ error: 'forbidden' }, 403);

  const all = await env.DB.prepare(
    `SELECT id, title, body, role_tags, source, updated_at
     FROM content WHERE event_tag = 'safety_flipchart' AND deleted_at IS NULL ORDER BY id ASC`
  ).all();
  const rows = (all.results || []).filter(row => userCanSeeContent(user, row));
  const enriched = rows.map(row => ({
    ...row,
    color: codeColorForId(row.id),
    section: sectionForId(row.id),
    icon: iconForId(row.id)
  }));
  return json({ items: enriched });
}

function codeColorForId(id) {
  if (!id) return '#6b7280';
  if (id.startsWith('fc_01')) return '#1e6fbf';
  if (id.startsWith('fc_02')) return '#d6539f';
  if (id.startsWith('fc_03')) return '#e0a800';
  if (id.startsWith('fc_04')) return '#d97706';
  if (id.startsWith('fc_05')) return '#c0392b';
  if (id.startsWith('fc_06')) return '#2d8659';
  if (id.startsWith('fc_07')) return '#1e6fbf';
  if (id.startsWith('fc_08')) return '#1e6fbf';
  if (id.startsWith('fc_09')) return '#c0392b';
  if (id.startsWith('fc_10')) return '#d97706';
  if (id.startsWith('fc_11')) return '#6d3d31';
  if (id.startsWith('fc_12')) return '#d97706';
  if (id.startsWith('fc_13')) return '#e0a800';
  if (id.startsWith('fc_14')) return '#1e6fbf';
  if (id.startsWith('fc_15')) return '#7c3aed';
  if (id.startsWith('fc_16')) return '#7c3aed';
  if (id.startsWith('fc_17')) return '#7c3aed';
  if (id.startsWith('fc_18')) return '#c0392b';
  if (id.startsWith('fc_19')) return '#e0a800';
  if (id.startsWith('fc_20')) return '#1e6fbf';
  if (id.startsWith('fc_21')) return '#c0392b';
  if (id.startsWith('fc_22')) return '#2d8659';
  return '#6b7280';
}

function iconForId(id) {
  if (!id) return '⚪';
  if (id.startsWith('fc_01')) return '🔵';
  if (id.startsWith('fc_02')) return '🟣';
  if (id.startsWith('fc_03')) return '🟡';
  if (id.startsWith('fc_04')) return '🟠';
  if (id.startsWith('fc_05')) return '🔴';
  if (id.startsWith('fc_06')) return '🚪';
  if (id.startsWith('fc_07')) return '😮';
  if (id.startsWith('fc_08')) return '💉';
  if (id.startsWith('fc_09')) return '🎯';
  if (id.startsWith('fc_10')) return '🔫';
  if (id.startsWith('fc_11')) return '⚖️';
  if (id.startsWith('fc_12')) return '🌡️';
  if (id.startsWith('fc_13')) return '⚡';
  if (id.startsWith('fc_14')) return '🚗';
  if (id.startsWith('fc_15')) return '👨‍👩‍👧';
  if (id.startsWith('fc_16')) return '🚫';
  if (id.startsWith('fc_17')) return '🧠';
  if (id.startsWith('fc_18')) return '💣';
  if (id.startsWith('fc_19')) return '💡';
  if (id.startsWith('fc_20')) return '🌀';
  if (id.startsWith('fc_21')) return '🚨';
  if (id.startsWith('fc_22')) return '👨‍👩‍👧‍👦';
  return '⚪';
}

function sectionForId(id) {
  if (!id) return 'other';
  if (id.match(/^fc_0[1-5]/)) return 'codes';
  if (id.startsWith('fc_06')) return 'evacuation';
  if (id.match(/^fc_0[7-8]/)) return 'medical';
  if (id.match(/^fc_09|fc_10|fc_11/)) return 'threat';
  if (id.match(/^fc_1[2-4]/)) return 'florida';
  if (id.match(/^fc_1[5-7]/)) return 'pastoral';
  if (id.match(/^fc_1[8-9]|fc_20/)) return 'emergency';
  if (id.match(/^fc_2[1-2]/)) return 'children';
  return 'other';
}

async function apiAlertsList(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return json({ error: 'not_authenticated' }, 401);
  const all = await env.DB.prepare(
    `SELECT id, category, note, recipients, acknowledged_by, status,
            reporter_user_id, created_at, closed_at
     FROM alerts WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 50`
  ).all();
  return json({ items: all.results || [] });
}

async function apiAlertCreate(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return json({ error: 'not_authenticated' }, 401);
  if (!canBroadcast(user)) return json({ error: 'forbidden' }, 403);

  const body = await request.json().catch(() => ({}));
  const category = (body.category || body.code || '').toString().trim();
  const note = (body.note || body.description || '').toString().trim() || null;
  const recipients = Array.isArray(body.recipients) ? body.recipients : [];
  if (!category) return json({ error: 'category_required' }, 400);

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO alerts (id, reporter_user_id, category, note, recipients) VALUES (?, ?, ?, ?, ?)`
  ).bind(id, user.id, category, note, JSON.stringify(recipients)).run();
  await audit(env, user.id, 'alert_created', { alert_id: id, category });
  return json({ ok: true, id });
}

async function apiWeather(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return json({ error: 'not_authenticated' }, 401);
  const url = new URL(request.url);
  let lat = parseFloat(url.searchParams.get('lat'));
  let lon = parseFloat(url.searchParams.get('lon'));
  if (isNaN(lat) || isNaN(lon)) { lat = SARASOTA_LAT; lon = SARASOTA_LON; }

  const cacheKey = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const cached = WEATHER_CACHE.get(cacheKey);
  if (cached && (Date.now() - cached.fetchedAt) < WEATHER_CACHE_TTL_MS) {
    return json({ ...cached.data, cached: true });
  }
  try {
    const apiUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&temperature_unit=fahrenheit&timezone=auto`;
    const res = await fetch(apiUrl);
    if (!res.ok) return json({ error: 'weather_fetch_failed' }, 502);
    const data = await res.json();
    const current = data.current || {};
    const result = {
      temp_f: typeof current.temperature_2m === 'number' ? Math.round(current.temperature_2m) : null,
      code: current.weather_code,
      description: weatherCodeToText(current.weather_code),
      icon: weatherCodeToIcon(current.weather_code),
      lat, lon
    };
    WEATHER_CACHE.set(cacheKey, { data: result, fetchedAt: Date.now() });
    return json(result);
  } catch (err) {
    console.error('Weather fetch failed:', err);
    return json({ error: 'weather_error' }, 502);
  }
}

function weatherCodeToText(code) {
  if (code === 0) return 'Clear';
  if (code === 1) return 'Mostly clear';
  if (code === 2) return 'Partly cloudy';
  if (code === 3) return 'Cloudy';
  if (code === 45 || code === 48) return 'Fog';
  if (code >= 51 && code <= 57) return 'Drizzle';
  if (code >= 61 && code <= 67) return 'Rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 80 && code <= 82) return 'Showers';
  if (code === 85 || code === 86) return 'Snow showers';
  if (code === 95) return 'Thunderstorm';
  if (code === 96 || code === 99) return 'T-storm + hail';
  return '—';
}

function weatherCodeToIcon(code) {
  if (code === 0 || code === 1) return '☀️';
  if (code === 2) return '⛅';
  if (code === 3) return '☁️';
  if (code === 45 || code === 48) return '🌫️';
  if (code >= 51 && code <= 67) return '🌧️';
  if (code >= 71 && code <= 77 || code === 85 || code === 86) return '❄️';
  if (code >= 80 && code <= 82) return '🌦️';
  if (code >= 95) return '⛈️';
  return '🌡️';
}

// v2.7: Detect which tab-website-content categories are relevant to a question.
// Returns an array of category names to pull from CONTENT_DB, or [] if none.
// Operational/code/safety questions get [] (TabReady content only).
function detectWebsiteCategories(question) {
  const q = (question || '').toLowerCase();

  // Theological / doctrinal / pastoral
  const doctrinal = /\b(believe|belief|faith|doctrine|trinity|salvation|saved|jesus|christ|holy spirit|baptism|baptize|gospel|sin|grace|heaven|hell|bible|scripture|prayer|pray|worship|spiritual|soul|eternal|resurrection|cross|sermon|theology|pastor dwain|ancient christianity|statement of faith|why do we|what do we believe|how do i (?:get )?(?:receive|know|find) (?:jesus|god|christ|salvation))\b/;

  // Connect / join / membership / sunday school
  const connect = /\b(join|member|membership|connect|small group|life group|class|classes|new here|first time|visit|new member|how do i (?:get )?(?:involved|connected|started)|baptism class|next steps|sunday school|wednesday night|wednesday class|young families|women of the word|classics)\b/;

  // Ministries / events / giving / staff
  const ministries = /\b(ministry|ministries|serve|serving|volunteer|outreach|missions?|youth group)\b/;
  const events = /\b(event|conference|special service|christmas|easter|living nativity|holiday|vbs|vacation bible|5[\- ]?day club|good news club|kids? camp|youth camp|summer camp|fall festival|trunk[\- ]or[\- ]treat)\b/;
  const giving = /\b(give|giving|tithe|donate|donation|offering|financial)\b/;
  const staff = /\b(staff|pastor|leader|elder(?!s\b)|who is|who's|contact)\b/;
  const location = /\b(address|where (?:is|are)|location|directions|parking|map|building|campus)\b/;
  const children = /\b(child|kid|nursery|toddler|preschool|sunday school|vbs|vacation bible|5[\- ]?day club|kids? camp)\b/;
  const apologetics = /\b(reasons? to believe|evidence|proof|apologetic|why christian|skeptic|doubt|atheist)\b/;
  const services = /\b(service time|sunday service|wednesday service|what time|when does|when is church)\b/;
  const watch = /\b(watch (?:online|sermon|live)|youtube|livestream|stream)\b/;
  const social = /\b(facebook|instagram|social media)\b/;
  const recommended = /\b(recommended|resource|book|reading|author|study)\b/;

  const cats = new Set();
  if (doctrinal.test(q)) {
    cats.add('beliefs');
    cats.add('doctrine_pastoral');
    cats.add('apologetics');
  }
  if (connect.test(q)) { cats.add('connect'); cats.add('new'); }
  if (ministries.test(q)) cats.add('ministries');
  if (events.test(q)) cats.add('events');
  if (giving.test(q)) cats.add('giving');
  if (staff.test(q)) cats.add('staff');
  if (location.test(q)) cats.add('location');
  if (children.test(q)) cats.add('children');
  if (apologetics.test(q)) cats.add('apologetics');
  if (services.test(q)) cats.add('services');
  if (watch.test(q)) cats.add('watch');
  if (social.test(q)) cats.add('social');
  if (recommended.test(q)) cats.add('recommended_resources');

  return Array.from(cats);
}

async function apiAsk(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return json({ error: 'not_authenticated' }, 401);
  const body = await request.json().catch(() => ({}));
  const question = (body.question || '').toString().trim();
  if (!question) return json({ error: 'question_required' }, 400);
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'ai_not_configured' }, 500);

  // 1. Always pull TabReady operational content (role-filtered)
  const all = await env.DB.prepare(
    `SELECT id, title, body, tier, role_tags, event_tag, language, source
     FROM content WHERE deleted_at IS NULL ORDER BY is_emergency DESC, updated_at DESC`
  ).all();
  const visible = (all.results || []).filter(row => userCanSeeContent(user, row));

  const tabreadyBlock = visible.length === 0
    ? '(No operational content visible to this user.)'
    : visible.map(c => {
        let tags = [];
        try { tags = JSON.parse(c.role_tags || '[]'); } catch {}
        const meta = [
          `Title: ${c.title}`,
          `Roles: ${tags.join(', ') || 'none'}`,
          c.event_tag ? `Event: ${c.event_tag}` : null,
          c.source ? `Source: ${c.source}` : null,
          `Lang: ${c.language || 'en'}`
        ].filter(Boolean).join(' | ');
        return `---\n${meta}\n\n${c.body}`;
      }).join('\n\n');

  // 2. v2.7: Pull tab-website-content rows by detected categories
  let websiteBlock = '';
  let websiteCount = 0;
  const wantedCats = detectWebsiteCategories(question);
  if (wantedCats.length > 0 && env.CONTENT_DB) {
    try {
      const placeholders = wantedCats.map(() => '?').join(',');
      const webRes = await env.CONTENT_DB.prepare(
        `SELECT id, category, title, body, source, doctrine_level, language
         FROM content
         WHERE active = 1 AND category IN (${placeholders})
         ORDER BY category, id`
      ).bind(...wantedCats).all();
      const webRows = webRes.results || [];
      websiteCount = webRows.length;
      if (webRows.length > 0) {
        websiteBlock = webRows.map(c => {
          const meta = [
            `Title: ${c.title}`,
            `Category: ${c.category}`,
            c.source ? `Source: ${c.source}` : null,
            c.doctrine_level ? `Doctrine level: ${c.doctrine_level}` : null,
            `Lang: ${c.language || 'en'}`
          ].filter(Boolean).join(' | ');
          return `---\n${meta}\n\n${c.body}`;
        }).join('\n\n');
      }
    } catch (err) {
      console.error('CONTENT_DB query failed:', err);
      // Soft fail — still answer from TabReady content
    }
  }

  // 3. Build the system prompt
  const promptLines = [
    'You are Tab, the unified assistant for The Tabernacle Church in Sarasota, Florida.',
    'You help volunteers, staff, members, and visitors with everything Tabernacle:',
    '  - Operational matters (codes, safety, schedules, role checklists, classroom locations) — from TABREADY CONTENT below.',
    '  - Beliefs, doctrine, faith, salvation, "how do I receive Jesus" — from TABERNACLE TEACHING CONTENT below (Pastor Dwain Kitchens\' voice).',
    '  - Connect, membership, ministries, events, giving, staff, location, parking — from TABERNACLE TEACHING CONTENT below.',
    '',
    'VOICE RULES:',
    '- Pastoral-practical. Warm, clear, restrained. No hype. No performative emotion. No preachiness.',
    '- For theological or doctrinal questions: speak in Pastor Dwain\'s voice as captured in the content. His teaching is the source of truth. Recommended authors (if any appear in content) are clearly framed as recommended.',
    '- For operational questions: be direct, lead with the answer, keep it short.',
    '- Do not invent. If the answer is not in the content below, say so plainly and suggest contacting a team leader, pastor, or the church office.',
    '- NEVER invent a person\'s title, role, or position. If the content does not state someone\'s title explicitly, refer to them by name only or by what the content says they "serve in" / "are part of". Do not summarize a description of someone\'s responsibilities into a title.',
    '- If someone asks "who is the pastor of X" and no exact match exists in the content, say so and suggest contacting the church office. Do not guess.',
    '- For questions about the full pastoral staff or staff list ("who are the pastors", "who is on staff", "all the pastors", etc.): do NOT list partial information from the content. Instead, direct the user to The Tabernacle\'s public AI assistant at tabsarasota.org, which has the complete and current staff listing. You can mention by name only pastors who are explicitly named in the content below, but make clear this may not be the full staff and that tabsarasota.org has the complete list.',
    '- If the user asks in Spanish, answer in Spanish. Otherwise, English.',
    '- Software does not dial 911. For real emergencies, direct the user to call 911 themselves.',
    '',
    '═══════════════════════════════════════════',
    'TABREADY CONTENT (operational — role-scoped to this user):',
    '═══════════════════════════════════════════',
    tabreadyBlock
  ];

  if (websiteBlock) {
    promptLines.push(
      '',
      '═══════════════════════════════════════════',
      'TABERNACLE TEACHING CONTENT (Pastor Dwain\'s voice and church info):',
      '═══════════════════════════════════════════',
      websiteBlock
    );
  }

  const systemPrompt = promptLines.join('\n');

  let answer;
  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 800,
        system: systemPrompt,
        messages: [{ role: 'user', content: question }]
      })
    });
    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error('Anthropic API error:', aiRes.status, errText);
      return json({ error: 'ai_request_failed', status: aiRes.status }, 502);
    }
    const data = await aiRes.json();
    answer = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim() || '(No answer returned.)';
  } catch (err) {
    console.error('Ask Tab fetch failed:', err);
    return json({ error: 'ai_request_failed' }, 502);
  }

  await env.DB.prepare(
    'INSERT INTO ask_log (user_id, question, answer) VALUES (?, ?, ?)'
  ).bind(user.id, question, answer).run();
  await audit(env, user.id, 'ask_question', {
    question_length: question.length,
    tabready_count: visible.length,
    website_count: websiteCount,
    website_categories: wantedCats
  });
  return json({ answer });
}

async function apiPcoEvents(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return json({ error: 'not_authenticated' }, 401);
  if (!env.PCO_APP_ID || !env.PCO_SECRET) return json({ events: [], note: 'pco_not_configured' });

  try {
    const creds = btoa(env.PCO_APP_ID + ':' + env.PCO_SECRET);
    const res = await fetch(
      'https://api.planningcenteronline.com/calendar/v2/event_instances?filter=future&per_page=5&include=event',
      { headers: { 'Authorization': 'Basic ' + creds } }
    );
    if (!res.ok) return json({ events: [], note: 'pco_fetch_failed' });
    const data = await res.json();
    const events = (data.data || []).map(ei => {
      const eventId = ei.relationships?.event?.data?.id;
      const event = (data.included || []).find(i => i.type === 'Event' && i.id === eventId);
      const name = event?.attributes?.name || 'Event';
      const start = ei.attributes?.starts_at;
      if (!start) return null;
      return { name, starts_at: start };
    }).filter(Boolean);
    return json({ events });
  } catch (e) {
    return json({ events: [], note: 'pco_error' });
  }
}

// ═════════════════════════════════════════════════════════════
// REPORTS API
// ═════════════════════════════════════════════════════════════

async function apiReportsList(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return json({ error: 'not_authenticated' }, 401);
  const isSafety = Array.isArray(user.roles) && user.roles.includes('safety');
  const isStaff = Array.isArray(user.roles) && user.roles.includes('staff');
  if (!user.is_global_admin && !isSafety && !isStaff) return json({ error: 'forbidden' }, 403);
  try {
    const all = await env.DB.prepare(
      `SELECT id, kind, location, summary, reporter_user_id,
              email_sent, email_error, photo_key, created_at,
              resolved_at, resolved_by, resolution_note
       FROM incident_reports
       WHERE deleted_at IS NULL
       ORDER BY (resolved_at IS NOT NULL) ASC, created_at DESC LIMIT 100`
    ).all();
    return json({ items: all.results || [] });
  } catch (err) {
    return json({ items: [], note: 'table_not_yet_created' });
  }
}

async function apiAuditLog(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return json({ error: 'not_authenticated' }, 401);
  if (!user.is_global_admin) return json({ error: 'forbidden' }, 403);
  try {
    const all = await env.DB.prepare(
      `SELECT id, actor_user_id, action, target_kind, target_id, metadata, created_at
       FROM audit_log_v2 ORDER BY created_at DESC LIMIT 200`
    ).all();
    return json({ items: all.results || [] });
  } catch (err) {
    return json({ items: [], note: 'table_not_yet_created' });
  }
}

// ═════════════════════════════════════════════════════════════
// v2.5 — TEAM NOTES API
// ═════════════════════════════════════════════════════════════

async function apiNotesList(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return json({ error: 'not_authenticated' }, 401);

  try {
    // Anyone authenticated can see notes targeted to "all" or to their roles.
    // Global admins see everything.
    const all = await env.DB.prepare(
      `SELECT id, author_user_id, body, target_role, photo_key, status, created_at, closed_at
       FROM team_notes WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 100`
    ).all();
    const rows = all.results || [];

    // Filter by visibility
    const visible = rows.filter(r => {
      if (user.is_global_admin) return true;
      if (!r.target_role || r.target_role === 'all') return true;
      return Array.isArray(user.roles) && user.roles.includes(r.target_role);
    });

    // Pull author names for display
    const authorIds = [...new Set(visible.map(r => r.author_user_id))];
    let authorMap = {};
    if (authorIds.length > 0) {
      const placeholders = authorIds.map(() => '?').join(',');
      const authRes = await env.DB.prepare(
        `SELECT id, display_name, email FROM users WHERE id IN (${placeholders})`
      ).bind(...authorIds).all();
      (authRes.results || []).forEach(u => {
        authorMap[u.id] = u.display_name || u.email || u.id;
      });
    }

    const enriched = visible.map(r => ({
      ...r,
      author_name: authorMap[r.author_user_id] || 'Unknown'
    }));
    return json({ items: enriched });
  } catch (err) {
    console.error('Notes list failed:', err);
    return json({ items: [], note: 'table_not_yet_created' });
  }
}

async function apiNoteCreate(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return json({ error: 'not_authenticated' }, 401);

  // v2.6: Accept either JSON or multipart/form-data (for photo upload)
  const contentType = request.headers.get('Content-Type') || '';
  let noteBody, targetRole, photoFile;

  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    noteBody = (form.get('body') || '').toString().trim();
    targetRole = (form.get('target_role') || '').toString().trim() || 'all';
    photoFile = form.get('photo');
  } else {
    const body = await request.json().catch(() => ({}));
    noteBody = (body.body || '').toString().trim();
    targetRole = (body.target_role || '').toString().trim() || 'all';
    photoFile = null;
  }

  if (!noteBody) return json({ error: 'body_required' }, 400);

  const id = crypto.randomUUID();

  // v2.6: photo upload (optional)
  let photoKey = null;
  let photoError = null;
  if (photoFile && typeof photoFile === 'object' && photoFile.size > 0) {
    const upload = await uploadPhotoToR2(env, photoFile, 'team_note', id);
    if (upload.ok) {
      photoKey = upload.key;
    } else {
      photoError = upload.error;
    }
  }

  try {
    await env.DB.prepare(
      `INSERT INTO team_notes (id, author_user_id, body, target_role, photo_key)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(id, user.id, noteBody, targetRole, photoKey).run();
    await auditV2(env, user.id, 'team_note_posted', 'team_note', id, {
      target_role: targetRole, body_length: noteBody.length,
      has_photo: !!photoKey, photo_error: photoError
    });
    return json({ ok: true, id, photo_error: photoError });
  } catch (err) {
    console.error('Note create failed:', err);
    return json({ error: 'create_failed', message: err.message }, 500);
  }
}

// ═════════════════════════════════════════════════════════════
// v2.5 — WATCH LIST API (text-only, photos coming v2.6)
// ═════════════════════════════════════════════════════════════

async function apiWatchListList(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return json({ error: 'not_authenticated' }, 401);
  // Visible to: safety, staff, greeters, global admin
  const allowed = user.is_global_admin ||
    (Array.isArray(user.roles) && user.roles.some(r => ['safety', 'staff', 'greeters'].includes(r)));
  if (!allowed) return json({ error: 'forbidden' }, 403);

  try {
    // First, auto-expire situational entries past their expires_at
    await env.DB.prepare(
      `UPDATE watch_list_entries
       SET status = 'expired'
       WHERE status = 'active'
         AND retention_class = 'situational'
         AND expires_at IS NOT NULL
         AND expires_at < datetime('now')`
    ).run();

    const all = await env.DB.prepare(
      `SELECT id, author_user_id, display_name, reason, basis, photo_key,
              retention_class, expires_at, status, created_at, removed_at, removed_by
       FROM watch_list_entries
       WHERE status = 'active' AND deleted_at IS NULL
       ORDER BY created_at DESC LIMIT 100`
    ).all();

    return json({ items: all.results || [], standing_language: WATCH_LIST_STANDING_LANGUAGE });
  } catch (err) {
    console.error('Watch list failed:', err);
    return json({ items: [], note: 'table_not_yet_created' });
  }
}

async function apiWatchListCreate(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return json({ error: 'not_authenticated' }, 401);
  // Post permission: safety, global admin only
  const allowed = user.is_global_admin ||
    (Array.isArray(user.roles) && user.roles.includes('safety'));
  if (!allowed) return json({ error: 'forbidden' }, 403);

  const body = await request.json().catch(() => ({}));
  const displayName = (body.display_name || '').toString().trim() || null;
  const reason = (body.reason || '').toString().trim();
  const basis = (body.basis || '').toString().trim() || null;
  const retentionClass = (body.retention_class || 'situational').toString().trim();

  if (!reason) return json({ error: 'reason_required' }, 400);
  if (!['situational', 'standing'].includes(retentionClass)) {
    return json({ error: 'invalid_retention_class' }, 400);
  }
  if (retentionClass === 'standing' && !basis) {
    return json({ error: 'standing_requires_basis' }, 400);
  }

  // Compute expires_at: situational = +24hr, standing = NULL (annual review)
  let expiresAt = null;
  if (retentionClass === 'situational') {
    const exp = new Date(Date.now() + 24 * 60 * 60 * 1000);
    expiresAt = exp.toISOString().replace('T', ' ').substring(0, 19);
  }

  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(
      `INSERT INTO watch_list_entries
        (id, author_user_id, display_name, reason, basis, photo_key,
         retention_class, expires_at, status)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 'active')`
    ).bind(id, user.id, displayName, reason, basis, retentionClass, expiresAt).run();
    await auditV2(env, user.id, 'watch_list_posted', 'watch_list_entry', id, {
      retention_class: retentionClass,
      has_name: !!displayName,
      has_basis: !!basis
    });
    return json({ ok: true, id });
  } catch (err) {
    console.error('Watch list create failed:', err);
    return json({ error: 'create_failed', message: err.message }, 500);
  }
}

// ═════════════════════════════════════════════════════════════
// CAPTURE FLOWS
// ═════════════════════════════════════════════════════════════

async function handleCaptureMenu(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return Response.redirect(new URL('/', request.url).toString(), 302);
  return capturePage(user);
}

async function handleIncidentForm(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return Response.redirect(new URL('/', request.url).toString(), 302);
  return incidentFormPage(user, null, null);
}

async function handleIncidentSubmit(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return Response.redirect(new URL('/', request.url).toString(), 302);

  const form = await request.formData();
  const location = (form.get('location') || '').toString().trim();
  const summary = (form.get('summary') || '').toString().trim();
  if (!summary) return incidentFormPage(user, 'Summary is required.', { location, summary });

  const id = crypto.randomUUID();

  // v2.6: photo upload (optional)
  let photoKey = null;
  let photoError = null;
  const photoFile = form.get('photo');
  if (photoFile && typeof photoFile === 'object' && photoFile.size > 0) {
    const upload = await uploadPhotoToR2(env, photoFile, 'incident', id);
    if (upload.ok) {
      photoKey = upload.key;
    } else {
      photoError = upload.error;
    }
  }

  await env.DB.prepare(
    `INSERT INTO incident_reports (id, kind, location, summary, reporter_user_id, photo_key)
     VALUES (?, 'incident', ?, ?, ?, ?)`
  ).bind(id, location || null, summary, user.id, photoKey).run();

  let emailSent = false;
  let emailError = null;
  try {
    await sendIncidentEmail(env, {
      id, location, summary,
      reporter_name: user.display_name || user.email,
      reporter_email: user.email,
      created_at: new Date().toISOString(),
      has_photo: !!photoKey
    });
    emailSent = true;
  } catch (err) {
    emailError = err.message || 'unknown';
    console.error('Incident email failed:', emailError);
  }

  await env.DB.prepare(
    `UPDATE incident_reports SET email_sent = ?, email_error = ? WHERE id = ?`
  ).bind(emailSent ? 1 : 0, emailError, id).run();

  await auditV2(env, user.id, 'incident_filed', 'incident_report', id, {
    location, summary_length: summary.length,
    email_sent: emailSent, email_error: emailError,
    has_photo: !!photoKey, photo_error: photoError,
    recipients: INCIDENT_REPORT_RECIPIENTS
  });

  return incidentConfirmPage(user, id, emailSent, emailError, photoError);
}

async function handlePersonForm(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return Response.redirect(new URL('/', request.url).toString(), 302);
  return personFormPage(user, null, null);
}

async function handlePersonSubmit(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return Response.redirect(new URL('/', request.url).toString(), 302);

  // Permission check
  const allowed = user.is_global_admin ||
    (Array.isArray(user.roles) && user.roles.includes('safety'));
  if (!allowed) return forbiddenPage();

  const form = await request.formData();
  const displayName = (form.get('display_name') || '').toString().trim() || null;
  const reason = (form.get('reason') || '').toString().trim();
  const basis = (form.get('basis') || '').toString().trim() || null;
  const retentionClass = (form.get('retention_class') || 'situational').toString().trim();

  const values = { display_name: displayName, reason, basis, retention_class: retentionClass };
  if (!reason) return personFormPage(user, 'Reason is required.', values);
  if (!['situational', 'standing'].includes(retentionClass)) {
    return personFormPage(user, 'Retention class must be situational or standing.', values);
  }
  if (retentionClass === 'standing' && !basis) {
    return personFormPage(user, 'Standing entries require a documented basis.', values);
  }

  let expiresAt = null;
  if (retentionClass === 'situational') {
    const exp = new Date(Date.now() + 24 * 60 * 60 * 1000);
    expiresAt = exp.toISOString().replace('T', ' ').substring(0, 19);
  }

  const id = crypto.randomUUID();

  // v2.6: photo upload (optional)
  let photoKey = null;
  let photoError = null;
  const photoFile = form.get('photo');
  if (photoFile && typeof photoFile === 'object' && photoFile.size > 0) {
    const folder = retentionClass === 'standing' ? 'watch_standing' : 'watch_situational';
    const upload = await uploadPhotoToR2(env, photoFile, folder, id);
    if (upload.ok) {
      photoKey = upload.key;
    } else {
      photoError = upload.error;
    }
  }

  await env.DB.prepare(
    `INSERT INTO watch_list_entries
      (id, author_user_id, display_name, reason, basis, photo_key,
       retention_class, expires_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`
  ).bind(id, user.id, displayName, reason, basis, photoKey, retentionClass, expiresAt).run();

  await auditV2(env, user.id, 'watch_list_posted', 'watch_list_entry', id, {
    retention_class: retentionClass,
    has_name: !!displayName,
    has_basis: !!basis,
    has_photo: !!photoKey,
    photo_error: photoError
  });

  return personConfirmPage(user, id, retentionClass, photoError);
}

async function handleAuditLogPage(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return Response.redirect(new URL('/', request.url).toString(), 302);
  if (!user.is_global_admin) return forbiddenPage();
  return auditLogPage(user);
}

// ═════════════════════════════════════════════════════════════
// CONTENT ADMIN — UNCHANGED FROM v2.4
// ═════════════════════════════════════════════════════════════

async function handleContentList(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return Response.redirect(new URL('/', request.url).toString(), 302);
  const all = await env.DB.prepare(
    `SELECT id, title, body, tier, role_tags, event_tag, language, source,
            is_emergency, version, created_at, updated_at
     FROM content WHERE deleted_at IS NULL ORDER BY updated_at DESC`
  ).all();
  const rows = all.results || [];
  const visible = rows.filter(row => userCanSeeContent(user, row));
  return contentListPage(user, visible);
}

async function handleContentNewForm(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return Response.redirect(new URL('/', request.url).toString(), 302);
  if (!user.is_global_admin) return forbiddenPage();
  const allRoles = await getAllRoles(env);
  return contentFormPage(user, allRoles, null, null);
}

async function handleContentCreate(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return Response.redirect(new URL('/', request.url).toString(), 302);
  if (!user.is_global_admin) return forbiddenPage();
  const form = await request.formData();
  const parsed = parseContentForm(form);
  if (parsed.error) {
    const allRoles = await getAllRoles(env);
    return contentFormPage(user, allRoles, null, parsed.error, parsed.values);
  }
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO content (id, title, body, tier, role_tags, event_tag, language, source, is_emergency, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, parsed.values.title, parsed.values.body, parsed.values.tier,
    JSON.stringify(parsed.values.role_tags), parsed.values.event_tag || null,
    parsed.values.language || 'en', parsed.values.source || null,
    parsed.values.is_emergency ? 1 : 0, user.id).run();
  await audit(env, user.id, 'content_created', { content_id: id, title: parsed.values.title });
  return Response.redirect(new URL('/content', request.url).toString(), 302);
}

async function handleContentEditForm(request, env, contentId) {
  const user = await getUserFromRequest(request, env);
  if (!user) return Response.redirect(new URL('/', request.url).toString(), 302);
  if (!user.is_global_admin) return forbiddenPage();
  const row = await env.DB.prepare(
    `SELECT id, title, body, tier, role_tags, event_tag, language, source, is_emergency, version
     FROM content WHERE id = ? LIMIT 1`
  ).bind(contentId).first();
  if (!row) return notFoundPage();
  const allRoles = await getAllRoles(env);
  return contentFormPage(user, allRoles, row, null);
}

async function handleContentUpdate(request, env, contentId) {
  const user = await getUserFromRequest(request, env);
  if (!user) return Response.redirect(new URL('/', request.url).toString(), 302);
  if (!user.is_global_admin) return forbiddenPage();
  const existing = await env.DB.prepare(
    'SELECT id, event_tag FROM content WHERE id = ? LIMIT 1'
  ).bind(contentId).first();
  if (!existing) return notFoundPage();
  const form = await request.formData();
  const parsed = parseContentForm(form);
  if (parsed.error) {
    const allRoles = await getAllRoles(env);
    const row = await env.DB.prepare(
      `SELECT id, title, body, tier, role_tags, event_tag, language, source, is_emergency, version
       FROM content WHERE id = ? LIMIT 1`
    ).bind(contentId).first();
    return contentFormPage(user, allRoles, row, parsed.error, parsed.values);
  }
  // v2.8.3: SAFEGUARD — never silently strip event_tag on update.
  // If the row already had an event_tag (esp. 'safety_flipchart') and the form
  // came back empty, keep the existing tag. This prevents the bug that
  // accidentally moves flip chart codes out of the flip chart view.
  const submittedEventTag = parsed.values.event_tag || '';
  const preservedEventTag = submittedEventTag !== ''
    ? submittedEventTag
    : (existing.event_tag || null);
  await env.DB.prepare(
    `UPDATE content SET title = ?, body = ?, tier = ?, role_tags = ?, event_tag = ?,
         language = ?, source = ?, is_emergency = ?,
         version = version + 1, updated_at = datetime('now'), updated_by = ?
     WHERE id = ?`
  ).bind(parsed.values.title, parsed.values.body, parsed.values.tier,
    JSON.stringify(parsed.values.role_tags), preservedEventTag,
    parsed.values.language || 'en', parsed.values.source || null,
    parsed.values.is_emergency ? 1 : 0, user.id, contentId).run();
  await audit(env, user.id, 'content_updated', { content_id: contentId, title: parsed.values.title });
  return Response.redirect(new URL('/content', request.url).toString(), 302);
}

// ═════════════════════════════════════════════════════════════
// HELPERS
// ═════════════════════════════════════════════════════════════

function userCanSeeContent(user, row) {
  if (user.is_global_admin) return true;
  let tags = [];
  try { tags = JSON.parse(row.role_tags || '[]'); } catch { tags = []; }
  if (!Array.isArray(tags) || tags.length === 0) return false;
  return tags.some(t => user.roles.includes(t));
}

function canBroadcast(user) {
  if (!user) return false;
  if (user.is_global_admin) return true;
  if (!Array.isArray(user.roles)) return false;
  return user.roles.includes('safety') || user.roles.includes('safety_consultant') || user.roles.includes('staff') || user.roles.includes('elders');
}

function canSeeReports(user) {
  if (!user) return false;
  if (user.is_global_admin) return true;
  if (!Array.isArray(user.roles)) return false;
  return user.roles.includes('safety') || user.roles.includes('safety_consultant') || user.roles.includes('staff');
}

function canSeeWatchList(user) {
  if (!user) return false;
  if (user.is_global_admin) return true;
  if (!Array.isArray(user.roles)) return false;
  return user.roles.some(r => ['safety', 'safety_consultant', 'staff', 'greeters'].includes(r));
}

function canPostWatchList(user) {
  if (!user) return false;
  if (user.is_global_admin) return true;
  if (!Array.isArray(user.roles)) return false;
  return user.roles.includes('safety');
}

async function getAllRoles(env) {
  const res = await env.DB.prepare('SELECT id, display_name FROM roles ORDER BY id').all();
  return res.results || [];
}

function parseContentForm(form) {
  const title = (form.get('title') || '').toString().trim();
  const body = (form.get('body') || '').toString().trim();
  const tierRaw = (form.get('tier') || '3').toString();
  const tier = parseInt(tierRaw, 10);
  const event_tag = (form.get('event_tag') || '').toString().trim();
  const language = (form.get('language') || 'en').toString().trim();
  const source = (form.get('source') || '').toString().trim();
  const is_emergency = form.get('is_emergency') === 'on' || form.get('is_emergency') === '1';
  const role_tags = form.getAll('role_tags').map(v => v.toString());
  const values = { title, body, tier, event_tag, language, source, is_emergency, role_tags };
  if (!title) return { error: 'Title is required.', values };
  if (!body) return { error: 'Body is required.', values };
  if (isNaN(tier) || tier < 1 || tier > 5) return { error: 'Tier must be 1–5.', values };
  if (role_tags.length === 0) return { error: 'Pick at least one role tag.', values };
  if (language !== 'en' && language !== 'es') return { error: 'Language must be en or es.', values };
  return { values };
}

async function createSessionToken(userId, env) {
  const payload = { user_id: userId, exp: Math.floor(Date.now() / 1000) + SESSION_EXPIRY_SECONDS };
  const payloadB64 = btoa(JSON.stringify(payload));
  const sig = await hmac(env.SESSION_SECRET, payloadB64);
  return `${payloadB64}.${sig}`;
}

async function verifySessionToken(token, env) {
  if (!token || !token.includes('.')) return null;
  const [payloadB64, sig] = token.split('.');
  const expectedSig = await hmac(env.SESSION_SECRET, payloadB64);
  if (sig !== expectedSig) return null;
  try {
    const payload = JSON.parse(atob(payloadB64));
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function sessionCookie(token) {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_EXPIRY_SECONDS}`;
}

async function getUserFromRequest(request, env) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (!match) return null;
  const payload = await verifySessionToken(match[1], env);
  if (!payload) return null;
  const user = await env.DB.prepare(
    'SELECT id, email, display_name, is_global_admin FROM users WHERE id = ? LIMIT 1'
  ).bind(payload.user_id).first();
  if (!user) return null;
  const roles = await env.DB.prepare('SELECT role_id FROM user_roles WHERE user_id = ?').bind(user.id).all();
  user.roles = (roles.results || []).map(r => r.role_id);
  return user;
}

async function sendMagicLinkEmail(env, email, name, loginUrl) {
  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h2 style="color: #1a1a1a;">TabReady Login</h2>
      <p>Hi ${escapeHtml(name || '')},</p>
      <p>Click the button below to sign in to TabReady. This link is good for 7 days.</p>
      <p style="margin: 32px 0;">
        <a href="${loginUrl}" style="background: #2563eb; color: white; padding: 14px 28px;
           text-decoration: none; border-radius: 6px; font-weight: 600;">Sign in to TabReady</a>
      </p>
      <p style="color: #666; font-size: 14px;">Or paste this link into your browser:<br>
        <span style="word-break: break-all;">${loginUrl}</span></p>
      <p style="color: #999; font-size: 12px; margin-top: 32px;">If you didn't request this, you can ignore this email.</p>
    </div>`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: RESEND_FROM_ADDRESS, to: email, subject: 'Your TabReady login link', html })
  });
  if (!res.ok) {
    const err = await res.text();
    console.error('Resend failed:', err);
    throw new Error('email_send_failed: ' + err.substring(0, 200));
  }
}

async function sendIncidentEmail(env, incident) {
  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
      <div style="background: #fdecea; border-left: 4px solid #c0392b; padding: 14px 18px; margin-bottom: 24px;">
        <h2 style="color: #8a1f12; margin: 0 0 4px; font-size: 18px;">TabReady — Incident Report Filed</h2>
        <p style="color: #6d3d31; margin: 0; font-size: 13px;">For situational awareness. Do not approach. Direct concerns to safety team.</p>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:14px;color:#1a1a1a;">
        <tr><td style="padding:6px 0;color:#6b7280;width:120px;">Filed by:</td><td style="padding:6px 0;"><strong>${escapeHtml(incident.reporter_name)}</strong></td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Reporter email:</td><td style="padding:6px 0;">${escapeHtml(incident.reporter_email || '')}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Location:</td><td style="padding:6px 0;">${escapeHtml(incident.location || '(not specified)')}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Filed at:</td><td style="padding:6px 0;">${escapeHtml(incident.created_at)}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Report ID:</td><td style="padding:6px 0;font-family:monospace;font-size:12px;">${escapeHtml(incident.id)}</td></tr>
      </table>
      <div style="margin-top: 20px; padding: 16px; background: #f7f6f2; border: 1px solid #e5e3dd; border-radius: 8px;">
        <div style="font-size: 12px; color: #6d3d31; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; font-weight: 600;">Summary</div>
        <div style="font-size: 14px; line-height: 1.6; color: #1a1a1a; white-space: pre-wrap;">${escapeHtml(incident.summary)}</div>
      </div>
      <p style="margin-top: 24px; color: #6b7280; font-size: 12px;">This is an automated notification from TabReady. The full report is logged in the Reports tab. For emergencies, call 911 directly. Software does not dial 911.</p>
      <p style="color: #999; font-size: 11px; margin-top: 16px;">The Tabernacle Church · 4141 DeSoto Rd, Sarasota, FL</p>
    </div>`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: RESEND_FROM_ADDRESS, to: INCIDENT_REPORT_RECIPIENTS,
      subject: `[TabReady] Incident Report — ${incident.location || 'no location'}`, html
    })
  });
  if (!res.ok) {
    const err = await res.text();
    console.error('Resend incident email failed:', err);
    throw new Error('email_send_failed: ' + err.substring(0, 200));
  }
}

async function audit(env, actorId, action, details) {
  try {
    const id = crypto.randomUUID();
    const target = details && (details.alert_id || details.content_id || details.target || null);
    await env.DB.prepare(
      'INSERT INTO audit_log (id, actor_user_id, action, target, metadata) VALUES (?, ?, ?, ?, ?)'
    ).bind(id, actorId, action, target, JSON.stringify(details || {})).run();
  } catch (err) {
    console.error('Audit log failed:', err);
  }
}

async function auditV2(env, actorId, action, targetKind, targetId, metadata) {
  try {
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO audit_log_v2 (id, actor_user_id, action, target_kind, target_id, metadata)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(id, actorId, action, targetKind || null, targetId || null, JSON.stringify(metadata || {})).run();
  } catch (err) {
    console.error('Audit log v2 failed:', err);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// ═════════════════════════════════════════════════════════════
// v2.6 — PHOTO STORAGE (R2)
// ═════════════════════════════════════════════════════════════

async function uploadPhotoToR2(env, file, folder, recordId) {
  if (!env.PHOTOS) {
    return { ok: false, error: 'r2_not_configured' };
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return { ok: false, error: 'photo_too_large_max_5mb' };
  }
  const contentType = file.type || 'image/jpeg';
  // Only accept common image types
  if (!/^image\/(jpeg|jpg|png|webp|heic|heif)$/i.test(contentType)) {
    return { ok: false, error: 'invalid_image_type' };
  }

  // Build the R2 key: folder/recordId-timestamp.ext
  let ext = 'jpg';
  if (/png/i.test(contentType)) ext = 'png';
  else if (/webp/i.test(contentType)) ext = 'webp';
  else if (/heic|heif/i.test(contentType)) ext = 'heic';

  const ts = Date.now();
  const key = `${folder}/${recordId}-${ts}.${ext}`;

  try {
    const arrayBuffer = await file.arrayBuffer();
    await env.PHOTOS.put(key, arrayBuffer, {
      httpMetadata: { contentType: contentType },
      customMetadata: {
        folder: folder,
        record_id: recordId,
        uploaded_at: new Date().toISOString()
      }
    });
    return { ok: true, key };
  } catch (err) {
    console.error('R2 upload failed:', err);
    return { ok: false, error: 'r2_upload_failed' };
  }
}

async function handlePhotoServe(request, env, key) {
  const user = await getUserFromRequest(request, env);
  if (!user) return new Response('Unauthorized', { status: 401 });

  if (!env.PHOTOS) return new Response('Photo storage not configured', { status: 503 });

  // Permission check by folder prefix:
  // - incident/ : safety, staff, global admin (same as reports)
  // - watch_situational/ or watch_standing/ : safety, staff, greeters, global admin
  // - team_note/ : any authenticated user (same as notes)
  const folder = key.split('/')[0];
  let allowed = false;
  if (folder === 'incident') {
    allowed = canSeeReports(user);
  } else if (folder === 'watch_situational' || folder === 'watch_standing') {
    allowed = canSeeWatchList(user);
  } else if (folder === 'team_note') {
    allowed = true;
  }
  if (!allowed) return new Response('Forbidden', { status: 403 });

  try {
    const obj = await env.PHOTOS.get(key);
    if (!obj) return new Response('Not found', { status: 404 });
    return new Response(obj.body, {
      headers: {
        'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg',
        'Cache-Control': 'private, max-age=3600'
      }
    });
  } catch (err) {
    console.error('Photo serve failed:', err);
    return new Response('Server error', { status: 500 });
  }
}

// ═════════════════════════════════════════════════════════════
// v2.6 — MY TEAM (PCO People integration)
// ═════════════════════════════════════════════════════════════

async function apiMyTeam(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return json({ error: 'not_authenticated' }, 401);

  if (!env.PCO_APP_ID || !env.PCO_SECRET) {
    return json({
      members: [],
      birthdays_this_month: [],
      note: 'pco_not_configured',
      message: 'PCO credentials not set. Contact admin.'
    });
  }

  // Check if PCO_GROUP_MAP has any entries
  const groupIds = Object.keys(PCO_GROUP_MAP);
  if (groupIds.length === 0) {
    return json({
      members: [],
      birthdays_this_month: [],
      note: 'pco_groups_not_mapped',
      message: 'PCO groups not mapped to TabReady roles yet. Admin needs to edit PCO_GROUP_MAP in the worker code.'
    });
  }

  // Determine which PCO groups this user should see
  // Admins see all groups; others see groups mapped to their roles
  let visibleGroupIds;
  if (user.is_global_admin) {
    visibleGroupIds = groupIds;
  } else {
    visibleGroupIds = groupIds.filter(gid => {
      const role = PCO_GROUP_MAP[gid];
      return user.roles && user.roles.includes(role);
    });
  }

  if (visibleGroupIds.length === 0) {
    return json({
      members: [],
      birthdays_this_month: [],
      note: 'no_visible_groups',
      message: "You're not in any teams that have PCO groups mapped yet."
    });
  }

  const creds = btoa(env.PCO_APP_ID + ':' + env.PCO_SECRET);
  const allMembers = [];
  const seenPersonIds = new Set();
  let pcoError = null;

  for (const groupId of visibleGroupIds) {
    try {
      // Get group memberships, including the related Person record
      const res = await fetch(
        `https://api.planningcenteronline.com/groups/v2/groups/${groupId}/memberships?include=person&per_page=100`,
        { headers: { 'Authorization': 'Basic ' + creds } }
      );
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          pcoError = 'pco_permissions_missing';
          break;
        }
        continue;
      }
      const data = await res.json();
      const included = data.included || [];
      const persons = included.filter(i => i.type === 'Person');
      const role = PCO_GROUP_MAP[groupId];

      for (const p of persons) {
        if (seenPersonIds.has(p.id)) continue;
        seenPersonIds.add(p.id);
        const attr = p.attributes || {};
        const birthday = attr.birthdate || null;
        allMembers.push({
          id: p.id,
          name: attr.name || ([attr.first_name, attr.last_name].filter(Boolean).join(' ')) || 'Unnamed',
          first_name: attr.first_name || '',
          last_name: attr.last_name || '',
          birthday: birthday,
          avatar_url: attr.avatar || null,
          role: role,
          // contact info comes from a second call per person — see below
          phone: null,
          email: null
        });
      }
    } catch (err) {
      console.error('PCO group fetch failed:', err);
      pcoError = 'pco_request_failed';
    }
  }

  if (pcoError === 'pco_permissions_missing') {
    return json({
      members: [],
      birthdays_this_month: [],
      note: pcoError,
      message: 'Your PCO app needs People + Groups permissions. Update in PCO settings.'
    });
  }

  // Fetch contact info for each member (in parallel, batched)
  // PCO People emails and phone numbers are separate endpoints
  await Promise.all(allMembers.map(async m => {
    try {
      const [emailRes, phoneRes] = await Promise.all([
        fetch(`https://api.planningcenteronline.com/people/v2/people/${m.id}/emails`,
          { headers: { 'Authorization': 'Basic ' + creds } }),
        fetch(`https://api.planningcenteronline.com/people/v2/people/${m.id}/phone_numbers`,
          { headers: { 'Authorization': 'Basic ' + creds } })
      ]);
      if (emailRes.ok) {
        const ed = await emailRes.json();
        const primary = (ed.data || []).find(e => e.attributes?.primary) || (ed.data || [])[0];
        m.email = primary?.attributes?.address || null;
      }
      if (phoneRes.ok) {
        const pd = await phoneRes.json();
        const primary = (pd.data || []).find(p => p.attributes?.primary) || (pd.data || [])[0];
        m.phone = primary?.attributes?.number || null;
      }
    } catch (err) {
      // Silent fail per member — just no contact info
    }
  }));

  // Compute this-month birthdays
  const now = new Date();
  const thisMonth = now.getMonth() + 1; // 1-12
  const birthdaysThisMonth = allMembers
    .filter(m => {
      if (!m.birthday) return false;
      // birthday format: "YYYY-MM-DD"
      const parts = m.birthday.split('-');
      if (parts.length < 2) return false;
      return parseInt(parts[1], 10) === thisMonth;
    })
    .map(m => {
      const parts = m.birthday.split('-');
      return {
        id: m.id,
        name: m.name,
        day: parseInt(parts[2], 10),
        month: parseInt(parts[1], 10),
        role: m.role
      };
    })
    .sort((a, b) => a.day - b.day);

  // Sort all members alphabetically by last name
  allMembers.sort((a, b) => {
    const al = (a.last_name || a.name).toLowerCase();
    const bl = (b.last_name || b.name).toLowerCase();
    return al.localeCompare(bl);
  });

  return json({
    members: allMembers,
    birthdays_this_month: birthdaysThisMonth,
    note: 'ok'
  });
}

// ═════════════════════════════════════════════════════════════
// v2.8 — SOFT DELETE + RESOLVE + AI CLEANUP
// ═════════════════════════════════════════════════════════════

// Helper: can this user delete a row (author or global admin)?
function canDeleteOwn(user, authorId) {
  if (!user) return false;
  if (user.is_global_admin) return true;
  return user.id === authorId;
}

// ── REPORTS — soft delete ──
async function apiReportDelete(request, env, reportId) {
  const user = await getUserFromRequest(request, env);
  if (!user) return json({ error: 'not_authenticated' }, 401);
  try {
    const row = await env.DB.prepare(
      `SELECT id, reporter_user_id, deleted_at FROM incident_reports WHERE id = ? LIMIT 1`
    ).bind(reportId).first();
    if (!row) return json({ error: 'not_found' }, 404);
    if (row.deleted_at) return json({ error: 'already_deleted' }, 409);
    if (!canDeleteOwn(user, row.reporter_user_id)) return json({ error: 'forbidden' }, 403);
    await env.DB.prepare(
      `UPDATE incident_reports SET deleted_at = datetime('now'), deleted_by = ? WHERE id = ?`
    ).bind(user.id, reportId).run();
    await auditV2(env, user.id, 'report_soft_deleted', 'incident_report', reportId, {
      is_admin: !!user.is_global_admin,
      is_author: user.id === row.reporter_user_id
    });
    return json({ ok: true });
  } catch (err) {
    console.error('Report delete failed:', err);
    return json({ error: 'delete_failed' }, 500);
  }
}

// ── REPORTS — mark resolved ──
async function apiReportResolve(request, env, reportId) {
  const user = await getUserFromRequest(request, env);
  if (!user) return json({ error: 'not_authenticated' }, 401);
  if (!canSeeReports(user)) return json({ error: 'forbidden' }, 403);
  const body = await request.json().catch(() => ({}));
  const note = (body.note || '').toString().trim() || null;
  try {
    const row = await env.DB.prepare(
      `SELECT id, resolved_at FROM incident_reports WHERE id = ? AND deleted_at IS NULL LIMIT 1`
    ).bind(reportId).first();
    if (!row) return json({ error: 'not_found' }, 404);
    if (row.resolved_at) return json({ error: 'already_resolved' }, 409);
    await env.DB.prepare(
      `UPDATE incident_reports
       SET resolved_at = datetime('now'), resolved_by = ?, resolution_note = ?
       WHERE id = ?`
    ).bind(user.id, note, reportId).run();
    await auditV2(env, user.id, 'report_resolved', 'incident_report', reportId, {
      has_note: !!note
    });
    return json({ ok: true });
  } catch (err) {
    console.error('Report resolve failed:', err);
    return json({ error: 'resolve_failed' }, 500);
  }
}

// ── NOTES — soft delete ──
async function apiNoteDelete(request, env, noteId) {
  const user = await getUserFromRequest(request, env);
  if (!user) return json({ error: 'not_authenticated' }, 401);
  try {
    const row = await env.DB.prepare(
      `SELECT id, author_user_id, deleted_at FROM team_notes WHERE id = ? LIMIT 1`
    ).bind(noteId).first();
    if (!row) return json({ error: 'not_found' }, 404);
    if (row.deleted_at) return json({ error: 'already_deleted' }, 409);
    if (!canDeleteOwn(user, row.author_user_id)) return json({ error: 'forbidden' }, 403);
    await env.DB.prepare(
      `UPDATE team_notes SET deleted_at = datetime('now'), deleted_by = ? WHERE id = ?`
    ).bind(user.id, noteId).run();
    await auditV2(env, user.id, 'note_soft_deleted', 'team_note', noteId, {
      is_admin: !!user.is_global_admin,
      is_author: user.id === row.author_user_id
    });
    return json({ ok: true });
  } catch (err) {
    console.error('Note delete failed:', err);
    return json({ error: 'delete_failed' }, 500);
  }
}

// ── WATCH LIST — soft delete ──
async function apiWatchListDelete(request, env, entryId) {
  const user = await getUserFromRequest(request, env);
  if (!user) return json({ error: 'not_authenticated' }, 401);
  try {
    const row = await env.DB.prepare(
      `SELECT id, author_user_id, deleted_at FROM watch_list_entries WHERE id = ? LIMIT 1`
    ).bind(entryId).first();
    if (!row) return json({ error: 'not_found' }, 404);
    if (row.deleted_at) return json({ error: 'already_deleted' }, 409);
    if (!canDeleteOwn(user, row.author_user_id)) return json({ error: 'forbidden' }, 403);
    await env.DB.prepare(
      `UPDATE watch_list_entries SET deleted_at = datetime('now'), deleted_by = ? WHERE id = ?`
    ).bind(user.id, entryId).run();
    await auditV2(env, user.id, 'watch_list_soft_deleted', 'watch_list_entry', entryId, {
      is_admin: !!user.is_global_admin,
      is_author: user.id === row.author_user_id
    });
    return json({ ok: true });
  } catch (err) {
    console.error('Watch list delete failed:', err);
    return json({ error: 'delete_failed' }, 500);
  }
}

// ── CONTENT — soft delete (admin only) ──
async function apiContentDelete(request, env, contentId) {
  const user = await getUserFromRequest(request, env);
  if (!user) return json({ error: 'not_authenticated' }, 401);
  if (!user.is_global_admin) return json({ error: 'forbidden' }, 403);
  try {
    const row = await env.DB.prepare(
      `SELECT id, title, deleted_at FROM content WHERE id = ? LIMIT 1`
    ).bind(contentId).first();
    if (!row) return json({ error: 'not_found' }, 404);
    if (row.deleted_at) return json({ error: 'already_deleted' }, 409);
    await env.DB.prepare(
      `UPDATE content SET deleted_at = datetime('now'), deleted_by = ? WHERE id = ?`
    ).bind(user.id, contentId).run();
    await audit(env, user.id, 'content_soft_deleted', { content_id: contentId, title: row.title });
    return json({ ok: true });
  } catch (err) {
    console.error('Content delete failed:', err);
    return json({ error: 'delete_failed' }, 500);
  }
}

// ── CONTENT — AI tighten (admin only, returns suggestion, does not save) ──
async function apiContentTighten(request, env, contentId) {
  const user = await getUserFromRequest(request, env);
  if (!user) return json({ error: 'not_authenticated' }, 401);
  if (!user.is_global_admin) return json({ error: 'forbidden' }, 403);
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'ai_not_configured' }, 500);
  try {
    const row = await env.DB.prepare(
      `SELECT id, title, body FROM content WHERE id = ? AND deleted_at IS NULL LIMIT 1`
    ).bind(contentId).first();
    if (!row) return json({ error: 'not_found' }, 404);

    const systemPrompt = [
      "You are an editor for The Tabernacle Church's volunteer reference content.",
      'Your job: tighten and clarify the given content while keeping its meaning intact.',
      '',
      'RULES:',
      '- Keep it short and scannable. Bullet points over paragraphs where it helps.',
      '- Pastoral-practical tone. Warm, clear, restrained. No hype. No preachiness.',
      '- Use plain words a 14-year-old volunteer would understand.',
      '- Keep all facts, instructions, names, and specifics intact.',
      '- Do not add anything new. Do not invent details.',
      '- Return ONLY the tightened body text. No preamble, no explanation, no markdown headers.',
      '- If the content is already tight and clear, return it nearly unchanged.'
    ].join('\n');

    const userPrompt = `Title: ${row.title}\n\nCurrent body:\n${row.body}\n\nReturn the tightened body text only.`;

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });
    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error('Tighten API error:', aiRes.status, errText);
      return json({ error: 'ai_request_failed', status: aiRes.status }, 502);
    }
    const data = await aiRes.json();
    const suggestion = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    if (!suggestion) return json({ error: 'empty_suggestion' }, 502);

    await audit(env, user.id, 'content_tighten_requested', { content_id: contentId, title: row.title });
    return json({
      ok: true,
      original: row.body,
      suggestion: suggestion,
      title: row.title
    });
  } catch (err) {
    console.error('Content tighten failed:', err);
    return json({ error: 'tighten_failed', message: err.message }, 500);
  }
}

// ── ALERTS — soft delete (author or admin) ──
async function apiAlertDelete(request, env, alertId) {
  const user = await getUserFromRequest(request, env);
  if (!user) return json({ error: 'not_authenticated' }, 401);
  try {
    const row = await env.DB.prepare(
      `SELECT id, reporter_user_id, deleted_at FROM alerts WHERE id = ? LIMIT 1`
    ).bind(alertId).first();
    if (!row) return json({ error: 'not_found' }, 404);
    if (row.deleted_at) return json({ error: 'already_deleted' }, 409);
    if (!canDeleteOwn(user, row.reporter_user_id)) return json({ error: 'forbidden' }, 403);
    await env.DB.prepare(
      `UPDATE alerts SET deleted_at = datetime('now'), deleted_by = ? WHERE id = ?`
    ).bind(user.id, alertId).run();
    await audit(env, user.id, 'alert_soft_deleted', { alert_id: alertId });
    return json({ ok: true });
  } catch (err) {
    console.error('Alert delete failed:', err);
    return json({ error: 'delete_failed' }, 500);
  }
}

// ═════════════════════════════════════════════════════════════
// HTML PAGES — v2.5 shared style block
// ALL CAPS via CSS text-transform on .card-title, .tab, buttons, tiles
// Bigger back button. Larger fonts preserved.
// ═════════════════════════════════════════════════════════════

function sharedStyleBlock() {
  return `
    :root {
      --bg: #f7f6f2; --card: #ffffff; --border: #e5e3dd;
      --text: #402020; --muted: #6d3d31; --accent: #6d3d31;
      --accent-light: #f3ede4; --accent-text: #402020;
      --header-bg: #aac27f; --header-text: #ffffff;
      --red: #c0392b; --green: #2d8659; --yellow: #d97706;
      --alert-bg: #fdecea; --alert-text: #8a1f12;
    }
    body.dark {
      --bg: #181412; --card: #241c1a; --border: #3a2d29;
      --text: #f0e8e4; --muted: #b89c92; --accent: #aac27f;
      --accent-light: #2a2420; --accent-text: #d6c9b8;
      --alert-bg: #3f1c14; --alert-text: #fca5a5;
    }
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           background: var(--bg); color: var(--text); margin: 0;
           font-size: 16px; line-height: 1.5;
           padding-bottom: env(safe-area-inset-bottom); }
    .wrap { max-width: 720px; margin: 0 auto; padding: 16px; }
    /* v2.5: bigger back button, always goes home */
    .back { color: var(--accent); text-decoration: none; font-size: 17px;
            font-weight: 700; display: inline-flex; align-items: center;
            gap: 6px; padding: 12px 14px 12px 0;
            margin-bottom: 8px; -webkit-tap-highlight-color: transparent;
            text-transform: uppercase; letter-spacing: 0.4px; }
    .back-arrow { font-size: 22px; line-height: 1; }
    h1 { margin: 8px 0 18px; font-size: 24px; color: var(--text);
         text-transform: uppercase; letter-spacing: 0.5px; }
    .card { background: var(--card); border-radius: 12px; padding: 18px;
            margin-bottom: 12px; border: 1px solid var(--border); }
    .field { margin-bottom: 14px; }
    .field label { display: block; font-size: 13px; font-weight: 700;
                    color: var(--muted); margin-bottom: 6px;
                    text-transform: uppercase; letter-spacing: 0.5px; }
    input[type=text], textarea, select {
      width: 100%; padding: 13px; font-size: 16px; border: 1px solid var(--border);
      border-radius: 8px; box-sizing: border-box; font-family: inherit;
      background: var(--card); color: var(--text);
    }
    textarea { min-height: 120px; resize: vertical; }
    .btn { background: var(--accent); color: #ffffff; border: none;
           padding: 14px 24px; border-radius: 10px; font-size: 15px;
           font-weight: 700; cursor: pointer; text-decoration: none;
           display: inline-block; text-transform: uppercase;
           letter-spacing: 0.5px; }
    .btn-cancel { background: var(--card); color: var(--muted);
                  border: 1px solid var(--border); }
    .actions { display: flex; gap: 10px; margin-top: 16px; flex-wrap: wrap; }
    .err-banner { background: var(--alert-bg); color: var(--alert-text);
                  padding: 12px 14px; border-radius: 8px; margin-bottom: 14px;
                  font-size: 15px; }
    .ok-banner { background: #d1fae5; color: #065f46;
                 padding: 12px 14px; border-radius: 8px; margin-bottom: 14px;
                 font-size: 15px; }
    body.dark .ok-banner { background: #14352a; color: #6ee7b7; }
    .warn-banner { background: #fef3c7; color: #92400e;
                   padding: 12px 14px; border-radius: 8px; margin-bottom: 14px;
                   font-size: 15px; }
    body.dark .warn-banner { background: #3a2d10; color: #fde68a; }
    .muted { color: var(--muted); font-size: 14px; }
    .help { font-size: 13px; color: var(--muted); margin-top: 4px; }
    /* v2.5: Start Here card — universal pattern for empty states */
    .start-here {
      background: linear-gradient(135deg, var(--accent-light) 0%, var(--card) 100%);
      border: 2px dashed var(--accent); border-radius: 12px;
      padding: 18px; margin-bottom: 12px;
    }
    .start-here-label {
      display: inline-block; background: var(--accent); color: #ffffff;
      padding: 4px 10px; border-radius: 6px; font-size: 12px;
      font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;
      margin-bottom: 10px;
    }
    .start-here-title { font-size: 17px; font-weight: 700; color: var(--text);
                        margin-bottom: 6px; }
    .start-here-body { font-size: 15px; line-height: 1.5; color: var(--text); }
    .start-here ul { margin: 10px 0 0; padding-left: 20px; line-height: 1.7; }
  `;
}

function pageShell(title, bodyHtml) {
  // v2.5: native back button always returns to home via history.replaceState
  return new Response(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${title} — TabReady</title>
  <style>${sharedStyleBlock()}</style>
</head>
<body>
  <div class="wrap">${bodyHtml}</div>
  <script>
    // Apply saved theme
    const t = localStorage.getItem('tabready_theme') || 'light';
    if (t === 'dark') document.body.classList.add('dark');
    // v2.5: Native back button → always home
    // Replace history so back goes to home, not previous deep-link
    if (window.location.pathname !== '/') {
      history.replaceState({ home: false }, '', window.location.pathname);
      window.addEventListener('popstate', function() {
        window.location.href = '/';
      });
    }
  </script>
</body>
</html>`, { headers: { 'Content-Type': 'text/html' } });
}

// ─────────────────────────────────────────────
// CAPTURE MENU — v2.5: 2 tiles (Incident + Person)
// Operations Note moved out → Team Notes
// ─────────────────────────────────────────────
function capturePage(user) {
  const body = `
    <a class="back" href="/"><span class="back-arrow">←</span> Back to home</a>
    <h1>What to capture</h1>
    <p class="muted">Pick the type. We'll guide you through it.</p>

    <a href="/capture/incident" style="text-decoration:none">
      <div class="card" style="background:#c0392b;color:#fff;border:none">
        <div style="font-size:32px;line-height:1;margin-bottom:8px">🚨</div>
        <div style="font-size:18px;font-weight:700;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px">Incident Report</div>
        <div style="font-size:14px;opacity:0.92">Something happened. Document it. Safety leadership gets emailed.</div>
      </div>
    </a>

    <a href="/capture/person" style="text-decoration:none">
      <div class="card" style="background:#6d3d31;color:#fff;border:none">
        <div style="font-size:32px;line-height:1;margin-bottom:8px">👤</div>
        <div style="font-size:18px;font-weight:700;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px">Person to Be Aware Of</div>
        <div style="font-size:14px;opacity:0.92">Add to Watch List. Safety team only. Situational (24-hour) or standing (documented basis).</div>
      </div>
    </a>

    <p class="muted" style="margin-top:18px;font-size:13px">
      <strong>Team Notes</strong> (supplies, broken fixtures, messages to leaders) → Notes tab.<br>
      <strong>Notifications</strong> (broadcast a code or all-clear) → Notifications tab.
    </p>
  `;
  return pageShell('Capture', body);
}

// ─────────────────────────────────────────────
// INCIDENT REPORT FORM
// ─────────────────────────────────────────────
function incidentFormPage(user, errorMsg, formValues) {
  const v = formValues || { location: '', summary: '' };
  const errBlock = errorMsg ? `<div class="err-banner">${escapeHtml(errorMsg)}</div>` : '';
  const body = `
    <a class="back" href="/capture"><span class="back-arrow">←</span> Back</a>
    <h1>🚨 Incident Report</h1>
    <p class="muted">Document what happened. You'll see a preview before anything is sent.</p>
    ${errBlock}
    <div class="card">
      <form id="incident-form" method="POST" action="/capture/incident" enctype="multipart/form-data">
        <div class="field">
          <label>Location</label>
          <input type="text" id="f-location" name="location" value="${escapeHtml(v.location)}" placeholder="e.g. Cafe, Sanctuary, FLC gym, Parking lot">
          <div class="help">Where did it happen? Be specific.</div>
        </div>
        <div class="field">
          <label>What happened *</label>
          <textarea id="f-summary" name="summary" required placeholder="Brief, fact-based. Bullet points work great.">${escapeHtml(v.summary)}</textarea>
          <div class="help">Required. Will be sent in the email notification.</div>
        </div>
        <div class="field">
          <label>Photo (optional)</label>
          <input type="file" id="f-photo" name="photo" accept="image/*" capture="environment" style="padding:10px;background:var(--card);border:1px dashed var(--border);width:100%;border-radius:8px;font-size:15px">
          <div class="help">A photo can tell the story. Damage, scene, evidence. Max 5 MB.</div>
        </div>
        <div class="warn-banner" style="font-size:13px">
          <strong>Software does not dial 911.</strong> For emergencies, call 911 directly first. This form is for documentation and team notification only.
        </div>
        <div class="actions">
          <button type="submit" class="btn">Review &amp; Send</button>
          <a href="/capture" class="btn btn-cancel">Cancel</a>
        </div>
      </form>
    </div>

    <!-- v2.8: confirmation modal -->
    <div id="confirm-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;align-items:flex-start;justify-content:center;padding:20px;overflow-y:auto">
      <div style="background:var(--card);color:var(--text);max-width:520px;width:100%;border-radius:14px;padding:20px;margin-top:40px;box-shadow:0 10px 40px rgba(0,0,0,0.3)">
        <h2 style="margin:0 0 8px;font-size:20px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text)">Review before sending</h2>
        <p class="muted" style="margin:0 0 14px;font-size:14px">An email goes to safety leadership when you confirm.</p>
        <div style="background:var(--accent-light);border-radius:10px;padding:14px;margin-bottom:14px">
          <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted);margin-bottom:4px">Location</div>
          <div id="preview-location" style="font-size:15px;margin-bottom:12px">—</div>
          <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted);margin-bottom:4px">What happened</div>
          <div id="preview-summary" style="font-size:15px;line-height:1.5;white-space:pre-wrap">—</div>
          <div id="preview-photo-row" style="margin-top:12px;display:none;font-size:13px;color:var(--muted)">
            <strong style="text-transform:uppercase;letter-spacing:0.5px">Photo:</strong> <span id="preview-photo-name"></span>
          </div>
        </div>
        <div style="background:#fef3c7;color:#92400e;border-radius:8px;padding:10px 12px;font-size:13px;margin-bottom:14px">
          Email recipients: safety leadership (4 addresses on file).
        </div>
        <div class="actions" style="margin-top:0">
          <button type="button" class="btn" id="confirm-send" style="background:#c0392b">Confirm &amp; Send</button>
          <button type="button" class="btn btn-cancel" id="confirm-cancel">Go back and edit</button>
        </div>
      </div>
    </div>

    <script>
      (function() {
        var form = document.getElementById('incident-form');
        var modal = document.getElementById('confirm-modal');
        var btnConfirm = document.getElementById('confirm-send');
        var btnCancel = document.getElementById('confirm-cancel');
        var confirmed = false;
        function esc(s) {
          return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
            return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
          });
        }
        form.addEventListener('submit', function(e) {
          if (confirmed) return;
          e.preventDefault();
          var loc = document.getElementById('f-location').value.trim() || '(not specified)';
          var sum = document.getElementById('f-summary').value.trim();
          if (!sum) { document.getElementById('f-summary').focus(); return; }
          document.getElementById('preview-location').textContent = loc;
          document.getElementById('preview-summary').textContent = sum;
          var photoInput = document.getElementById('f-photo');
          var row = document.getElementById('preview-photo-row');
          if (photoInput.files && photoInput.files[0]) {
            var f = photoInput.files[0];
            var sizeKb = Math.round(f.size / 1024);
            document.getElementById('preview-photo-name').textContent = f.name + ' (' + sizeKb + ' KB)';
            row.style.display = 'block';
          } else {
            row.style.display = 'none';
          }
          modal.style.display = 'flex';
        });
        btnConfirm.addEventListener('click', function() {
          confirmed = true;
          btnConfirm.disabled = true;
          btnConfirm.textContent = 'Sending…';
          form.submit();
        });
        btnCancel.addEventListener('click', function() {
          modal.style.display = 'none';
        });
        modal.addEventListener('click', function(e) {
          if (e.target === modal) modal.style.display = 'none';
        });
      })();
    </script>
  `;
  return pageShell('Incident Report', body);
}

function incidentConfirmPage(user, id, emailSent, emailError, photoError) {
  const emailBlock = emailSent
    ? `<div class="ok-banner">✓ Email sent to safety leadership.</div>`
    : `<div class="err-banner">Email delivery failed. The report was saved, but the team was not auto-notified. Please contact safety directly.<br><br><span style="font-size:11px;font-family:monospace">${escapeHtml(emailError || 'unknown')}</span></div>`;
  const photoBlock = photoError
    ? `<div class="warn-banner">Photo upload failed: ${escapeHtml(photoError)}. The text report saved fine.</div>`
    : '';
  const body = `
    <a class="back" href="/"><span class="back-arrow">←</span> Back to home</a>
    <h1>Report Filed</h1>
    <div class="ok-banner">
      <strong>Incident report filed.</strong><br>
      Report ID: <span style="font-family:monospace;font-size:12px">${escapeHtml(id)}</span>
    </div>
    ${emailBlock}
    ${photoBlock}
    <p class="muted">Your report is in the Reports tab. Audit trail in place.</p>
    <div class="actions">
      <a href="/" class="btn">Back to Home</a>
      <a href="/capture" class="btn btn-cancel">File Another</a>
    </div>
  `;
  return pageShell('Report Filed', body);
}

// ─────────────────────────────────────────────
// v2.5: PERSON / WATCH LIST FORM (UNLOCKED, TEXT-ONLY)
// Photos coming v2.6
// ─────────────────────────────────────────────
function personFormPage(user, errorMsg, formValues) {
  const allowed = user.is_global_admin ||
    (Array.isArray(user.roles) && user.roles.includes('safety'));

  if (!allowed) {
    const body = `
      <a class="back" href="/capture"><span class="back-arrow">←</span> Back</a>
      <h1>👤 Person to Be Aware Of</h1>
      <div class="warn-banner">
        <strong>Posting access required.</strong> Only the Safety team lead can post Watch List entries.
        If you've observed something concerning, file an Incident Report instead — safety will be notified.
      </div>
      <div class="actions">
        <a href="/capture/incident" class="btn">File Incident Report</a>
        <a href="/capture" class="btn btn-cancel">Back</a>
      </div>
    `;
    return pageShell('Watch List', body);
  }

  const v = formValues || { display_name: '', reason: '', basis: '', retention_class: 'situational' };
  const errBlock = errorMsg ? `<div class="err-banner">${escapeHtml(errorMsg)}</div>` : '';
  const sitChecked = v.retention_class === 'situational' ? 'checked' : '';
  const stdChecked = v.retention_class === 'standing' ? 'checked' : '';

  const body = `
    <a class="back" href="/capture"><span class="back-arrow">←</span> Back</a>
    <h1>👤 Add to Watch List</h1>
    <p class="muted">Watch List is for situational awareness only. Standing language applies to every entry.</p>
    ${errBlock}

    <div class="warn-banner">
      <strong>Standing rule on every entry:</strong> Do not approach. Do not engage. For situational awareness only. Direct concerns to safety team lead. App-only; do not share outside TabReady.
    </div>

    <div class="card">
      <form id="person-form" method="POST" action="/capture/person" enctype="multipart/form-data">
        <div class="field">
          <label>Name (optional)</label>
          <input type="text" id="p-name" name="display_name" value="${escapeHtml(v.display_name)}" placeholder="First Last, or 'Unknown male, gray hoodie'">
          <div class="help">Full name if known. Otherwise short description.</div>
        </div>

        <div class="field">
          <label>Why we're watching *</label>
          <textarea id="p-reason" name="reason" required placeholder="Bullet points work best. Observed facts only.">${escapeHtml(v.reason)}</textarea>
          <div class="help">Required. Observed facts only. No speculation, no labels.</div>
        </div>

        <div class="field">
          <label>Photo (optional)</label>
          <input type="file" id="p-photo" name="photo" accept="image/*" capture="environment" style="padding:10px;background:var(--card);border:1px dashed var(--border);width:100%;border-radius:8px;font-size:15px">
          <div class="help">Discreet photo only if safe and reasonable. Max 5 MB.</div>
        </div>

        <div class="field">
          <label>Retention class *</label>
          <div style="display:flex;flex-direction:column;gap:10px;margin-top:6px">
            <label style="display:flex;align-items:flex-start;gap:10px;padding:12px;border:1px solid var(--border);border-radius:8px;cursor:pointer;text-transform:none;letter-spacing:0;font-weight:500">
              <input type="radio" name="retention_class" value="situational" ${sitChecked} style="margin-top:3px">
              <span><strong style="text-transform:uppercase;letter-spacing:0.5px;font-size:13px">Situational</strong><br>
              <span style="font-size:14px;color:var(--muted)">Auto-deletes after 24 hours. For one-time, one-day awareness.</span></span>
            </label>
            <label style="display:flex;align-items:flex-start;gap:10px;padding:12px;border:1px solid var(--border);border-radius:8px;cursor:pointer;text-transform:none;letter-spacing:0;font-weight:500">
              <input type="radio" name="retention_class" value="standing" ${stdChecked} style="margin-top:3px">
              <span><strong style="text-transform:uppercase;letter-spacing:0.5px;font-size:13px">Standing</strong><br>
              <span style="font-size:14px;color:var(--muted)">Stays until removed. Requires documented basis below. Annual review.</span></span>
            </label>
          </div>
        </div>

        <div class="field">
          <label>Documented basis (required for standing)</label>
          <textarea id="p-basis" name="basis" placeholder="e.g. sex offender registry link, restraining order on file with church, formal elder ban dated MM/DD/YYYY">${escapeHtml(v.basis)}</textarea>
          <div class="help">If you pick Standing, you must document the legal/policy basis here.</div>
        </div>

        <div class="warn-banner" style="font-size:13px">
          <strong>Every action is logged.</strong> Posting, viewing, and removing entries are recorded in the audit log for legal defensibility.
        </div>

        <div class="actions">
          <button type="submit" class="btn">Review &amp; Add</button>
          <a href="/capture" class="btn btn-cancel">Cancel</a>
        </div>
      </form>
    </div>

    <!-- v2.8: watch list confirmation modal -->
    <div id="confirm-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;align-items:flex-start;justify-content:center;padding:20px;overflow-y:auto">
      <div style="background:var(--card);color:var(--text);max-width:520px;width:100%;border-radius:14px;padding:20px;margin-top:40px;box-shadow:0 10px 40px rgba(0,0,0,0.3)">
        <h2 style="margin:0 0 8px;font-size:20px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text)">Review before adding</h2>
        <p class="muted" style="margin:0 0 14px;font-size:14px">Watch List entries are visible to safety, staff, greeters, and global admins.</p>
        <div style="background:var(--accent-light);border-radius:10px;padding:14px;margin-bottom:14px">
          <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted);margin-bottom:4px">Name / description</div>
          <div id="prev-name" style="font-size:15px;margin-bottom:12px">—</div>
          <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted);margin-bottom:4px">Why we're watching</div>
          <div id="prev-reason" style="font-size:15px;line-height:1.5;white-space:pre-wrap;margin-bottom:12px">—</div>
          <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted);margin-bottom:4px">Retention</div>
          <div id="prev-retention" style="font-size:15px;margin-bottom:12px">—</div>
          <div id="prev-basis-row" style="display:none">
            <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted);margin-bottom:4px">Documented basis</div>
            <div id="prev-basis" style="font-size:15px;line-height:1.5;white-space:pre-wrap;margin-bottom:12px">—</div>
          </div>
          <div id="prev-photo-row" style="display:none;font-size:13px;color:var(--muted)">
            <strong style="text-transform:uppercase;letter-spacing:0.5px">Photo:</strong> <span id="prev-photo-name"></span>
          </div>
        </div>
        <div class="actions" style="margin-top:0">
          <button type="button" class="btn" id="confirm-add" style="background:#6d3d31">Confirm &amp; Add</button>
          <button type="button" class="btn btn-cancel" id="confirm-cancel">Go back and edit</button>
        </div>
      </div>
    </div>

    <script>
      (function() {
        var form = document.getElementById('person-form');
        var modal = document.getElementById('confirm-modal');
        var btnConfirm = document.getElementById('confirm-add');
        var btnCancel = document.getElementById('confirm-cancel');
        var confirmed = false;
        form.addEventListener('submit', function(e) {
          if (confirmed) return;
          e.preventDefault();
          var name = document.getElementById('p-name').value.trim() || '(no name given)';
          var reason = document.getElementById('p-reason').value.trim();
          if (!reason) { document.getElementById('p-reason').focus(); return; }
          var basis = document.getElementById('p-basis').value.trim();
          var retentionEl = form.querySelector('input[name="retention_class"]:checked');
          var retention = retentionEl ? retentionEl.value : 'situational';
          if (retention === 'standing' && !basis) {
            alert('Standing entries require a documented basis. Please fill in the Documented basis field.');
            document.getElementById('p-basis').focus();
            return;
          }
          document.getElementById('prev-name').textContent = name;
          document.getElementById('prev-reason').textContent = reason;
          document.getElementById('prev-retention').textContent = retention === 'standing'
            ? 'Standing — stays until removed; annual review'
            : 'Situational — auto-deletes in 24 hours';
          if (retention === 'standing') {
            document.getElementById('prev-basis').textContent = basis;
            document.getElementById('prev-basis-row').style.display = 'block';
          } else {
            document.getElementById('prev-basis-row').style.display = 'none';
          }
          var photoInput = document.getElementById('p-photo');
          var prow = document.getElementById('prev-photo-row');
          if (photoInput.files && photoInput.files[0]) {
            var f = photoInput.files[0];
            var sizeKb = Math.round(f.size / 1024);
            document.getElementById('prev-photo-name').textContent = f.name + ' (' + sizeKb + ' KB)';
            prow.style.display = 'block';
          } else {
            prow.style.display = 'none';
          }
          modal.style.display = 'flex';
        });
        btnConfirm.addEventListener('click', function() {
          confirmed = true;
          btnConfirm.disabled = true;
          btnConfirm.textContent = 'Adding…';
          form.submit();
        });
        btnCancel.addEventListener('click', function() {
          modal.style.display = 'none';
        });
        modal.addEventListener('click', function(e) {
          if (e.target === modal) modal.style.display = 'none';
        });
      })();
    </script>
  `;
  return pageShell('Watch List', body);
}

function personConfirmPage(user, id, retentionClass, photoError) {
  const expiryNote = retentionClass === 'situational'
    ? '<div class="ok-banner">Auto-deletes in 24 hours.</div>'
    : '<div class="warn-banner">Standing entry. Annual review required. Documented basis on file.</div>';
  const photoBlock = photoError
    ? `<div class="warn-banner">Photo upload failed: ${escapeHtml(photoError)}. The text entry saved fine.</div>`
    : '';
  const body = `
    <a class="back" href="/"><span class="back-arrow">←</span> Back to home</a>
    <h1>Entry Added</h1>
    <div class="ok-banner">
      <strong>Watch List entry added.</strong><br>
      Entry ID: <span style="font-family:monospace;font-size:12px">${escapeHtml(id)}</span>
    </div>
    ${expiryNote}
    ${photoBlock}
    <p class="muted">Visible to safety, staff, greeters, and global admins. Action logged.</p>
    <div class="actions">
      <a href="/" class="btn">Back to Home</a>
      <a href="/capture/person" class="btn btn-cancel">Add Another</a>
    </div>
  `;
  return pageShell('Entry Added', body);
}

// ─────────────────────────────────────────────
// AUDIT LOG PAGE
// ─────────────────────────────────────────────
function auditLogPage(user) {
  const body = `
    <a class="back" href="/"><span class="back-arrow">←</span> Back to home</a>
    <h1>Audit Log</h1>
    <p class="muted">Every capture action is logged here. Global admin only. Defensible record.</p>
    <div id="audit-list" class="card">
      <div class="muted" style="text-align:center;padding:16px">Loading…</div>
    </div>
    <script>
      (async function loadAudit() {
        try {
          const res = await fetch('/api/audit-log');
          const data = await res.json();
          const items = data.items || [];
          const el = document.getElementById('audit-list');
          if (items.length === 0) {
            el.innerHTML = '<div class="muted" style="text-align:center;padding:16px">No audit entries yet. File a report to see entries appear.</div>';
            return;
          }
          el.innerHTML = items.map(function(a) {
            var meta = '';
            try {
              var m = JSON.parse(a.metadata || '{}');
              meta = Object.keys(m).map(function(k) { return '<strong>' + k + ':</strong> ' + escapeHtml(String(m[k])); }).join(' · ');
            } catch (e) {}
            return '<div style="padding:10px 0;border-bottom:1px solid var(--border);font-size:14px;line-height:1.5">' +
              '<div style="font-weight:700;color:var(--accent-text);text-transform:uppercase;letter-spacing:0.4px">' + escapeHtml(a.action) + '</div>' +
              '<div style="font-size:12px;color:var(--muted);margin-top:2px">' + escapeHtml(a.created_at) + ' · actor: ' + escapeHtml(a.actor_user_id) + (a.target_id ? ' · target: ' + escapeHtml(a.target_id) : '') + '</div>' +
              (meta ? '<div style="font-size:13px;color:var(--text);margin-top:4px">' + meta + '</div>' : '') +
              '</div>';
          }).join('');
        } catch (e) {
          document.getElementById('audit-list').innerHTML = '<div class="err-banner">Could not load audit log.</div>';
        }
      })();
      function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
          return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
        });
      }
    </script>
  `;
  return pageShell('Audit Log', body);
}

// ═════════════════════════════════════════════════════════════
// LOGIN PAGE
// ═════════════════════════════════════════════════════════════
function loginPage() {
  return new Response(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>TabReady Login</title>
  <style>
    body { font-family: -apple-system, sans-serif; background: #f5f5f5; margin: 0; padding: 24px; }
    .box { max-width: 400px; margin: 60px auto; background: white; padding: 32px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
    h1 { margin: 0 0 8px; font-size: 24px; text-transform: uppercase; letter-spacing: 0.5px; }
    p { color: #666; margin: 0 0 24px; }
    input { width: 100%; padding: 14px; font-size: 16px; border: 1px solid #ddd; border-radius: 8px; box-sizing: border-box; margin-bottom: 12px; }
    button { width: 100%; padding: 14px; font-size: 15px; background: #2563eb; color: white; border: none; border-radius: 8px; font-weight: 700; cursor: pointer; text-transform: uppercase; letter-spacing: 0.5px; }
    button:disabled { opacity: 0.6; }
    .msg { margin-top: 16px; padding: 12px; border-radius: 8px; font-size: 14px; }
    .msg.ok { background: #d1fae5; color: #065f46; }
    .msg.err { background: #fee2e2; color: #991b1b; }
  </style>
</head>
<body>
  <div class="box">
    <h1>TabReady</h1>
    <p>Enter your email to get a sign-in link.</p>
    <input type="email" id="email" placeholder="you@example.com" autocomplete="email">
    <button id="btn" onclick="send()">Send sign-in link</button>
    <div id="msg"></div>
  </div>
  <script>
    async function send() {
      const email = document.getElementById('email').value.trim();
      const btn = document.getElementById('btn');
      const msg = document.getElementById('msg');
      msg.className = ''; msg.textContent = '';
      if (!email) { msg.className = 'msg err'; msg.textContent = 'Please enter your email.'; return; }
      btn.disabled = true; btn.textContent = 'Sending...';
      try {
        const res = await fetch('/auth/request', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });
        msg.className = 'msg ok';
        msg.textContent = 'If that email is on file, a sign-in link is on the way. Check your email in a few minutes. If nothing arrives, contact Shane.';
      } catch {
        msg.className = 'msg err';
        msg.textContent = 'Something went wrong. Try again.';
      } finally {
        btn.disabled = false; btn.textContent = 'Send sign-in link';
      }
    }
    document.getElementById('email').addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
  </script>
</body>
</html>`, { headers: { 'Content-Type': 'text/html' } });
}

function forbiddenPage() {
  return new Response(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>TabReady</title>
<style>body{font-family:-apple-system,sans-serif;background:#f5f5f5;padding:60px 24px;text-align:center}.box{max-width:400px;margin:0 auto;background:white;padding:32px;border-radius:12px}a{color:#2563eb}</style>
</head><body><div class="box"><h1>Not allowed</h1><p>You don't have permission.</p><p><a href="/">Home</a></p></div></body></html>`,
{ status: 403, headers: { 'Content-Type': 'text/html' } });
}

function notFoundPage() {
  return new Response(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>TabReady</title>
<style>body{font-family:-apple-system,sans-serif;background:#f5f5f5;padding:60px 24px;text-align:center}.box{max-width:400px;margin:0 auto;background:white;padding:32px;border-radius:12px}a{color:#2563eb}</style>
</head><body><div class="box"><h1>Not found</h1><p><a href="/">Home</a></p></div></body></html>`,
{ status: 404, headers: { 'Content-Type': 'text/html' } });
}

function errorPage(message) {
  return new Response(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>TabReady</title>
<style>body{font-family:-apple-system,sans-serif;background:#f5f5f5;padding:60px 24px;text-align:center}.box{max-width:400px;margin:0 auto;background:white;padding:32px;border-radius:12px}a{color:#2563eb}</style>
</head><body><div class="box"><h1>Sign-in problem</h1><p>${escapeHtml(message)}</p><p><a href="/">Request new link</a></p></div></body></html>`,
{ status: 400, headers: { 'Content-Type': 'text/html' } });
}

// ═════════════════════════════════════════════════════════════
// DASHBOARD — v2.5 main UI
// Changes: back-button-to-home, Codes clustering, Content tile model,
// Team Notes feature, Watch List view, Start Here cards, ALL CAPS
// ═════════════════════════════════════════════════════════════
function dashboardPage(user) {
  const adminBadge = user.is_global_admin
    ? '<span class="badge">Global Admin</span>'
    : '';
  const canBroadcastFlag = canBroadcast(user) ? 'true' : 'false';
  const canSeeCodesFlag = (user.is_global_admin || (Array.isArray(user.roles) && (user.roles.includes('safety') || user.roles.includes('safety_consultant')))) ? 'true' : 'false';
  const canSeeReportsFlag = canSeeReports(user) ? 'true' : 'false';
  const canSeeWatchListFlag = canSeeWatchList(user) ? 'true' : 'false';
  const canPostWatchListFlag = canPostWatchList(user) ? 'true' : 'false';
  const isGlobalAdminFlag = user.is_global_admin ? 'true' : 'false';
  const meUserIdJson = JSON.stringify(user.id || '');

  return new Response(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="theme-color" content="#aac27f">
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="apple-touch-icon" href="/icons/icon-192.png">
  <title>TabReady</title>
  <style>
    :root {
      --bg: #f7f6f2; --card: #ffffff; --border: #e5e3dd;
      --text: #402020; --muted: #6d3d31; --accent: #6d3d31;
      --accent-light: #f3ede4; --accent-text: #402020;
      --header-bg: #aac27f; --header-text: #ffffff;
      --header-border: rgba(255,255,255,0.25);
      --red: #c0392b; --green: #2d8659; --yellow: #d97706;
      --alert-open-bg: #fdecea; --emergency-bg: #fdecea; --emergency-text: #8a1f12;
    }
    body.dark {
      --bg: #181412; --card: #241c1a; --border: #3a2d29;
      --text: #f0e8e4; --muted: #b89c92; --accent: #aac27f;
      --accent-light: #2a2420; --accent-text: #d6c9b8;
      --header-bg: #aac27f; --header-text: #ffffff;
      --header-border: rgba(255,255,255,0.2);
      --alert-open-bg: #3a1814; --emergency-bg: #3f1c14; --emergency-text: #fca5a5;
    }
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           background: var(--bg); color: var(--text); margin: 0;
           font-size: 16px; line-height: 1.5;
           padding-bottom: env(safe-area-inset-bottom);
           transition: background 0.2s, color 0.2s; }
    .app { max-width: 720px; margin: 0 auto; padding: 16px; }

    .header { background: var(--header-bg); color: var(--header-text); padding: 16px;
              border-radius: 14px; margin-bottom: 16px;
              box-shadow: 0 2px 8px rgba(64,32,32,0.08); }
    .header-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; flex-wrap: nowrap; }
    .header-row > div:first-child { flex: 1 1 auto; min-width: 0; overflow: hidden; }
    .header-row > div:first-child .header-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .header-greeting { font-size: 12px; opacity: 0.92; text-transform: uppercase; letter-spacing: 0.8px; font-weight: 700; }
    .header-name { font-size: 22px; font-weight: 700; margin-top: 2px; color: #ffffff; }
    .header-meta { text-align: right; flex: 0 0 auto; min-width: 0; }
    .header-time { font-size: 22px; font-weight: 700; line-height: 1; color: #ffffff; white-space: nowrap; }
    .header-date { font-size: 12px; opacity: 0.92; margin-top: 4px; white-space: nowrap; }
    .header-controls { margin-top: 8px; }
    @media (max-width: 480px) {
      .header { padding: 12px; }
      .header-row { gap: 8px; }
      .header-greeting { font-size: 11px; }
      .header-name { font-size: 16px; }
      .header-time { font-size: 18px; }
      .header-date { font-size: 11px; }
      /* v2.8.4: theme button collapses to icon-only on phones up to 480px
         so the "Dark"/"Light" label can't clip past the header edge. */
      .theme-btn { padding: 6px 8px; }
      #theme-btn-label { display: none; }
      .theme-btn-icon { font-size: 16px; }
    }
    @media (max-width: 360px) {
      /* Extra-narrow phones: hide the date entirely, keep just the time */
      .header-date { display: none; }
      .header-time { font-size: 16px; }
    }
    .header-next { margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--header-border);
                   font-size: 14px; opacity: 0.95; }
    .header-weather { margin-top: 10px; font-size: 14px; opacity: 0.95;
                      display: flex; align-items: center; gap: 8px; }
    .header-weather-icon { font-size: 18px; }
    .badge { background: rgba(255,255,255,0.25); color: #ffffff;
             padding: 3px 9px; border-radius: 6px; font-size: 11px;
             font-weight: 700; margin-left: 8px; vertical-align: middle;
             text-transform: uppercase; letter-spacing: 0.5px; }

    .theme-btn { background: rgba(255,255,255,0.2); color: #ffffff;
                 border: none; border-radius: 8px; padding: 6px 12px;
                 font-size: 12px; font-weight: 700; cursor: pointer;
                 line-height: 1; display: inline-flex; align-items: center;
                 gap: 6px; -webkit-tap-highlight-color: transparent;
                 text-transform: uppercase; letter-spacing: 0.5px; }
    .theme-btn-icon { font-size: 15px; line-height: 1; }
    .header-controls { display: flex; align-items: center; gap: 8px; margin-top: 8px;
                       justify-content: flex-end; }

    /* Tab bar with arrow hints */
    .tabs-wrap { position: relative; margin-bottom: 16px; }
    .tabs { display: flex; border-bottom: 1px solid var(--border);
            background: var(--card); border-radius: 12px 12px 0 0; overflow: hidden;
            overflow-x: auto; -webkit-overflow-scrolling: touch;
            scroll-behavior: smooth;
            -ms-overflow-style: none; scrollbar-width: none; }
    .tabs::-webkit-scrollbar { display: none; }
    /* v2.5: ALL CAPS on tab labels */
    .tab { flex: 0 0 auto; min-width: 72px; text-align: center; padding: 10px 8px;
           font-size: 11px;
           font-weight: 700; cursor: pointer; color: var(--muted);
           border-bottom: 2px solid transparent; -webkit-tap-highlight-color: transparent;
           display: flex; flex-direction: column; align-items: center; gap: 2px;
           line-height: 1.1; text-transform: uppercase; letter-spacing: 0.5px; }
    .tab-icon { font-size: 20px; line-height: 1; }
    .tab.active { color: var(--accent-text); border-bottom-color: var(--accent); }
    .tabs-arrow { position: absolute; top: 0; bottom: 0; width: 32px;
                  display: flex; align-items: center; justify-content: center;
                  color: var(--text); font-size: 22px; font-weight: 700;
                  pointer-events: none; opacity: 0.9;
                  background: linear-gradient(to right, var(--card) 40%, rgba(255,255,255,0) 100%); }
    .tabs-arrow.right { right: 0;
                        background: linear-gradient(to left, var(--card) 40%, rgba(255,255,255,0) 100%); }
    .tab-panel { display: none; }
    .tab-panel.active { display: block; }

    .card { background: var(--card); border-radius: 12px; padding: 16px;
            margin-bottom: 12px; border: 1px solid var(--border); }
    /* v2.5: ALL CAPS on card titles */
    .card-title { font-size: 13px; font-weight: 700; text-transform: uppercase;
                  letter-spacing: 0.7px; color: var(--muted); margin-bottom: 10px; }
    .empty { color: var(--muted); font-size: 15px; text-align: center; padding: 16px; }

    /* v2.5: START HERE card — universal pattern for empty/new features */
    .start-here {
      background: linear-gradient(135deg, var(--accent-light) 0%, var(--card) 100%);
      border: 2px dashed var(--accent); border-radius: 12px;
      padding: 18px; margin-bottom: 12px;
    }
    .start-here-label {
      display: inline-block; background: var(--accent); color: #ffffff;
      padding: 4px 10px; border-radius: 6px; font-size: 11px;
      font-weight: 700; text-transform: uppercase; letter-spacing: 0.7px;
      margin-bottom: 10px;
    }
    .start-here-title { font-size: 17px; font-weight: 700; color: var(--text);
                        margin-bottom: 6px; }
    .start-here-body { font-size: 15px; line-height: 1.5; color: var(--text); }
    .start-here ul { margin: 10px 0 0; padding-left: 20px; line-height: 1.7; }

    .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
    .chip { background: var(--card); color: var(--muted);
            border: 1px solid var(--border); border-radius: 999px;
            padding: 6px 12px; font-size: 13px; font-weight: 700;
            cursor: pointer; -webkit-tap-highlight-color: transparent;
            transition: all 0.15s; text-transform: uppercase; letter-spacing: 0.4px; }
    .chip.active { background: var(--accent); color: #ffffff; border-color: var(--accent); }

    .item { padding: 12px 0; border-bottom: 1px solid var(--border); }
    .item:last-child { border-bottom: none; }
    .item h4 { margin: 0 0 4px; font-size: 16px; color: var(--text);
               text-transform: uppercase; letter-spacing: 0.3px; }
    .item-meta { font-size: 13px; color: var(--muted); margin-bottom: 6px; }
    .item-body { font-size: 15px; line-height: 1.5; color: var(--text); white-space: pre-wrap; }
    .pill { display: inline-block; padding: 2px 8px; border-radius: 10px;
            font-size: 11px; font-weight: 700; margin-right: 4px;
            text-transform: uppercase; letter-spacing: 0.4px; }
    .pill-role { background: var(--accent-light); color: var(--accent-text); font-family: monospace; }
    .pill-event { background: #f3ede4; color: #6d3d31; }
    body.dark .pill-event { background: #2a2420; color: #d6c9b8; }
    .pill-emergency { background: var(--emergency-bg); color: var(--emergency-text); }
    .pill-kind-incident { background: var(--emergency-bg); color: var(--emergency-text); }
    .pill-kind-ops { background: #ffedd5; color: #9a3412; }
    body.dark .pill-kind-ops { background: #3a2410; color: #fdba74; }
    .pill-ok { background: #d1fae5; color: #065f46; }
    body.dark .pill-ok { background: #14352a; color: #6ee7b7; }
    .pill-fail { background: #fee2e2; color: #991b1b; }
    body.dark .pill-fail { background: #3f1c14; color: #fca5a5; }
    .pill-situational { background: #fef3c7; color: #92400e; }
    body.dark .pill-situational { background: #3a2d10; color: #fde68a; }
    .pill-standing { background: #fee2e2; color: #991b1b; }
    body.dark .pill-standing { background: #3f1c14; color: #fca5a5; }

    .alert { padding: 12px; border-radius: 10px; margin-bottom: 8px;
             border: 1px solid var(--border); }
    .alert.open { border-color: var(--red); background: var(--alert-open-bg); }
    .alert.resolved { opacity: 0.6; }
    .alert-code { font-size: 13px; font-weight: 700; color: var(--red);
                  text-transform: uppercase; letter-spacing: 0.5px; }
    .alert-meta { font-size: 13px; color: var(--muted); margin-top: 4px; }

    .ask-input { width: 100%; padding: 14px; border: 1px solid var(--border);
                 border-radius: 10px; font-size: 16px; font-family: inherit;
                 box-sizing: border-box; min-height: 80px; resize: vertical;
                 background: var(--card); color: var(--text); }
    .btn { background: var(--accent); color: #ffffff; border: none;
           padding: 12px 22px; border-radius: 10px; font-size: 14px;
           font-weight: 700; cursor: pointer;
           text-transform: uppercase; letter-spacing: 0.5px; }
    .btn:disabled { opacity: 0.6; }

    /* v2.8.1: phone-friendly tap chips for notification recipients */
    .recip-chip {
      background: var(--card);
      color: var(--text);
      border: 2px solid var(--border);
      border-radius: 999px;
      padding: 10px 16px;
      font-size: 15px;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      min-height: 44px;
      -webkit-tap-highlight-color: transparent;
      transition: background 0.1s, border-color 0.1s, color 0.1s;
    }
    .recip-chip.selected {
      background: var(--accent);
      border-color: var(--accent);
      color: #ffffff;
    }
    .recip-chip:active { transform: scale(0.97); }
    .ask-actions { margin-top: 10px; display: flex; gap: 8px; }
    .ask-answer { margin-top: 12px; padding: 12px; background: var(--accent-light);
                  border-radius: 10px; font-size: 15px; line-height: 1.5;
                  color: var(--text); }

    .ask-history { margin-bottom: 14px; }
    .ask-qa { background: var(--card); border: 1px solid var(--border);
              border-radius: 10px; padding: 12px; margin-bottom: 10px;
              border-left: 4px solid var(--accent); }
    #ask-history .ask-qa:nth-child(odd)  { background: var(--accent-light); }
    #ask-history .ask-qa:nth-child(even) { background: var(--card); }
    .ask-qa-q { font-size: 14px; font-weight: 600; color: var(--accent-text);
                margin-bottom: 6px; }
    .ask-qa-q-label { font-size: 11px; text-transform: uppercase;
                      letter-spacing: 0.5px; color: var(--muted);
                      font-weight: 700; margin-right: 6px; }
    .ask-qa-a { font-size: 15px; line-height: 1.5; color: var(--text);
                white-space: pre-wrap; }
    .ask-qa-a-label { font-size: 11px; text-transform: uppercase;
                      letter-spacing: 0.5px; color: var(--muted);
                      font-weight: 700; margin-right: 6px; }

    /* Home action tiles */
    .home-actions { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
    .home-action { padding: 18px 12px; border-radius: 12px; cursor: pointer;
                   text-align: center; color: #ffffff; font-weight: 700;
                   box-shadow: 0 2px 6px rgba(0,0,0,0.1);
                   -webkit-tap-highlight-color: transparent;
                   transition: transform 0.1s, box-shadow 0.1s;
                   min-height: 92px; border: none;
                   display: flex; flex-direction: column; justify-content: center;
                   font-family: inherit; text-decoration: none;
                   text-transform: uppercase; letter-spacing: 0.5px; }
    .home-action:active { transform: scale(0.97); box-shadow: 0 1px 3px rgba(0,0,0,0.15); }
    .home-action-icon { font-size: 26px; margin-bottom: 4px; line-height: 1; }
    .home-action-name { font-size: 13px; line-height: 1.2; }

    /* Big "+" capture button */
    .capture-btn { display: block; width: 100%; padding: 20px;
                   background: linear-gradient(135deg, #c0392b 0%, #8a1f12 100%);
                   color: #ffffff; border: none; border-radius: 14px;
                   font-size: 15px; font-weight: 700; cursor: pointer;
                   margin-bottom: 12px; box-shadow: 0 4px 12px rgba(192,57,43,0.25);
                   -webkit-tap-highlight-color: transparent;
                   text-decoration: none; text-align: center;
                   display: flex; align-items: center; justify-content: center; gap: 10px;
                   text-transform: uppercase; letter-spacing: 0.5px; }
    .capture-btn:active { transform: scale(0.98); }
    .capture-btn-plus { font-size: 22px; line-height: 1; }

    /* CODES TAB — v2.9.15 filter pills */
    .codes-filter-bar { display: flex; gap: 8px; padding: 4px 0 16px; }
    .codes-filter-pill { flex: 1; padding: 10px 0; border-radius: 20px; border: 2px solid var(--accent);
                         font-size: 14px; font-weight: 700; cursor: pointer; letter-spacing: .04em;
                         background: transparent; color: var(--accent); transition: background .15s, color .15s; }
    .codes-filter-pill.active { background: var(--accent); color: #fff; }
    body.dark .codes-filter-pill { border-color: var(--accent); color: var(--accent); }
    body.dark .codes-filter-pill.active { background: var(--accent); color: #fff; }
    .home-section-title { display: flex; align-items: center; gap: 8px;
                          font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px;
                          color: var(--text); padding: 6px 10px; margin: 0 0 10px;
                          border-left: 4px solid #999; border-radius: 0 4px 4px 0;
                          background: #f3f4f6; }
    body.dark .home-section-title { background: #1a2030; }
    .home-section-icon { font-size: 16px; line-height: 1; }
    .home-ref-list { display: flex; flex-direction: column; gap: 8px; }
    .home-ref-card { background: var(--card-bg,#fff); border: 1px solid var(--border,#e5e7eb);
                     border-radius: 10px; padding: 12px 14px; cursor: pointer;
                     transition: border-color .15s; }
    .home-ref-card.open { border-color: var(--accent); }
    body.dark .home-ref-card { background: var(--card-bg-dark,#1e2530); border-color: var(--border-dark,#374151); }
    body.dark .home-ref-card.open { border-color: var(--accent); }
    .home-ref-title { display: flex; justify-content: space-between; align-items: center;
                      font-size: 14px; font-weight: 600; color: var(--text); gap: 8px; }
    .home-ref-chevron { font-size: 12px; color: var(--accent); flex-shrink: 0; transition: transform .2s; }
    .home-ref-card.open .home-ref-chevron { transform: rotate(90deg); }
    .home-ref-body { font-size: 13px; color: var(--text); margin-top: 10px; line-height: 1.65;
                     white-space: pre-wrap; border-top: 1px solid var(--border,#e5e7eb); padding-top: 10px; }
    body.dark .home-ref-body { border-color: var(--border-dark,#374151); }

    /* CODES TAB */
    .codes-section { margin-bottom: 22px; }
    .codes-section-title { font-size: 15px; font-weight: 800; text-transform: uppercase;
                           letter-spacing: 1.2px; color: var(--accent-text); margin: 0 0 12px;
                           padding: 0 2px 8px;
                           border-bottom: 2px solid var(--accent); }
    .codes-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
    .code-card { padding: 16px 12px; border-radius: 12px; cursor: pointer;
                 text-align: center; color: #ffffff; font-weight: 700;
                 box-shadow: 0 2px 6px rgba(0,0,0,0.1);
                 -webkit-tap-highlight-color: transparent;
                 transition: transform 0.1s, box-shadow 0.1s;
                 min-height: 90px;
                 display: flex; flex-direction: column; justify-content: center;
                 text-transform: uppercase; letter-spacing: 0.4px; }
    .code-card:active { transform: scale(0.97); box-shadow: 0 1px 3px rgba(0,0,0,0.15); }
    .code-card-icon { font-size: 26px; line-height: 1; margin: 4px 0; }
    .code-card-top { font-size: 13px; font-weight: 800; letter-spacing: 0.6px; line-height: 1.1; margin-bottom: 2px; }
    .code-card-name { font-size: 12px; font-weight: 600; line-height: 1.2; opacity: 0.95; }
    .code-card.text-dark { color: #1a1a1a; }

    .code-detail { background: var(--card); border: 1px solid var(--border);
                   border-radius: 12px; padding: 16px; margin-bottom: 12px; display: none; }
    .code-detail.open { display: block; }
    .code-detail-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
    .code-swatch { width: 18px; height: 18px; border-radius: 4px; flex-shrink: 0; }
    .code-detail h3 { margin: 0; font-size: 18px; color: var(--text);
                       text-transform: uppercase; letter-spacing: 0.5px; }
    .code-detail-body { font-size: 15px; line-height: 1.6; color: var(--text); white-space: pre-wrap; }
    /* v2.9.0: tap-to-call / tap-to-email links inside card bodies */
    .tab-link { color: #6d3d31; text-decoration: underline; font-weight: 600; }
    .tab-link:active { color: #402020; }
    /* v2.9.6: Safety Team Directory — bright yellow header + close button */
    /* v2.9.7: per-team color override via inline style on .dir-toggle */
    .dir-card { padding: 0; overflow: hidden; }
    .dir-toggle { width: 100%; background: #FBC02D; color: #402020;
                  border: none; padding: 14px 16px; cursor: pointer;
                  text-align: left;
                  display: flex; align-items: center; justify-content: space-between;
                  font: inherit; }
    .dir-toggle:hover { filter: brightness(1.05); }
    .dir-toggle:active { filter: brightness(0.95); }
    .dir-toggle-label { font-size: 16px; font-weight: 700;
                        text-transform: uppercase; letter-spacing: 0.5px;
                        display: flex; align-items: center; gap: 10px;
                        color: inherit; }
    .dir-toggle-icon { font-size: 18px; line-height: 1; }
    .dir-count { font-size: 13px; font-weight: 600; opacity: 0.85;
                 letter-spacing: 0; text-transform: none; margin-left: 4px; }
    .dir-toggle-arrow { font-size: 14px; opacity: 0.7;
                        transition: transform 0.15s ease; }
    .dir-toggle[aria-expanded="true"] .dir-toggle-arrow { transform: rotate(90deg); }
    .dir-body { padding: 16px; background: var(--card); }
    .dir-close { display: block; width: 100%; margin-top: 16px;
                 padding: 12px; background: #402020; color: #f5ede0;
                 border: none; border-radius: 8px; font-size: 14px;
                 font-weight: 600; text-transform: uppercase;
                 letter-spacing: 0.5px; cursor: pointer; }
    .dir-close:hover { background: #4d2828; }
    .dir-close:active { background: #5a3030; }
    /* v2.9.6: Bold + darker section headers inside card bodies */
    .card-section-header { display: inline-block;
                           font-weight: 800;
                           color: var(--text);
                           letter-spacing: 0.3px; }
    body.dark .card-section-header { color: #ffffff; }
    .dir-grid { display: grid;
                grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
                gap: 8px; margin-top: 4px; }
    .dir-pill { display: block; padding: 10px 12px;
                background: var(--accent-light); color: var(--accent-text);
                border: 1px solid var(--border); border-radius: 999px;
                text-decoration: none; text-align: center; font-size: 13px;
                line-height: 1.3; min-height: 52px;
                display: flex; flex-direction: column; justify-content: center;
                position: relative; }
    .dir-pill:active { background: #ddd; }
    .dir-pill-name { font-weight: 600; color: var(--text);
                     overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dir-pill-phone { font-size: 13px; color: #6d3d31; font-weight: 600;
                      margin-top: 2px; }
    .dir-pill-nophone { font-size: 12px; color: var(--muted); font-style: italic;
                        margin-top: 2px; }
    .dir-pill-lead { background: #aac27f; color: #1a1a1a;
                     border-color: #8fa965; }
    .dir-pill-lead .dir-pill-name::after {
      content: " ★"; color: #402020; }
    .code-detail-close { display: inline-block; margin-top: 12px;
                         padding: 10px 16px; background: var(--accent-light);
                         color: var(--accent-text); border: none; border-radius: 8px;
                         font-size: 13px; font-weight: 700; cursor: pointer;
                         text-transform: uppercase; letter-spacing: 0.5px; }

    .nav-link { display: block; padding: 14px; background: var(--card);
                border: 1px solid var(--border); border-radius: 10px;
                color: var(--accent-text); text-decoration: none; font-weight: 700;
                margin-bottom: 8px; font-size: 14px;
                text-transform: uppercase; letter-spacing: 0.5px; }
    .nav-link:hover { background: var(--accent-light); }

    .logout { background: none; border: none; color: var(--muted);
              font-size: 13px; padding: 8px 0; cursor: pointer; margin-top: 16px;
              text-decoration: underline; text-transform: uppercase;
              letter-spacing: 0.5px; font-weight: 700; }

    /* Role boxes (Content tab drilldown) */
    .role-boxes { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
    .role-box { padding: 18px 12px; border-radius: 12px; cursor: pointer;
                text-align: center; color: #ffffff; font-weight: 700;
                box-shadow: 0 2px 6px rgba(0,0,0,0.1);
                -webkit-tap-highlight-color: transparent;
                transition: transform 0.1s, box-shadow 0.1s;
                min-height: 96px; border: none;
                display: flex; flex-direction: column; justify-content: center;
                gap: 4px; font-family: inherit;
                text-transform: uppercase; letter-spacing: 0.4px; }
    .role-box:active { transform: scale(0.97); box-shadow: 0 1px 3px rgba(0,0,0,0.15); }
    .role-box-icon { font-size: 24px; line-height: 1; margin-bottom: 2px; }
    .role-box-name { font-size: 13px; line-height: 1.2; }
    .role-box-count { font-size: 10px; font-weight: 600; opacity: 0.88;
                      margin-top: 2px; text-transform: uppercase; letter-spacing: 0.4px; }
    .role-box.text-dark { color: #1a1a1a; }

    /* v2.5: Content tile grid (inside a role) — same 6-second model as Codes */
    .content-tiles { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
    .content-tile { padding: 16px 12px; border-radius: 12px; cursor: pointer;
                    background: var(--card); border: 1px solid var(--border);
                    color: var(--text); font-weight: 700;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.05);
                    -webkit-tap-highlight-color: transparent;
                    min-height: 80px;
                    display: flex; flex-direction: column; justify-content: center;
                    text-align: center; gap: 4px; }
    .content-tile:active { transform: scale(0.97); }
    .content-tile-icon { font-size: 22px; line-height: 1; margin-bottom: 4px; }
    .content-tile-name { font-size: 14px; line-height: 1.3;
                         text-transform: uppercase; letter-spacing: 0.3px; }
    .content-tile-emergency { background: var(--emergency-bg);
                              border-color: var(--red); color: var(--emergency-text); }
    .back-inline { color: var(--accent); text-decoration: none; font-size: 14px;
                   font-weight: 700; display: inline-flex; align-items: center;
                   gap: 6px; padding: 10px 14px 10px 0;
                   margin-bottom: 8px; -webkit-tap-highlight-color: transparent;
                   cursor: pointer; text-transform: uppercase; letter-spacing: 0.4px; }
    .back-inline-arrow { font-size: 20px; line-height: 1; }

    /* v2.5: Team Notes feature */
    .notes-list-item { background: var(--card); border: 1px solid var(--border);
                       border-radius: 10px; padding: 14px; margin-bottom: 10px; }
    .notes-list-item-meta { font-size: 12px; color: var(--muted);
                            text-transform: uppercase; letter-spacing: 0.4px;
                            font-weight: 700; margin-bottom: 6px; }
    .notes-list-item-body { font-size: 15px; line-height: 1.5; color: var(--text);
                            white-space: pre-wrap; }
    .notes-form { background: var(--card); border: 1px solid var(--border);
                  border-radius: 10px; padding: 14px; margin-bottom: 14px; }
    .notes-form textarea { width: 100%; padding: 12px; font-size: 16px;
                           border: 1px solid var(--border); border-radius: 8px;
                           box-sizing: border-box; font-family: inherit;
                           background: var(--card); color: var(--text);
                           min-height: 80px; resize: vertical; }
    .notes-form select { width: 100%; padding: 12px; font-size: 15px;
                         border: 1px solid var(--border); border-radius: 8px;
                         box-sizing: border-box; background: var(--card);
                         color: var(--text); margin-top: 8px; }

    /* v2.5: Watch List view */
    .wl-entry { background: var(--card); border: 1px solid var(--border);
                border-radius: 10px; padding: 14px; margin-bottom: 10px; }
    .wl-entry-name { font-size: 16px; font-weight: 700; color: var(--text);
                     margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.3px; }
    .wl-entry-meta { font-size: 12px; color: var(--muted); margin-bottom: 8px; }
    .wl-entry-reason { font-size: 14px; line-height: 1.5; color: var(--text);
                       white-space: pre-wrap; }
    .wl-standing { background: var(--alert-open-bg); color: var(--emergency-text);
                   padding: 10px 12px; border-radius: 8px; font-size: 12px;
                   margin-bottom: 14px; font-weight: 700;
                   text-transform: uppercase; letter-spacing: 0.4px; }

    /* v2.8: row action buttons (Delete / Resolve on Reports, Notes, Watch List, Notifications) */
    .row-actions { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap;
                   padding-top: 10px; border-top: 1px dashed var(--border); }
    .row-btn { padding: 7px 12px; border-radius: 7px; font-size: 12px;
               font-weight: 700; cursor: pointer; border: none;
               text-transform: uppercase; letter-spacing: 0.4px;
               -webkit-tap-highlight-color: transparent; font-family: inherit; }
    .row-btn-delete { background: var(--alert-open-bg); color: var(--emergency-text);
                      border: 1px solid var(--border); }
    .row-btn-resolve { background: #d1fae5; color: #065f46;
                       border: 1px solid #a7f3d0; }
    body.dark .row-btn-resolve { background: #14352a; color: #6ee7b7; border-color: #1a4a37; }
    .row-btn:active { transform: scale(0.97); }

    /* v2.8: Content tab search bar */
    .content-search-row { margin-bottom: 12px; }
    .content-search-input { width: 100%; padding: 12px 14px; font-size: 16px;
                            border: 1px solid var(--border); border-radius: 10px;
                            background: var(--card); color: var(--text);
                            font-family: inherit; box-sizing: border-box; }

    /* v2.8: Tighten modal */
    .v28-modal { display: none; position: fixed; inset: 0;
                 background: rgba(0,0,0,0.55); z-index: 9999;
                 align-items: flex-start; justify-content: center;
                 padding: 20px; overflow-y: auto; }
    .v28-modal.open { display: flex; }
    .v28-modal-box { background: var(--card); color: var(--text);
                     max-width: 720px; width: 100%; border-radius: 14px;
                     padding: 20px; margin-top: 20px;
                     box-shadow: 0 10px 40px rgba(0,0,0,0.3); }
    .v28-modal h2 { margin: 0 0 12px; font-size: 20px;
                    text-transform: uppercase; letter-spacing: 0.5px; }
    .v28-diff-col { background: var(--accent-light); border-radius: 10px;
                    padding: 14px; margin-bottom: 12px;
                    font-size: 14px; line-height: 1.5; white-space: pre-wrap;
                    max-height: 280px; overflow-y: auto; }
    .v28-diff-label { font-size: 11px; font-weight: 700;
                      text-transform: uppercase; letter-spacing: 0.5px;
                      color: var(--muted); margin-bottom: 6px; }
  </style>
</head>
<body>
<div class="app">

  <div class="header">
    <div class="header-row">
      <div style="display:flex;align-items:center;gap:12px;flex-shrink:0;min-width:0">
        <div style="width:44px;height:44px;border-radius:10px;flex-shrink:0;background:#fff;box-sizing:border-box;display:flex;align-items:center;justify-content:center;border:1px solid rgba(64,32,32,0.1)">
          <span style="font-size:18px;font-weight:800;color:#402020;letter-spacing:-0.5px;font-family:system-ui,-apple-system,sans-serif;line-height:1">TR</span>
        </div>
        <div style="min-width:0">
          <div class="header-greeting">TabReady</div>
          <div class="header-name">${escapeHtml(user.display_name || user.email)} ${adminBadge}</div>
        </div>
      </div>
      <div class="header-meta">
        <div class="header-time" id="header-time">--:--</div>
        <div class="header-date" id="header-date">Loading…</div>
        <div class="header-controls">
          <button class="theme-btn" id="theme-btn" onclick="toggleTheme()" title="Toggle theme">
            <span class="theme-btn-icon" id="theme-btn-icon">🌙</span>
            <span id="theme-btn-label">Dark</span>
          </button>
        </div>
      </div>
    </div>
    <div class="header-weather" id="header-weather" style="display:none">
      <span class="header-weather-icon" id="weather-icon">🌡️</span>
      <span id="weather-text">Loading weather…</span>
    </div>
    <div class="header-next" id="header-next" style="display:none"></div>
  </div>

  <div class="tabs-wrap">
    <div class="tabs" id="tabs-bar">
      <div class="tab active" data-tab="home" onclick="showTab('home')">
        <span class="tab-icon">🏠</span><span>Home</span>
      </div>
      <div class="tab" data-tab="notes" onclick="showTab('notes')">
        <span class="tab-icon">📝</span><span>Notes</span>
      </div>
      <div class="tab" data-tab="team" onclick="showTab('team')">
        <span class="tab-icon">👥</span><span>My Team</span>
      </div>
      <div class="tab" data-tab="alerts" onclick="showTab('alerts')">
        <span class="tab-icon">🔔</span><span>Notifications</span>
      </div>
      <div class="tab tab-reports" data-tab="reports" onclick="showTab('reports')" style="display:none">
        <span class="tab-icon">📑</span><span>Reports</span>
      </div>
      <div class="tab tab-watchlist" data-tab="watchlist" onclick="showTab('watchlist')" style="display:none">
        <span class="tab-icon">👤</span><span>Watch List</span>
      </div>
      <div class="tab" data-tab="ask" onclick="showTab('ask')">
        <span class="tab-icon">💬</span><span>Ask</span>
      </div>
      <div class="tab tab-codes" data-tab="codes" onclick="showTab('codes')" style="display:none">
        <span class="tab-icon">🛡️</span><span>Codes</span>
      </div>
      <div class="tab" data-tab="content" onclick="showTab('content')">
        <span class="tab-icon">📋</span><span>Content</span>
      </div>
      <div class="tab tab-admin" data-tab="admin" onclick="showTab('admin')" style="display:none">
        <span class="tab-icon">🛠</span><span>Admin</span>
      </div>
    </div>
    <div class="tabs-arrow left" id="tabs-arrow-left" style="display:none">‹</div>
    <div class="tabs-arrow right" id="tabs-arrow-right">›</div>
  </div>

  <!-- HOME TAB -->
  <div class="tab-panel active" id="tab-home">
    <a class="capture-btn" href="/capture">
      <span class="capture-btn-plus">＋</span>
      <span>Capture — Incident or Person</span>
    </a>

    <div class="card">
      <div class="card-title">Your Roles</div>
      <div id="roles-list"><div class="empty">Loading…</div></div>
    </div>

    <div class="card">
      <div class="card-title">Quick Actions</div>
      <div class="home-actions" id="home-actions">
        <a class="home-action" style="background:#8dc6e8;color:#1a1a1a" href="#" onclick="showTab('ask');return false">
          <div class="home-action-icon">💬</div>
          <div class="home-action-name">Ask Tab</div>
        </a>
        <a class="home-action" style="background:#ca8342" href="#" onclick="showTab('notes');return false">
          <div class="home-action-icon">📝</div>
          <div class="home-action-name">Team Notes</div>
        </a>
        <a class="home-action" style="background:#c0392b" href="#" onclick="showTab('alerts');return false">
          <div class="home-action-icon">🔔</div>
          <div class="home-action-name">Notifications</div>
        </a>
        <a class="home-action home-action-codes" style="background:#2d8659;display:none" href="#" onclick="showTab('codes');return false">
          <div class="home-action-icon">🛡️</div>
          <div class="home-action-name">Codes</div>
        </a>
        <a class="home-action home-action-reports" style="background:#6d3d31;display:none" href="#" onclick="showTab('reports');return false">
          <div class="home-action-icon">📑</div>
          <div class="home-action-name">Reports</div>
        </a>
        <a class="home-action home-action-watchlist" style="background:#402020;display:none" href="#" onclick="showTab('watchlist');return false">
          <div class="home-action-icon">👤</div>
          <div class="home-action-name">Watch List</div>
        </a>
        <a class="home-action" style="background:#aac27f" href="#" onclick="showTab('content');return false">
          <div class="home-action-icon">📋</div>
          <div class="home-action-name">Content</div>
        </a>
        <a class="home-action" style="background:#d97706" href="https://tab-supplies-worker.shanepass.workers.dev/" target="_blank" rel="noopener">
          <div class="home-action-icon">🛒</div>
          <div class="home-action-name">Supplies</div>
        </a>
      </div>
    </div>
  </div>

  <!-- v2.5: NOTES TAB (Team Notes) -->
  <div class="tab-panel" id="tab-notes">
    <div class="card">
      <div class="card-title">Post a Team Note</div>
      <div class="notes-form">
        <textarea id="note-body" placeholder="Supplies low, broken fixture, heads-up to a team leader. Bullet points welcome."></textarea>
        <select id="note-role">
          <option value="all">Everyone (all team leaders)</option>
          <option value="safety">Safety team</option>
          <option value="staff">Staff</option>
          <option value="elders">Elders</option>
          <option value="greeters">Greeters</option>
          <option value="cafe">Cafe</option>
          <option value="classroom">Classroom / Kids</option>
          <option value="media">Media</option>
          <option value="music">Music</option>
          <option value="living_nativity">Living Nativity</option>
          <option value="special_events">Special Events</option>
          <option value="team_leader">Team leaders</option>
        </select>
        <div style="margin-top:10px">
          <label style="display:block;font-size:13px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Photo (optional)</label>
          <input type="file" id="note-photo" accept="image/*" capture="environment" style="padding:10px;background:var(--card);border:1px dashed var(--border);width:100%;border-radius:8px;font-size:15px">
          <div style="font-size:12px;color:var(--muted);margin-top:4px">Photo of broken fixture, supply shortage, etc. Max 5 MB.</div>
        </div>
        <div style="margin-top:12px">
          <button class="btn" id="note-send" onclick="postNote()">Post Note</button>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-title">Recent Notes</div>
      <div id="notes-list"><div class="empty">Loading…</div></div>
    </div>
  </div>

  <!-- v2.9.7: MY TEAM TAB — multi-team directory stack (D1-based) -->
  <div class="tab-panel" id="tab-team">
    <div class="card" style="border-left:4px solid #aac27f">
      <div class="card-title" style="margin-bottom:6px">Your Teams</div>
      <div style="font-size:13px;color:var(--muted);margin-bottom:0">
        Reach your team without a radio. Tap a header to expand. Phone numbers are tap-to-call.
      </div>
    </div>
    <div id="team-directories-stack">
      <div class="empty">Loading directories…</div>
    </div>
  </div>

  <!-- ADMIN TAB -->
  <div class="tab-panel" id="tab-admin">
    <div class="card">
      <div class="card-title">Admin Tools</div>
      <a class="nav-link" href="/content">Manage Content</a>
      <a class="nav-link" href="/content/new">New Content Entry</a>
      <a class="nav-link admin-link-audit" href="/audit-log" style="display:none">View Audit Log</a>
    </div>
    <button class="logout" onclick="logout()">Sign out</button>
  </div>

  <!-- NOTIFICATIONS TAB -->
  <div class="tab-panel" id="tab-alerts">
    <!-- v2.8: Post a notification (safety/staff/elders/admin only) -->
    <div class="card notif-post-card" style="display:none">
      <div class="card-title">Post a Notification</div>
      <div id="notif-form-collapsed">
        <button class="btn" onclick="toggleNotifForm()">+ Post Notification</button>
        <div style="font-size:13px;color:var(--muted);margin-top:8px">Broadcast a code, all-clear, or heads-up to recipient roles.</div>
      </div>
      <div id="notif-form-expanded" style="display:none">
        <div class="field" style="margin-bottom:12px">
          <label style="display:block;font-size:13px;font-weight:700;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px">Category *</label>
          <input type="text" id="notif-category" placeholder="e.g. Code Red, All Clear, Lockdown, Weather Alert" style="width:100%;padding:13px;font-size:16px;border:1px solid var(--border);border-radius:8px;background:var(--card);color:var(--text)">
        </div>
        <div class="field" style="margin-bottom:12px">
          <label style="display:block;font-size:13px;font-weight:700;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px">Note (optional)</label>
          <textarea id="notif-note" placeholder="Brief context. Where, what to do." style="width:100%;padding:12px;font-size:16px;border:1px solid var(--border);border-radius:8px;background:var(--card);color:var(--text);min-height:70px;resize:vertical"></textarea>
        </div>
        <div class="field" style="margin-bottom:12px">
          <label style="display:block;font-size:13px;font-weight:700;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px">Recipients (tap to select)</label>
          <div id="notif-recipients-chips" style="display:flex;flex-wrap:wrap;gap:8px">
            <button type="button" class="recip-chip" data-value="all">Everyone</button>
            <button type="button" class="recip-chip" data-value="safety">Safety team</button>
            <button type="button" class="recip-chip" data-value="staff">Staff</button>
            <button type="button" class="recip-chip" data-value="elders">Elders</button>
            <button type="button" class="recip-chip" data-value="greeters">Greeters</button>
            <button type="button" class="recip-chip" data-value="cafe">Cafe</button>
            <button type="button" class="recip-chip" data-value="classroom">Classroom</button>
            <button type="button" class="recip-chip" data-value="children">Children</button>
            <button type="button" class="recip-chip" data-value="youth">Youth</button>
            <button type="button" class="recip-chip" data-value="media">Media</button>
            <button type="button" class="recip-chip" data-value="music">Music</button>
            <button type="button" class="recip-chip" data-value="living_nativity">Living Nativity</button>
            <button type="button" class="recip-chip" data-value="special_events">Special Events</button>
            <button type="button" class="recip-chip" data-value="team_leader">Team leaders</button>
          </div>
        </div>
        <div class="actions">
          <button class="btn" id="notif-send-btn" onclick="postNotification()">Send Notification</button>
          <button class="btn btn-cancel" onclick="toggleNotifForm()">Cancel</button>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-title">Recent Notifications</div>
      <div id="alerts-list"><div class="empty">Loading…</div></div>
    </div>
  </div>

  <!-- REPORTS TAB -->
  <div class="tab-panel" id="tab-reports">
    <div class="card">
      <div class="card-title">Recent Reports</div>
      <div id="reports-list"><div class="empty">Loading…</div></div>
    </div>
  </div>

  <!-- v2.5: WATCH LIST TAB -->
  <div class="tab-panel" id="tab-watchlist">
    <div class="card">
      <div class="card-title">Watch List — Active Entries</div>
      <div id="wl-standing-banner"></div>
      <div id="wl-list"><div class="empty">Loading…</div></div>
    </div>
  </div>

  <!-- ASK TAB -->
  <div class="tab-panel" id="tab-ask">
    <div class="card" style="background:linear-gradient(135deg,#aac27f 0%,#8dc6e8 100%);color:#1a1a1a;border:none">
      <div style="font-size:15px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:10px">
        💬 Ask Tab anything Tabernacle
      </div>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px 14px;font-size:14px;font-weight:600;line-height:1.6">
        <div>🛡️ Codes</div>
        <div>🏛️ Beliefs</div>
        <div>🤝 Get connected</div>
        <div>🎉 Events</div>
      </div>
      <div style="font-size:13px;margin-top:10px;font-style:italic;opacity:0.85">
        Just ask in plain words.
      </div>
    </div>
    <div class="card">
      <div class="card-title">Ask Tab</div>
      <div class="ask-history" id="ask-history"></div>
      <textarea class="ask-input" id="ask-q" name="ask_question" autocomplete="off" autocorrect="on" autocapitalize="sentences" spellcheck="true" data-1p-ignore="true" data-lpignore="true" data-form-type="other" placeholder="e.g. What do we believe about baptism? · Code Red procedure · Where is the 3-year-old classroom?"></textarea>
      <div class="ask-actions">
        <button class="btn" id="ask-send" onclick="sendAsk()">Ask</button>
      </div>
    </div>
  </div>

  <!-- CODES TAB -->
  <div class="tab-panel" id="tab-codes">
    <!-- v2.9.15: Home / Codes filter pills -->
    <div class="codes-filter-bar">
      <button class="codes-filter-pill active" id="pill-home" onclick="setCodesView('home')">Home</button>
      <button class="codes-filter-pill" id="pill-codes" onclick="setCodesView('codes')">Codes</button>
    </div>

    <!-- HOME VIEW: reference + ops content -->
    <div id="codes-view-home">
      <div id="codes-home-content"><div class="empty">Loading…</div></div>
    </div>

    <!-- CODES VIEW: 26-card safety flip chart -->
    <div id="codes-view-codes" style="display:none">
      <a class="capture-btn" href="/capture">
        <span class="capture-btn-plus">＋</span>
        <span>Capture — Incident or Person</span>
      </a>
      <div class="card">
        <div class="card-title">Tab Safety Flip Chart</div>
        <div id="codes-detail-anchor"></div>
        <div class="code-detail" id="code-detail"></div>
        <div id="codes-sections"><div class="empty">Loading flip chart…</div></div>
        <p style="font-size:13px;color:var(--muted);margin:16px 0 0;font-style:italic">
          Software does not dial 911. For real emergencies, call 911 yourself: 4141 DeSoto Rd, Sarasota.
        </p>
      </div>
      <!-- v2.9.5: Safety Team Directory -->
      <div class="card dir-card" id="safety-directory-card" style="display:none">
        <button type="button" class="dir-toggle" id="safety-directory-toggle"
                onclick="toggleSafetyDirectory()" aria-expanded="false">
          <span class="dir-toggle-label">
            <span class="dir-toggle-icon" aria-hidden="true">📞</span>
            <span>Safety Team Directory</span>
            <span class="dir-count" id="safety-directory-count"></span>
          </span>
          <span class="dir-toggle-arrow" id="safety-directory-arrow">▸</span>
        </button>
        <div class="dir-body" id="safety-directory-body" style="display:none">
          <div class="empty">Loading directory…</div>
        </div>
      </div>
    </div>
  </div>

  <!-- CONTENT TAB — v2.5: role boxes → tile grid → detail -->
  <div class="tab-panel" id="tab-content">
    <!-- View 1: Role boxes -->
    <div id="content-view-roles">
      <div class="card">
        <div class="card-title">Pick a Team</div>
        <p style="font-size:14px;color:var(--muted);margin:0 0 12px">
          Tap a team to see their content. Only teams you belong to are shown.
        </p>
        <div class="role-boxes" id="role-boxes">
          <div class="empty">Loading…</div>
        </div>
      </div>
    </div>

    <!-- View 2: Tile grid for selected role -->
    <div id="content-view-tiles" style="display:none">
      <a class="back-inline" onclick="contentBackToRoles()">
        <span class="back-inline-arrow">←</span> All teams
      </a>
      <div class="card">
        <div class="card-title" id="content-tiles-title">Content</div>
        <div class="content-search-row">
          <input type="text" id="content-search" class="content-search-input" placeholder="🔍 Search title or body…" oninput="onContentSearchInput()">
        </div>
        <div class="chips" id="content-chips">
          <div class="chip active" data-filter="all" onclick="setContentFilter('all')">All</div>
          <div class="chip" data-filter="sunday_morning" onclick="setContentFilter('sunday_morning')">Sunday</div>
          <div class="chip" data-filter="wednesday" onclick="setContentFilter('wednesday')">Wednesday</div>
          <div class="chip" data-filter="living_nativity_2026" onclick="setContentFilter('living_nativity_2026')">Living Nativity</div>
          <div class="chip" data-filter="events" onclick="setContentFilter('events')">Events</div>
        </div>
        <div id="content-tile-grid"><div class="empty">Loading…</div></div>
      </div>
    </div>

    <!-- View 3: Single content detail -->
    <div id="content-view-detail" style="display:none">
      <a class="back-inline" onclick="contentBackToTiles()">
        <span class="back-inline-arrow">←</span> Back
      </a>
      <div class="card">
        <div id="content-detail-body"></div>
      </div>
    </div>
  </div>

</div>

<script>
const USER_CAN_BROADCAST = ${canBroadcastFlag};
const USER_CAN_SEE_CODES = ${canSeeCodesFlag};
const USER_CAN_SEE_REPORTS = ${canSeeReportsFlag};
const USER_CAN_SEE_WATCHLIST = ${canSeeWatchListFlag};
const USER_CAN_POST_WATCHLIST = ${canPostWatchListFlag};
const USER_IS_GLOBAL_ADMIN = ${isGlobalAdminFlag};
const ME_USER_ID = ${meUserIdJson};

if (USER_CAN_SEE_CODES) {
  document.querySelectorAll('.tab-codes').forEach(t => t.style.display = '');
  document.querySelectorAll('.home-action-codes').forEach(t => t.style.display = '');
}
if (USER_CAN_SEE_REPORTS) {
  document.querySelectorAll('.tab-reports').forEach(t => t.style.display = '');
  document.querySelectorAll('.home-action-reports').forEach(t => t.style.display = '');
}
if (USER_CAN_SEE_WATCHLIST) {
  document.querySelectorAll('.tab-watchlist').forEach(t => t.style.display = '');
  document.querySelectorAll('.home-action-watchlist').forEach(t => t.style.display = '');
}
if (USER_IS_GLOBAL_ADMIN) {
  document.querySelectorAll('.admin-link-audit').forEach(t => t.style.display = '');
  document.querySelectorAll('.tab-admin').forEach(t => t.style.display = '');
}
// v2.8: show "Post Notification" card to safety/staff/elders/admin
if (USER_CAN_BROADCAST) {
  document.querySelectorAll('.notif-post-card').forEach(t => t.style.display = '');
}

function applyTheme(theme) {
  const meta = document.querySelector('meta[name="theme-color"]');
  const iconEl = document.getElementById('theme-btn-icon');
  const labelEl = document.getElementById('theme-btn-label');
  if (theme === 'dark') {
    document.body.classList.add('dark');
    if (iconEl) iconEl.textContent = '☀️';
    if (labelEl) labelEl.textContent = 'Light';
    if (meta) meta.setAttribute('content', '#aac27f');
  } else {
    document.body.classList.remove('dark');
    if (iconEl) iconEl.textContent = '🌙';
    if (labelEl) labelEl.textContent = 'Dark';
    if (meta) meta.setAttribute('content', '#aac27f');
  }
}
function toggleTheme() {
  const current = localStorage.getItem('tabready_theme') || 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  localStorage.setItem('tabready_theme', next);
  applyTheme(next);
}
applyTheme(localStorage.getItem('tabready_theme') || 'light');

function updateClock() {
  const now = new Date();
  document.getElementById('header-time').textContent =
    now.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true});
  document.getElementById('header-date').textContent =
    now.toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric'});
}
updateClock();
setInterval(updateClock, 30000);

async function fetchWeather(lat, lon) {
  try {
    const qs = (typeof lat === 'number' && typeof lon === 'number')
      ? '?lat=' + lat + '&lon=' + lon : '';
    const res = await fetch('/api/weather' + qs);
    if (!res.ok) return;
    const data = await res.json();
    if (data && typeof data.temp_f === 'number') {
      const el = document.getElementById('header-weather');
      document.getElementById('weather-icon').textContent = data.icon || '🌡️';
      document.getElementById('weather-text').textContent = data.temp_f + '°F · ' + (data.description || '') + ' · Sarasota, FL';
      el.style.display = 'flex';
    }
  } catch (e) {}
}
function loadWeather() {
  // v2.8: Default to Sarasota, no geolocation prompt
  fetchWeather();
}
loadWeather();

async function loadNextEvent() {
  try {
    const res = await fetch('/api/pco-events');
    if (!res.ok) return;
    const data = await res.json();
    if (data.events && data.events.length > 0) {
      const e = data.events[0];
      const when = new Date(e.starts_at).toLocaleString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit'
      });
      const el = document.getElementById('header-next');
      el.style.display = 'block';
      el.textContent = 'Next: ' + e.name + ' — ' + when;
    }
  } catch (e) {}
}
loadNextEvent();

// v2.5: Tab switching with history.replaceState so native back goes home
function showTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  const tabEl = document.querySelector('.tab[data-tab="' + name + '"]');
  if (tabEl) {
    tabEl.classList.add('active');
    tabEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }
  document.getElementById('tab-' + name).classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // Load tab-specific data
  if (name === 'reports') loadReports();
  if (name === 'notes') loadNotes();
  if (name === 'watchlist') loadWatchList();
  if (name === 'team') loadTeam();
  if (name === 'codes') renderCodesHomeView();
  if (name === 'ask') {
    setTimeout(function() {
      var q = document.getElementById('ask-q');
      if (q) q.focus();
    }, 200);
  }
}

// v2.5: Native back button always goes home (from the dashboard, that means staying put or doing nothing weird)
// Push one entry so back has somewhere to go without leaving the app
(function setupBackButton() {
  // Push initial state so native back has a target
  history.replaceState({ tab: 'home', view: 'tabs' }, '', '/');
  window.addEventListener('popstate', function(e) {
    // Always reset to home tab when native back is pressed
    showTab('home');
    // Re-push state so we don't leave the app on next back press
    history.pushState({ tab: 'home', view: 'tabs' }, '', '/');
  });
  // Push one extra state so first back press lands on home (and second exits if pressed again)
  history.pushState({ tab: 'home', view: 'tabs' }, '', '/');
})();

function updateTabArrows() {
  var bar = document.getElementById('tabs-bar');
  var left = document.getElementById('tabs-arrow-left');
  var right = document.getElementById('tabs-arrow-right');
  if (!bar || !left || !right) return;
  var hasOverflow = bar.scrollWidth > bar.clientWidth + 2;
  if (!hasOverflow) {
    left.style.display = 'none';
    right.style.display = 'none';
    return;
  }
  left.style.display = bar.scrollLeft > 4 ? 'flex' : 'none';
  right.style.display = (bar.scrollLeft + bar.clientWidth) < (bar.scrollWidth - 4) ? 'flex' : 'none';
}
(function setupTabArrows() {
  var bar = document.getElementById('tabs-bar');
  if (!bar) return;
  bar.addEventListener('scroll', updateTabArrows);
  window.addEventListener('resize', updateTabArrows);
  setTimeout(updateTabArrows, 100);
  setTimeout(updateTabArrows, 500);
})();

async function loadMe() {
  try {
    const res = await fetch('/api/me');
    if (!res.ok) return;
    const me = await res.json();
    USER_ROLES = Array.isArray(me.roles) ? me.roles : [];
    const el = document.getElementById('roles-list');
    if (me.is_global_admin) {
      el.innerHTML = '<div class="empty" style="text-align:left;padding:0">Global admin — sees all content.</div>';
    } else if (!me.roles || me.roles.length === 0) {
      el.innerHTML = '<div class="empty">No roles assigned yet.</div>';
    } else {
      el.innerHTML = me.roles.map(r => '<span class="pill pill-role">' + esc(r) + '</span>').join(' ');
    }
    if (ALL_ROLES.length > 0) renderRoleBoxes();
  } catch (e) {}
}

// v2.5: Content tab — role boxes → content tiles → detail
let CONTENT_ALL = [];
let CONTENT_FILTER = 'all';
let CONTENT_ROLE = null;
let CONTENT_DETAIL_ID = null;
let CONTENT_SEARCH = ''; // v2.8: lowercase search term
let ALL_ROLES = [];
let USER_ROLES = [];

const ROLE_STYLE = {
  safety:         { color: '#c0392b', icon: '🛡️',  textDark: false },
  staff:          { color: '#402020', icon: '🏛️',  textDark: false },
  elders:         { color: '#6d3d31', icon: '✝️',   textDark: false },
  greeters:       { color: '#8dc6e8', icon: '👋',  textDark: true  },
  cafe:           { color: '#ca8342', icon: '☕',  textDark: false },
  classroom:      { color: '#aac27f', icon: '⛪',  textDark: false },
  children:       { color: '#aac27f', icon: '⚡',  textDark: false },
  youth:          { color: '#7c3aed', icon: '🔥',  textDark: false },
  media:          { color: '#7c3aed', icon: '🎥',  textDark: false },
  music:          { color: '#d6539f', icon: '🎵',  textDark: false },
  living_nativity:{ color: '#2d8659', icon: '🎄',  textDark: false },
  special_events: { color: '#d97706', icon: '🎉',  textDark: false },
  team_leader:    { color: '#1e6fbf', icon: '🧭',  textDark: false },
  wed_adults:     { color: '#6d3d31', icon: '📖',  textDark: false },
  wed_children:   { color: '#aac27f', icon: '⚡',  textDark: false },
  wed_youth:      { color: '#7c3aed', icon: '🔥',  textDark: false }
};
// v2.8: Role IDs that are PERMISSION-ONLY (no Content tile shown for them)
// They still have permission roles for Reports / Watch List / posting.
const ROLES_HIDDEN_FROM_CONTENT_TILES = ['staff', 'elders', 'media', 'music'];
function styleForRole(id) {
  return ROLE_STYLE[id] || { color: '#6b7280', icon: '📋', textDark: false };
}

// Heuristic icon for content tile (by title keywords)
function iconForContent(title) {
  const t = (title || '').toLowerCase();
  if (t.includes('checklist')) return '✅';
  if (t.includes('schedule') || t.includes('time')) return '🕐';
  if (t.includes('supplies') || t.includes('inventory')) return '📦';
  if (t.includes('safety')) return '🛡️';
  if (t.includes('emergency')) return '🚨';
  if (t.includes('contact') || t.includes('phone')) return '📞';
  if (t.includes('children') || t.includes('kid')) return '🧒';
  if (t.includes('greet')) return '🤝';
  if (t.includes('coffee') || t.includes('cafe')) return '☕';
  if (t.includes('clean')) return '🧹';
  if (t.includes('meeting')) return '💬';
  if (t.includes('prayer') || t.includes('worship')) return '🙏';
  if (t.includes('event')) return '🎉';
  if (t.includes('procedure') || t.includes('process')) return '📋';
  if (t.includes('rule') || t.includes('policy')) return '📜';
  if (t.includes('intro') || t.includes('welcome')) return '👋';
  return '📄';
}

function setContentFilter(f) {
  CONTENT_FILTER = f;
  document.querySelectorAll('#content-chips .chip').forEach(c => {
    c.classList.toggle('active', c.dataset.filter === f);
  });
  renderContentTiles();
}

function filterItems(items, filter) {
  if (filter === 'all') return items;
  if (filter === 'sunday_morning') return items.filter(i => i.event_tag === 'sunday_morning');
  if (filter === 'wednesday') return items.filter(i =>
    (i.event_tag || '').toLowerCase().includes('wednesday') ||
    (i.event_tag || '').toLowerCase().includes('wed_'));
  if (filter === 'living_nativity_2026') return items.filter(i =>
    (i.event_tag || '').toLowerCase().includes('living_nativity'));
  if (filter === 'events') return items.filter(i => {
    const t = (i.event_tag || '').toLowerCase();
    if (!t) return false;
    if (t === 'sunday_morning') return false;
    if (t.includes('wednesday') || t.includes('wed_')) return false;
    if (t.includes('living_nativity')) return false;
    return true;
  });
  return items;
}

function countItemsForRole(roleId) {
  return CONTENT_ALL.filter(it => {
    let tags = [];
    try { tags = JSON.parse(it.role_tags || '[]'); } catch {}
    return Array.isArray(tags) && tags.includes(roleId);
  }).length;
}

function itemsForRole(roleId) {
  return CONTENT_ALL.filter(it => {
    let tags = [];
    try { tags = JSON.parse(it.role_tags || '[]'); } catch {}
    return Array.isArray(tags) && tags.includes(roleId);
  });
}

function renderRoleBoxes() {
  const el = document.getElementById('role-boxes');
  if (!ALL_ROLES.length) {
    el.innerHTML = '<div class="empty">Loading roles…</div>';
    return;
  }
  // v2.8: filter out staff/elders/media/music from Content tile display.
  // These remain as permission roles for Reports / Watch List.
  let visible = ALL_ROLES.filter(r => !ROLES_HIDDEN_FROM_CONTENT_TILES.includes(r.id));
  if (!USER_IS_GLOBAL_ADMIN) {
    visible = visible.filter(r => USER_ROLES.includes(r.id));
  }
  if (visible.length === 0) {
    el.innerHTML =
      '<div class="start-here" style="grid-column:1/-1">' +
        '<div class="start-here-label">Start Here</div>' +
        '<div class="start-here-title">No teams assigned yet</div>' +
        '<div class="start-here-body">Once a team leader adds you, your teams will appear here. Contact Shane to be added.</div>' +
      '</div>';
    return;
  }
  el.innerHTML = visible.map(r => {
    const s = styleForRole(r.id);
    const count = countItemsForRole(r.id);
    const sub = count === 0 ? 'No content yet' : (count + (count === 1 ? ' item' : ' items'));
    const textClass = s.textDark ? ' text-dark' : '';
    return '<div class="role-box' + textClass + '" style="background:' + esc(s.color) + '"' +
      ' onclick="openRole(' + JSON.stringify(r.id).replace(/"/g,'&quot;') + ',' + JSON.stringify(r.display_name).replace(/"/g,'&quot;') + ')">' +
      '<div class="role-box-icon">' + s.icon + '</div>' +
      '<div class="role-box-name">' + esc(r.display_name) + '</div>' +
      '<div class="role-box-count">' + esc(sub) + '</div>' +
      '</div>';
  }).join('');
}

function openRole(roleId, displayName) {
  CONTENT_ROLE = roleId;
  CONTENT_FILTER = 'all';
  CONTENT_SEARCH = '';
  var searchInput = document.getElementById('content-search');
  if (searchInput) searchInput.value = '';
  document.getElementById('content-view-roles').style.display = 'none';
  document.getElementById('content-view-tiles').style.display = 'block';
  document.getElementById('content-view-detail').style.display = 'none';
  document.getElementById('content-tiles-title').textContent = displayName;
  document.querySelectorAll('#content-chips .chip').forEach(c => {
    c.classList.toggle('active', c.dataset.filter === 'all');
  });
  renderContentTiles();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function contentBackToRoles() {
  CONTENT_ROLE = null;
  CONTENT_DETAIL_ID = null;
  document.getElementById('content-view-tiles').style.display = 'none';
  document.getElementById('content-view-detail').style.display = 'none';
  document.getElementById('content-view-roles').style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function contentBackToTiles() {
  CONTENT_DETAIL_ID = null;
  document.getElementById('content-view-detail').style.display = 'none';
  document.getElementById('content-view-tiles').style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// v2.5: render content as 6-second TILES (not long body cards)
function renderContentTiles() {
  const gridEl = document.getElementById('content-tile-grid');
  if (!CONTENT_ROLE) return;
  const roleItems = itemsForRole(CONTENT_ROLE);
  let filtered = filterItems(roleItems, CONTENT_FILTER);
  // v2.8: apply search filter (case-insensitive substring match on title OR body)
  if (CONTENT_SEARCH) {
    filtered = filtered.filter(function(it) {
      var title = (it.title || '').toLowerCase();
      var body = (it.body || '').toLowerCase();
      return title.indexOf(CONTENT_SEARCH) !== -1 || body.indexOf(CONTENT_SEARCH) !== -1;
    });
  }
  if (filtered.length === 0) {
    if (CONTENT_SEARCH) {
      gridEl.innerHTML = '<div class="empty">No content matches "' + esc(CONTENT_SEARCH) + '" for this team.</div>';
    } else if (roleItems.length === 0) {
      gridEl.innerHTML =
        '<div class="start-here">' +
          '<div class="start-here-label">Start Here</div>' +
          '<div class="start-here-title">No content for this team yet</div>' +
          '<div class="start-here-body">Once your team leader adds checklists, schedules, or procedures, they will appear here as quick-tap tiles. Ask Shane or your team leader to add the first one.</div>' +
        '</div>';
    } else {
      gridEl.innerHTML = '<div class="empty">No content matches this filter for this team.</div>';
    }
    return;
  }
  gridEl.innerHTML =
    '<div class="content-tiles">' +
    filtered.map(it => {
      const icon = iconForContent(it.title);
      const emergencyClass = it.is_emergency ? ' content-tile-emergency' : '';
      return '<div class="content-tile' + emergencyClass + '" onclick="openContent(' + JSON.stringify(it.id).replace(/"/g,'&quot;') + ')">' +
        '<div class="content-tile-icon">' + icon + '</div>' +
        '<div class="content-tile-name">' + esc(it.title) + '</div>' +
      '</div>';
    }).join('') +
    '</div>';
}

// v2.8: live search handler
function onContentSearchInput() {
  var inp = document.getElementById('content-search');
  CONTENT_SEARCH = (inp ? inp.value : '').trim().toLowerCase();
  renderContentTiles();
}

function openContent(id) {
  const it = CONTENT_ALL.find(c => c.id === id);
  if (!it) return;
  CONTENT_DETAIL_ID = id;
  // v2.8.2: hide role pills on content cards — they cluttered the view.
  // Role tags still drive permissions and remain visible/editable in the admin edit form.
  const eventPill = it.event_tag ? '<span class="pill pill-event">' + esc(it.event_tag) + '</span>' : '';
  const emergency = it.is_emergency ? '<span class="pill pill-emergency">Emergency</span>' : '';
  const metaLine = (it.event_tag || it.is_emergency)
    ? '<div style="font-size:13px;color:var(--muted);margin-bottom:12px">' + emergency + ' ' + eventPill + '</div>'
    : '';
  const html =
    '<h4 style="margin:0 0 8px;font-size:18px;text-transform:uppercase;letter-spacing:0.5px">' + esc(it.title) + '</h4>' +
    metaLine +
    '<div style="font-size:15px;line-height:1.6;color:var(--text);white-space:pre-wrap">' + linkifyContent(it.body) + '</div>';
  document.getElementById('content-detail-body').innerHTML = html;
  document.getElementById('content-view-tiles').style.display = 'none';
  document.getElementById('content-view-detail').style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function loadContent() {
  try {
    const [rolesRes, contentRes] = await Promise.all([
      fetch('/api/roles'),
      fetch('/api/content')
    ]);
    if (rolesRes.ok) {
      const rdata = await rolesRes.json();
      ALL_ROLES = rdata.items || [];
    }
    if (contentRes.ok) {
      const cdata = await contentRes.json();
      CONTENT_ALL = cdata.items || [];
    }
    renderRoleBoxes();
  } catch (e) {
    document.getElementById('role-boxes').innerHTML = '<div class="empty">Could not load content.</div>';
  }
}

async function loadAlerts() {
  try {
    const res = await fetch('/api/alerts');
    if (!res.ok) return;
    const data = await res.json();
    const items = data.items || [];
    const el = document.getElementById('alerts-list');
    if (items.length === 0) {
      el.innerHTML =
        '<div class="start-here">' +
          '<div class="start-here-label">Start Here</div>' +
          '<div class="start-here-title">No notifications yet</div>' +
          '<div class="start-here-body">When safety, staff, or elder leadership broadcasts a notification, it shows up here. All clear right now.</div>' +
        '</div>';
      return;
    }
    el.innerHTML = items.map(function(a) {
      // v2.8: delete button for author or admin
      var canDelete = (a.reporter_user_id === ME_USER_ID) || USER_IS_GLOBAL_ADMIN;
      var actionRow = canDelete
        ? '<div class="row-actions"><button class="row-btn row-btn-delete" onclick="deleteAlert(' + JSON.stringify(a.id).replace(/"/g,'&quot;') + ')">🗑 Delete</button></div>'
        : '';
      var recipients = '';
      try {
        var rec = JSON.parse(a.recipients || '[]');
        if (Array.isArray(rec) && rec.length > 0) {
          recipients = '<div style="font-size:12px;color:var(--muted);margin-top:4px">To: ' + rec.map(esc).join(', ') + '</div>';
        }
      } catch (e) {}
      return '<div class="alert ' + (a.status === 'open' ? 'open' : 'resolved') + '">' +
        '<div class="alert-code">' + esc(a.category) + '</div>' +
        '<div>' + esc(a.note || '') + '</div>' +
        recipients +
        '<div class="alert-meta">' + esc(a.status) + ' · ' + esc(a.created_at) + '</div>' +
        actionRow +
      '</div>';
    }).join('');
  } catch (e) {}
}

// v2.8: Notification post + delete
function toggleNotifForm() {
  var collapsed = document.getElementById('notif-form-collapsed');
  var expanded = document.getElementById('notif-form-expanded');
  if (expanded.style.display === 'none' || !expanded.style.display) {
    collapsed.style.display = 'none';
    expanded.style.display = 'block';
  } else {
    collapsed.style.display = 'block';
    expanded.style.display = 'none';
    // clear form
    document.getElementById('notif-category').value = '';
    document.getElementById('notif-note').value = '';
    var chips = document.querySelectorAll('#notif-recipients-chips .recip-chip.selected');
    for (var i = 0; i < chips.length; i++) chips[i].classList.remove('selected');
  }
}

async function postNotification() {
  var catEl = document.getElementById('notif-category');
  var noteEl = document.getElementById('notif-note');
  var btn = document.getElementById('notif-send-btn');
  var category = catEl.value.trim();
  if (!category) { catEl.focus(); alert('Category is required.'); return; }
  var note = noteEl.value.trim();
  var recipients = [];
  var chips = document.querySelectorAll('#notif-recipients-chips .recip-chip.selected');
  for (var i = 0; i < chips.length; i++) {
    recipients.push(chips[i].getAttribute('data-value'));
  }
  if (!confirm('Send notification "' + category + '"' + (recipients.length > 0 ? ' to: ' + recipients.join(', ') : '') + '?')) return;
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    var res = await fetch('/api/alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: category, note: note, recipients: recipients })
    });
    if (res.ok) {
      toggleNotifForm();
      loadAlerts();
    } else {
      var err = await res.json().catch(function() { return {}; });
      alert('Could not send notification: ' + (err.error || res.status));
    }
  } catch (e) {
    alert('Could not send notification. Try again.');
  } finally {
    btn.disabled = false; btn.textContent = 'Send Notification';
  }
}

// v2.8.1: tap-to-toggle chip behavior for recipients (phone-friendly)
function initRecipientChips() {
  var chips = document.querySelectorAll('#notif-recipients-chips .recip-chip');
  for (var i = 0; i < chips.length; i++) {
    chips[i].addEventListener('click', function(e) {
      e.preventDefault();
      this.classList.toggle('selected');
    });
  }
}

async function deleteAlert(id) {
  if (!confirm('Delete this notification?\\n\\nIt will be hidden from the Notifications tab but kept in the audit log.')) return;
  try {
    const res = await fetch('/api/alerts/' + encodeURIComponent(id) + '/delete', { method: 'POST' });
    if (res.ok) {
      loadAlerts();
    } else {
      const err = await res.json().catch(function() { return {}; });
      alert('Could not delete notification: ' + (err.error || res.status));
    }
  } catch (e) {
    alert('Could not delete notification. Try again.');
  }
}

async function loadReports() {
  if (!USER_CAN_SEE_REPORTS) return;
  try {
    const res = await fetch('/api/reports');
    if (!res.ok) return;
    const data = await res.json();
    const items = data.items || [];
    const el = document.getElementById('reports-list');
    if (items.length === 0) {
      el.innerHTML =
        '<div class="start-here">' +
          '<div class="start-here-label">Start Here</div>' +
          '<div class="start-here-title">No reports filed yet</div>' +
          '<div class="start-here-body">Tap the <strong>＋ Capture</strong> button on the Home tab to file an incident report. Reports show up here with email-sent confirmation and full audit trail.</div>' +
        '</div>';
      return;
    }
    el.innerHTML = items.map(function(r) {
      var kindPill = r.kind === 'incident'
        ? '<span class="pill pill-kind-incident">Incident</span>'
        : '<span class="pill pill-kind-ops">Ops Note</span>';
      var emailPill = '';
      if (r.kind === 'incident') {
        emailPill = r.email_sent
          ? '<span class="pill pill-ok">Email Sent</span>'
          : '<span class="pill pill-fail">Email Failed</span>';
      }
      var resolvedPill = r.resolved_at
        ? '<span class="pill pill-ok">✓ Resolved</span>'
        : '';
      var loc = r.location ? ' · ' + esc(r.location) : '';
      var photo = r.photo_key
        ? '<div style="margin-top:10px"><a href="/photo/' + esc(r.photo_key) + '" target="_blank"><img src="/photo/' + esc(r.photo_key) + '" alt="incident photo" style="max-width:100%;max-height:280px;border-radius:8px;border:1px solid var(--border)"></a></div>'
        : '';
      var resolutionNote = r.resolution_note
        ? '<div style="margin-top:8px;padding:8px 10px;background:var(--accent-light);border-radius:6px;font-size:13px"><strong style="text-transform:uppercase;letter-spacing:0.4px;font-size:11px;color:var(--muted)">Resolution:</strong> ' + esc(r.resolution_note) + '</div>'
        : '';
      // v2.8: action buttons (delete if author or admin; resolve if safety/staff/admin and not yet resolved)
      var canDelete = (r.reporter_user_id === ME_USER_ID) || USER_IS_GLOBAL_ADMIN;
      var canResolve = USER_CAN_SEE_REPORTS && !r.resolved_at;
      var actions = [];
      if (canResolve) {
        actions.push('<button class="row-btn row-btn-resolve" onclick="resolveReport(' + JSON.stringify(r.id).replace(/"/g,'&quot;') + ')">✓ Mark Resolved</button>');
      }
      if (canDelete) {
        actions.push('<button class="row-btn row-btn-delete" onclick="deleteReport(' + JSON.stringify(r.id).replace(/"/g,'&quot;') + ')">🗑 Delete</button>');
      }
      var actionRow = actions.length > 0
        ? '<div class="row-actions">' + actions.join('') + '</div>'
        : '';
      var dimStyle = r.resolved_at ? ' style="opacity:0.7"' : '';
      return '<div class="item"' + dimStyle + '>' +
        '<h4>' + kindPill + emailPill + ' ' + resolvedPill + '</h4>' +
        '<div class="item-meta">' + esc(r.created_at) + loc + '</div>' +
        '<div class="item-body">' + esc(r.summary) + '</div>' +
        resolutionNote +
        photo +
        actionRow +
        '</div>';
    }).join('');
  } catch (e) {
    document.getElementById('reports-list').innerHTML = '<div class="empty">Could not load reports.</div>';
  }
}

// v2.8: Report row actions
async function deleteReport(id) {
  if (!confirm('Delete this report?\\n\\nIt will be hidden from the Reports tab but kept in the audit log.')) return;
  try {
    const res = await fetch('/api/reports/' + encodeURIComponent(id) + '/delete', { method: 'POST' });
    if (res.ok) {
      loadReports();
    } else {
      const err = await res.json().catch(function() { return {}; });
      alert('Could not delete report: ' + (err.error || res.status));
    }
  } catch (e) {
    alert('Could not delete report. Try again.');
  }
}

async function resolveReport(id) {
  var note = prompt('Resolution note (optional):\\n\\nWhat was done about this? (Press OK with blank to skip.)');
  if (note === null) return; // user cancelled
  try {
    const res = await fetch('/api/reports/' + encodeURIComponent(id) + '/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: note || '' })
    });
    if (res.ok) {
      loadReports();
    } else {
      const err = await res.json().catch(function() { return {}; });
      alert('Could not mark resolved: ' + (err.error || res.status));
    }
  } catch (e) {
    alert('Could not mark resolved. Try again.');
  }
}

// v2.5: Team Notes
async function loadNotes() {
  try {
    const res = await fetch('/api/notes');
    if (!res.ok) return;
    const data = await res.json();
    const items = data.items || [];
    const el = document.getElementById('notes-list');
    if (items.length === 0) {
      el.innerHTML =
        '<div class="start-here">' +
          '<div class="start-here-label">Start Here</div>' +
          '<div class="start-here-title">No team notes yet</div>' +
          '<div class="start-here-body">Use the form above to leave a note for the team. Examples:' +
            '<ul>' +
              '<li>"Cafe is low on coffee filters."</li>' +
              '<li>"Side door latch is sticking — needs maintenance."</li>' +
              '<li>"Greeters: extra bulletins on the welcome table for new visitors."</li>' +
            '</ul>' +
          '</div>' +
        '</div>';
      return;
    }
    el.innerHTML = items.map(function(n) {
      var target = n.target_role && n.target_role !== 'all'
        ? '<span class="pill pill-role">' + esc(n.target_role) + '</span>'
        : '<span class="pill pill-role">All teams</span>';
      var photo = n.photo_key
        ? '<div style="margin-top:10px"><a href="/photo/' + esc(n.photo_key) + '" target="_blank"><img src="/photo/' + esc(n.photo_key) + '" alt="note photo" style="max-width:100%;max-height:280px;border-radius:8px;border:1px solid var(--border)"></a></div>'
        : '';
      // v2.8: delete button for author or admin
      var canDelete = (n.author_user_id === ME_USER_ID) || USER_IS_GLOBAL_ADMIN;
      var actionRow = canDelete
        ? '<div class="row-actions"><button class="row-btn row-btn-delete" onclick="deleteNote(' + JSON.stringify(n.id).replace(/"/g,'&quot;') + ')">🗑 Delete</button></div>'
        : '';
      return '<div class="notes-list-item">' +
        '<div class="notes-list-item-meta">' + esc(n.author_name) + ' · ' + esc(n.created_at) + ' · ' + target + '</div>' +
        '<div class="notes-list-item-body">' + esc(n.body) + '</div>' +
        photo +
        actionRow +
        '</div>';
    }).join('');
  } catch (e) {
    document.getElementById('notes-list').innerHTML = '<div class="empty">Could not load notes.</div>';
  }
}

// v2.8: Note row action
async function deleteNote(id) {
  if (!confirm('Delete this note?\\n\\nIt will be hidden from the Notes tab but kept in the audit log.')) return;
  try {
    const res = await fetch('/api/notes/' + encodeURIComponent(id) + '/delete', { method: 'POST' });
    if (res.ok) {
      loadNotes();
    } else {
      const err = await res.json().catch(function() { return {}; });
      alert('Could not delete note: ' + (err.error || res.status));
    }
  } catch (e) {
    alert('Could not delete note. Try again.');
  }
}

async function postNote() {
  const bodyEl = document.getElementById('note-body');
  const roleEl = document.getElementById('note-role');
  const photoEl = document.getElementById('note-photo');
  const btn = document.getElementById('note-send');
  const body = bodyEl.value.trim();
  if (!body) { bodyEl.focus(); return; }
  btn.disabled = true; btn.textContent = 'Posting…';
  try {
    // v2.6: multipart form (supports photo)
    const fd = new FormData();
    fd.append('body', body);
    fd.append('target_role', roleEl.value);
    if (photoEl.files && photoEl.files[0]) {
      fd.append('photo', photoEl.files[0]);
    }
    const res = await fetch('/api/notes', { method: 'POST', body: fd });
    if (res.ok) {
      const data = await res.json();
      bodyEl.value = '';
      roleEl.value = 'all';
      photoEl.value = '';
      if (data.photo_error) {
        alert('Note posted, but photo upload failed: ' + data.photo_error);
      }
      loadNotes();
    } else {
      alert('Could not post note. Try again.');
    }
  } catch (e) {
    alert('Could not post note. Try again.');
  } finally {
    btn.disabled = false; btn.textContent = 'Post Note';
  }
}

// v2.5: Watch List
async function loadWatchList() {
  if (!USER_CAN_SEE_WATCHLIST) return;
  try {
    const res = await fetch('/api/watch-list');
    if (!res.ok) return;
    const data = await res.json();
    const items = data.items || [];
    const banner = document.getElementById('wl-standing-banner');
    const standingLang = data.standing_language || '';
    if (items.length > 0 && standingLang) {
      banner.innerHTML = '<div class="wl-standing">' + esc(standingLang) + '</div>';
    } else {
      banner.innerHTML = '';
    }
    const el = document.getElementById('wl-list');
    if (items.length === 0) {
      var startBtn = USER_CAN_POST_WATCHLIST
        ? '<div style="margin-top:14px"><a href="/capture/person" class="btn">Add First Entry</a></div>'
        : '';
      el.innerHTML =
        '<div class="start-here">' +
          '<div class="start-here-label">Start Here</div>' +
          '<div class="start-here-title">Watch List is empty</div>' +
          '<div class="start-here-body">No active entries. Watch List is for situational awareness only — never for sharing outside TabReady.' +
            '<ul>' +
              '<li><strong>Situational</strong> entries auto-delete after 24 hours.</li>' +
              '<li><strong>Standing</strong> entries require documented basis and annual review.</li>' +
              '<li>Every post, view, and removal is logged.</li>' +
            '</ul>' +
          '</div>' +
          startBtn +
        '</div>';
      return;
    }
    el.innerHTML = items.map(function(w) {
      var retentionPill = w.retention_class === 'situational'
        ? '<span class="pill pill-situational">Situational · 24hr</span>'
        : '<span class="pill pill-standing">Standing</span>';
      var name = w.display_name ? esc(w.display_name) : '(no name given)';
      var basis = w.basis ? '<div style="font-size:13px;color:var(--muted);margin-top:6px"><strong>Basis:</strong> ' + esc(w.basis) + '</div>' : '';
      var expires = w.expires_at ? ' · expires ' + esc(w.expires_at) : '';
      var photo = w.photo_key
        ? '<div style="margin-top:10px"><a href="/photo/' + esc(w.photo_key) + '" target="_blank"><img src="/photo/' + esc(w.photo_key) + '" alt="watch list photo" style="max-width:100%;max-height:280px;border-radius:8px;border:1px solid var(--border)"></a></div>'
        : '';
      // v2.8: delete button for author or admin
      var canDelete = (w.author_user_id === ME_USER_ID) || USER_IS_GLOBAL_ADMIN;
      var actionRow = canDelete
        ? '<div class="row-actions"><button class="row-btn row-btn-delete" onclick="deleteWatchListEntry(' + JSON.stringify(w.id).replace(/"/g,'&quot;') + ')">🗑 Delete</button></div>'
        : '';
      return '<div class="wl-entry">' +
        '<div class="wl-entry-name">' + name + '</div>' +
        '<div class="wl-entry-meta">' + retentionPill + ' · added ' + esc(w.created_at) + expires + '</div>' +
        '<div class="wl-entry-reason">' + esc(w.reason) + '</div>' +
        basis +
        photo +
        actionRow +
        '</div>';
    }).join('');
  } catch (e) {
    document.getElementById('wl-list').innerHTML = '<div class="empty">Could not load watch list.</div>';
  }
}

// v2.8: Watch list row action
async function deleteWatchListEntry(id) {
  if (!confirm('Delete this Watch List entry?\\n\\nIt will be hidden from the Watch List but kept in the audit log.')) return;
  try {
    const res = await fetch('/api/watch-list/' + encodeURIComponent(id) + '/delete', { method: 'POST' });
    if (res.ok) {
      loadWatchList();
    } else {
      const err = await res.json().catch(function() { return {}; });
      alert('Could not delete entry: ' + (err.error || res.status));
    }
  } catch (e) {
    alert('Could not delete entry. Try again.');
  }
}

async function sendAsk() {
  const qEl = document.getElementById('ask-q');
  const q = qEl.value.trim();
  if (!q) return;
  const btn = document.getElementById('ask-send');
  const history = document.getElementById('ask-history');
  btn.disabled = true; btn.textContent = 'Thinking…';
  try {
    const res = await fetch('/api/ask', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q })
    });
    const data = await res.json();
    const answer = data.answer || 'No answer.';
    const qa = document.createElement('div');
    qa.className = 'ask-qa';
    qa.innerHTML =
      '<div class="ask-qa-q"><span class="ask-qa-q-label">Q</span>' + esc(q) + '</div>' +
      '<div class="ask-qa-a"><span class="ask-qa-a-label">A</span>' + esc(answer) + '</div>';
    history.appendChild(qa);
    qEl.value = '';
    qEl.focus();
    qa.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (e) {
    const errBlock = document.createElement('div');
    errBlock.className = 'ask-qa';
    errBlock.innerHTML =
      '<div class="ask-qa-q"><span class="ask-qa-q-label">Q</span>' + esc(q) + '</div>' +
      '<div class="ask-qa-a"><span class="ask-qa-a-label">A</span>Something went wrong. Try again.</div>';
    history.appendChild(errBlock);
  } finally {
    btn.disabled = false; btn.textContent = 'Ask';
  }
}

// v2.9.7: My Team — D1-based per-role directories with per-team colors.
// Builds a stack of collapsible directory cards (one per team the user belongs to,
// or all teams for admins). Reuses the same /api/team-directory endpoint.
// Roles without any user_roles assignments are skipped.
async function loadTeam() {
  const stack = document.getElementById('team-directories-stack');
  if (!stack) return;
  try {
    // Roles to render = ROLE_STYLE keys, but only the ones we have data for.
    // For non-admins, only the roles the user belongs to.
    // ROLE_STYLE is defined globally in this script.
    let candidateRoles = Object.keys(ROLE_STYLE);
    if (!USER_IS_GLOBAL_ADMIN) {
      candidateRoles = candidateRoles.filter(r => USER_ROLES.includes(r));
    }
    if (candidateRoles.length === 0) {
      stack.innerHTML =
        '<div class="start-here">' +
          '<div class="start-here-label">Start Here</div>' +
          '<div class="start-here-title">No teams yet</div>' +
          '<div class="start-here-body">Once a team leader adds you, your team directories will appear here.</div>' +
        '</div>';
      return;
    }
    // Fetch each directory in parallel, skip empty teams.
    const results = await Promise.all(candidateRoles.map(async roleId => {
      try {
        const res = await fetch('/api/team-directory?role=' + encodeURIComponent(roleId));
        if (!res.ok) return null;
        const data = await res.json();
        if (!data.members || data.members.length === 0) return null;
        return { roleId, data };
      } catch (e) {
        return null;
      }
    }));
    const nonEmpty = results.filter(r => r !== null);
    if (nonEmpty.length === 0) {
      stack.innerHTML =
        '<div class="start-here">' +
          '<div class="start-here-label">Start Here</div>' +
          '<div class="start-here-title">No team rosters loaded yet</div>' +
          '<div class="start-here-body">Team rosters live in D1. Send Shane a CSV from Planning Center for any team you want to see here. Safety, Greeters, and Café are loaded so far.</div>' +
        '</div>';
      return;
    }
    stack.innerHTML = nonEmpty.map(r => directoryCardHTML(r.roleId, r.data)).join('');
  } catch (e) {
    console.error('loadTeam error:', e);
    stack.innerHTML = '<div class="empty">Could not load team directories.</div>';
  }
}

// v2.9.7: Build the HTML for a single directory card.
// Uses per-role color from ROLE_STYLE for the header banner.
function directoryCardHTML(roleId, data) {
  const style = ROLE_STYLE[roleId] || { color: '#6d3d31', icon: '👥', textDark: false };
  const members = data.members || [];
  const roleName = (data.role && data.role.display_name) || roleId;
  const textColor = style.textDark ? '#1a1a1a' : '#ffffff';
  const headerBg = style.color;
  const cardId = 'dir-card-' + roleId;
  const bodyId = 'dir-body-' + roleId;
  const toggleId = 'dir-toggle-' + roleId;
  const pills = members.map(m => {
    const leadClass = m.is_lead ? ' dir-pill-lead' : '';
    const phoneInner = m.phone
      ? '<div class="dir-pill-phone">' + esc(m.phone) + '</div>'
      : '<div class="dir-pill-nophone">no number</div>';
    if (m.phone) {
      const digits = m.phone.replace(/\D/g, '');
      return (
        '<a class="dir-pill' + leadClass + '" href="tel:+1' + digits + '">' +
          '<div class="dir-pill-name">' + esc(m.display_name) + '</div>' +
          phoneInner +
        '</a>'
      );
    } else {
      return (
        '<div class="dir-pill' + leadClass + '">' +
          '<div class="dir-pill-name">' + esc(m.display_name) + '</div>' +
          phoneInner +
        '</div>'
      );
    }
  }).join('');
  return (
    '<div class="card dir-card" id="' + cardId + '">' +
      '<button type="button" class="dir-toggle" id="' + toggleId + '" ' +
        'style="background:' + headerBg + ';color:' + textColor + '" ' +
        'onclick="toggleDirectory(&apos;' + roleId + '&apos;)" aria-expanded="false">' +
        '<span class="dir-toggle-label">' +
          '<span class="dir-toggle-icon" aria-hidden="true">' + (style.icon || '👥') + '</span>' +
          '<span>' + esc(roleName) + '</span>' +
          '<span class="dir-count">(' + members.length + ')</span>' +
        '</span>' +
        '<span class="dir-toggle-arrow">▸</span>' +
      '</button>' +
      '<div class="dir-body" id="' + bodyId + '" style="display:none">' +
        '<div class="dir-grid">' + pills + '</div>' +
        '<button type="button" class="dir-close" onclick="toggleDirectory(&apos;' + roleId + '&apos;)">Close</button>' +
      '</div>' +
    '</div>'
  );
}

// v2.9.7: generic toggle — works for any directory card by roleId
function toggleDirectory(roleId) {
  const body = document.getElementById('dir-body-' + roleId);
  const toggle = document.getElementById('dir-toggle-' + roleId);
  const card = document.getElementById('dir-card-' + roleId);
  if (!body || !toggle) return;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  toggle.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
  if (isOpen && card) {
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// FLIP CHART — v2.5: section order refined
let CODES_DATA = [];
// v2.5: medical-with-medical, threat-with-threat, evacuation, children grouped
const SECTION_ORDER = ['codes','medical','threat','evacuation','children','florida','pastoral','emergency','other'];
const SECTION_LABELS = {
  codes: 'Core Codes',
  medical: 'Medical',
  threat: 'Active Threat',
  evacuation: 'Evacuation',
  children: 'Children',
  florida: 'Florida-Specific',
  pastoral: 'Pastoral / Sensitive',
  emergency: 'Other Emergencies',
  other: 'Other'
};
const YELLOW_COLORS = new Set(['#e0a800']);

async function loadCodes() {
  if (!USER_CAN_SEE_CODES) return;
  try {
    const res = await fetch('/api/codes');
    if (!res.ok) {
      document.getElementById('codes-sections').innerHTML = '<div class="empty">Could not load flip chart.</div>';
      return;
    }
    const data = await res.json();
    CODES_DATA = data.items || [];
    renderCodes();
  } catch (e) {
    document.getElementById('codes-sections').innerHTML = '<div class="empty">Error loading flip chart.</div>';
  }
}

// v2.9.4: Safety team directory loader — pill grid, collapsible.
// Reuses USER_CAN_SEE_CODES (safety members + admins).
async function loadSafetyDirectory() {
  if (!USER_CAN_SEE_CODES) return;
  const card = document.getElementById('safety-directory-card');
  const body = document.getElementById('safety-directory-body');
  const countEl = document.getElementById('safety-directory-count');
  if (!card || !body) return;
  try {
    const res = await fetch('/api/team-directory?role=safety');
    if (!res.ok) {
      if (res.status === 403) { card.style.display = 'none'; return; }
      body.innerHTML = '<div class="empty">Could not load directory.</div>';
      card.style.display = '';
      return;
    }
    const data = await res.json();
    const members = data.members || [];
    if (countEl) countEl.textContent = '(' + members.length + ')';
    if (members.length === 0) {
      body.innerHTML = '<div class="empty">No directory entries yet.</div>';
      card.style.display = '';
      return;
    }
    const pills = members.map(m => {
      const leadClass = m.is_lead ? ' dir-pill-lead' : '';
      const phoneInner = m.phone
        ? '<div class="dir-pill-phone">' + esc(m.phone) + '</div>'
        : '<div class="dir-pill-nophone">no number</div>';
      if (m.phone) {
        const digits = m.phone.replace(/\D/g, '');
        return (
          '<a class="dir-pill' + leadClass + '" href="tel:+1' + digits + '">' +
            '<div class="dir-pill-name">' + esc(m.display_name) + '</div>' +
            phoneInner +
          '</a>'
        );
      } else {
        return (
          '<div class="dir-pill' + leadClass + '">' +
            '<div class="dir-pill-name">' + esc(m.display_name) + '</div>' +
            phoneInner +
          '</div>'
        );
      }
    }).join('');
    body.innerHTML = '<div class="dir-grid">' + pills + '</div>' +
      '<button type="button" class="dir-close" onclick="toggleSafetyDirectory()">Close</button>';
    card.style.display = '';
  } catch (e) {
    body.innerHTML = '<div class="empty">Error loading directory.</div>';
    card.style.display = '';
  }
}

// v2.9.4: toggle the directory grid visibility
function toggleSafetyDirectory() {
  const body = document.getElementById('safety-directory-body');
  const toggle = document.getElementById('safety-directory-toggle');
  const card = document.getElementById('safety-directory-card');
  if (!body || !toggle) return;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  toggle.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
  // v2.9.6: when closing, scroll header back into view so user knows where they are
  if (isOpen && card) {
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

let ACTIVE_CODES_VIEW = 'home';

function setCodesView(view) {
  ACTIVE_CODES_VIEW = view;
  document.getElementById('pill-home').classList.toggle('active', view === 'home');
  document.getElementById('pill-codes').classList.toggle('active', view === 'codes');
  document.getElementById('codes-view-home').style.display = view === 'home' ? '' : 'none';
  document.getElementById('codes-view-codes').style.display = view === 'codes' ? '' : 'none';
  if (view === 'home') renderCodesHomeView();
}

function renderCodesHomeView() {
  const el = document.getElementById('codes-home-content');
  if (!el) return;
  const refItems = (CONTENT_ALL || []).filter(c => !c.is_emergency);
  if (refItems.length === 0) {
    el.innerHTML = '<div class="empty">No reference content available.</div>';
    return;
  }
  const byTag = {};
  refItems.forEach(c => { const t = c.event_tag || 'General'; if (!byTag[t]) byTag[t] = []; byTag[t].push(c); });
  const tagConfig = {
    sunday_morning:       { label: 'Sunday Morning',       icon: '☀️',  color: '#d97706' },
    living_nativity_2026: { label: 'Living Nativity 2026', icon: '🎄',  color: '#2d8659' },
    wednesday:            { label: 'Wednesday',             icon: '📅',  color: '#7c3aed' },
    events:               { label: 'Events',                icon: '📣',  color: '#059669' },
    General:              { label: 'General Reference',     icon: '📋',  color: '#3b82f6' },
  };
  const tagOrder = ['sunday_morning','living_nativity_2026','wednesday','events','General'];
  const orderedTags = [...new Set([...tagOrder,...Object.keys(byTag)])].filter(t => byTag[t]);
  el.innerHTML = orderedTags.map(tag => {
    const items = byTag[tag]; if (!items) return '';
    const cfg = tagConfig[tag] || { label: tag, icon: '📄', color: '#6b7280' };
    const header = '<div class="home-section-title" style="border-left-color:' + cfg.color + '">' +
      '<span class="home-section-icon">' + cfg.icon + '</span>' + esc(cfg.label) + '</div>';
    return '<div class="codes-section">' + header + '<div class="home-ref-list">' +
      items.map(c =>
        '<div class="home-ref-card" onclick="toggleRefCard(this)">' +
          '<div class="home-ref-title">' +
            '<span>' + esc(c.title) + '</span>' +
            '<span class="home-ref-chevron">&#9654;</span>' +
          '</div>' +
          '<div class="home-ref-body" style="display:none">' + linkifyContent(c.body) + '</div>' +
        '</div>'
      ).join('') +
      '</div></div>';
  }).join('');
}

function toggleRefCard(el) {
  const body = el.querySelector('.home-ref-body');
  if (!body) return;
  const opening = body.style.display === 'none';
  body.style.display = opening ? '' : 'none';
  el.classList.toggle('open', opening);
}

function renderCodes() {
  const container = document.getElementById('codes-sections');
  if (CODES_DATA.length === 0) {
    container.innerHTML = '<div class="empty">No flip chart cards available.</div>';
    return;
  }
  const bySection = {};
  CODES_DATA.forEach(c => {
    if (!bySection[c.section]) bySection[c.section] = [];
    bySection[c.section].push(c);
  });
  const html = SECTION_ORDER.map(sec => {
    const cards = bySection[sec];
    if (!cards || cards.length === 0) return '';
    const cardHtml = cards.map(c => {
      const isYellow = YELLOW_COLORS.has(c.color);
      const textClass = isYellow ? ' text-dark' : '';
      // v2.8.7: split title into top label and bottom description.
      // If title starts with "Code <Color>", that becomes the top line and
      // the rest becomes the description. Otherwise the full title goes on
      // top and the bottom stays empty.
      let topLabel = c.title || '';
      let bottomDesc = '';
      const m = (c.title || '').match(/^(Code\s+\w+(?:\s*\([^)]+\))?)\s+(.+)$/i);
      if (m) {
        topLabel = m[1].toUpperCase();
        bottomDesc = m[2];
      } else {
        topLabel = (c.title || '').toUpperCase();
      }
      const bottomHtml = bottomDesc
        ? '<div class="code-card-name">' + esc(bottomDesc) + '</div>'
        : '';
      return '<div class="code-card' + textClass + '" data-code-id="' + esc(c.id) + '" style="background:' + esc(c.color) + '">' +
        '<div class="code-card-top">' + esc(topLabel) + '</div>' +
        '<div class="code-card-icon">' + (c.icon || '⚪') + '</div>' +
        bottomHtml +
        '</div>';
    }).join('');
    return '<div class="codes-section">' +
      '<div class="codes-section-title">' + esc(SECTION_LABELS[sec] || sec) + '</div>' +
      '<div class="codes-grid">' + cardHtml + '</div></div>';
  }).join('');
  container.innerHTML = html;
  container.addEventListener('click', function(e) {
    const card = e.target.closest('.code-card');
    if (card && card.dataset.codeId) showCode(card.dataset.codeId);
  });
}

function showCode(id) {
  const code = CODES_DATA.find(c => c.id === id);
  if (!code) return;
  const el = document.getElementById('code-detail');
  el.innerHTML =
    '<div class="code-detail-head">' +
      '<span class="code-swatch" style="background:' + esc(code.color) + '"></span>' +
      '<h3>' + esc(code.title) + '</h3>' +
    '</div>' +
    '<div class="code-detail-body">' + linkifyContent(code.body) + '</div>' +
    '<button class="code-detail-close" onclick="closeCode()">Close</button>';
  el.classList.add('open');
  document.getElementById('codes-detail-anchor').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function closeCode() { document.getElementById('code-detail').classList.remove('open'); }

async function logout() {
  await fetch('/auth/logout', { method: 'POST' });
  window.location.href = '/';
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// v2.9.0: linkify phones and emails inside card body text.
// v2.9.6: also bold ALL-CAPS section headers (e.g. "DO THIS", "WHO HELPS").
// Escapes HTML first, THEN runs regex on the safe string.
// Phone formats matched: (NNN) NNN-NNNN | NNN-NNN-NNNN | NNN.NNN.NNNN
// Returns HTML string with <a href="tel:..."> and <a href="mailto:...">.
function linkifyContent(s) {
  const safe = esc(s);
  // Email first (so an email's local-part doesn't get caught by phone regex)
  const withEmails = safe.replace(
    /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g,
    m => '<a class="tab-link" href="mailto:' + m + '">' + m + '</a>'
  );
  // Then phones
  const withLinks = withEmails.replace(
    /(\(\d{3}\)\s?\d{3}[-.\s]?\d{4}|\d{3}[-.]\d{3}[-.]\d{4})/g,
    m => {
      const digits = m.replace(/\D/g, '');
      return '<a class="tab-link" href="tel:+1' + digits + '">' + m + '</a>';
    }
  );
  // v2.9.6: bold + darken ALL-CAPS section header lines.
  // Match: a line that is mostly uppercase, 2-50 chars, optional punctuation.
  // Examples that match: "DO THIS", "WHO HELPS", "ON THE RADIO",
  //   "HEAT STROKE (EMERGENCY)", "NON-EMERGENCY POLICE"
  // Won't match: lines with lowercase letters, plain prose, numbered steps.
  const withHeaders = withLinks.replace(
    /^([A-Z][A-Z0-9 /&()'.,\-]{1,49})$/gm,
    '<span class="card-section-header">$1</span>'
  );
  return withHeaders;
}

loadMe();
loadContent();
loadAlerts();
loadCodes();
loadSafetyDirectory();
// Pre-load notes on first show; cheap call.
loadNotes();
// v2.8.1: wire up tap-chip behavior for notification recipients
initRecipientChips();

// v2.9.2: Enter submits the Ask form (Shift+Enter for newline).
(function wireAskEnter() {
  const askInput = document.getElementById('ask-q');
  if (!askInput) return;
  askInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      sendAsk();
    }
  });
})();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('/service-worker.js')
      .catch(function(err) { console.log('SW registration failed:', err); });
  });
}
</script>
</body>
</html>`, { headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache, no-store, must-revalidate' } });
}

// ─────────────────────────────────────────────
// CONTENT LIST + FORM (admin pages — unchanged behavior, ALL CAPS styling)
// ─────────────────────────────────────────────

function contentListPage(user, items) {
  const adminButton = user.is_global_admin
    ? `<a class="primary-btn" href="/content/new">+ New Content</a>` : '';

  const rows = items.length === 0
    ? `<p class="muted">No content visible to your roles yet.</p>`
    : items.map(item => {
        let tags = [];
        try { tags = JSON.parse(item.role_tags || '[]'); } catch {}
        const tagSpans = tags.map(t => `<span class="role">${escapeHtml(t)}</span>`).join(' ');
        const emergency = item.is_emergency ? '<span class="badge-emergency">Emergency</span>' : '';
        // v2.8.3: clearly mark flipchart codes in the admin list so they're not
        // confused with regular content, and so it's obvious which rows feed the flip chart.
        const isFlipchart = item.event_tag === 'safety_flipchart';
        const flipchartTag = isFlipchart ? '<span class="badge-flipchart">📋 Flip Chart Code</span>' : '';
        const langTag = item.language ? `<span class="lang">${escapeHtml(item.language.toUpperCase())}</span>` : '';
        const sourceTag = item.source ? `<span class="src">${escapeHtml(item.source)}</span>` : '';
        const editLink = user.is_global_admin
          ? `<a class="edit-link" href="/content/${escapeHtml(item.id)}/edit">Edit</a>` : '';
        // v2.8: admin row actions — Tighten + Delete
        const adminActions = user.is_global_admin
          ? `<div class="admin-row-actions">
               <button type="button" class="admin-btn admin-btn-tighten" onclick="tightenContent('${escapeHtml(item.id)}', this)">✨ Tighten with AI</button>
               <button type="button" class="admin-btn admin-btn-delete" onclick="deleteContent('${escapeHtml(item.id)}', '${escapeHtml(item.title).replace(/'/g, "\\'")}')">🗑 Delete</button>
             </div>`
          : '';
        return `
          <div class="item${isFlipchart ? ' item-flipchart' : ''}" data-content-id="${escapeHtml(item.id)}">
            <div class="item-head">
              <h3>${escapeHtml(item.title)} ${emergency} ${flipchartTag}</h3>
              ${editLink}
            </div>
            <div class="item-meta">
              <span class="tier">Tier ${item.tier}</span>
              ${langTag} ${sourceTag} ${tagSpans}
            </div>
            <div class="item-body">${escapeHtml(item.body).replace(/\n/g, '<br>')}</div>
            <div class="item-foot">v${item.version} · updated ${escapeHtml(item.updated_at)}</div>
            ${adminActions}
          </div>
        `;
      }).join('');

  return new Response(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Content — TabReady</title>
  <style>
    body { font-family: -apple-system, sans-serif; background: #f5f5f5; margin: 0; padding: 24px; font-size: 16px; }
    .wrap { max-width: 720px; margin: 24px auto; }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
    .header h1 { margin: 0; font-size: 24px; text-transform: uppercase; letter-spacing: 0.5px; }
    .back { color: #2563eb; text-decoration: none; font-size: 16px; font-weight: 700; padding: 12px 0; display: inline-block; text-transform: uppercase; letter-spacing: 0.5px; }
    .primary-btn { background: #2563eb; color: white; padding: 10px 18px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; }
    .item { background: white; padding: 20px; border-radius: 12px; margin-bottom: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.03); }
    .item-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .item-head h3 { margin: 0; font-size: 17px; text-transform: uppercase; letter-spacing: 0.3px; }
    .item-meta { margin-bottom: 12px; font-size: 13px; }
    .item-body { color: #333; line-height: 1.5; margin-bottom: 12px; }
    .item-foot { color: #999; font-size: 12px; }
    .role { display: inline-block; background: #eef2ff; color: #3730a3; padding: 2px 8px; border-radius: 6px; font-size: 11px; margin: 0 4px 0 0; font-family: monospace; font-weight: 700; }
    .tier { display: inline-block; background: #f3f4f6; color: #4b5563; padding: 2px 8px; border-radius: 6px; font-size: 11px; margin: 0 6px 0 0; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; }
    .lang { display: inline-block; background: #ecfeff; color: #155e75; padding: 2px 8px; border-radius: 6px; font-size: 11px; margin: 0 6px 0 0; font-weight: 700; }
    .src { display: inline-block; background: #fef3c7; color: #92400e; padding: 2px 8px; border-radius: 6px; font-size: 11px; margin: 0 6px 0 0; font-weight: 700; }
    .badge-emergency { display: inline-block; background: #fee2e2; color: #991b1b; padding: 2px 8px; border-radius: 6px; font-size: 10px; font-weight: 700; margin-left: 6px; text-transform: uppercase; letter-spacing: 0.4px; }
    .edit-link { color: #2563eb; text-decoration: none; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
    .muted { color: #999; }
    /* v2.8: admin row actions */
    .admin-row-actions { display: flex; gap: 8px; padding-top: 12px; border-top: 1px dashed #e5e3dd; flex-wrap: wrap; }
    .admin-btn { padding: 8px 14px; border-radius: 7px; font-size: 12px; font-weight: 700;
                 cursor: pointer; border: none; text-transform: uppercase; letter-spacing: 0.4px;
                 font-family: inherit; }
    .admin-btn:disabled { opacity: 0.6; cursor: wait; }
    .admin-btn-tighten { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
    .admin-btn-delete { background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; }
    /* v2.8.3: clearly mark flip chart codes in the admin list */
    .badge-flipchart { display: inline-block; background: #fef3c7; color: #92400e;
                       border: 1px solid #fde68a; padding: 2px 8px; border-radius: 6px;
                       font-size: 11px; font-weight: 700; margin-left: 6px;
                       text-transform: uppercase; letter-spacing: 0.4px; vertical-align: middle; }
    .item-flipchart { border-left: 4px solid #fbbf24; }
    /* v2.8: Tighten modal */
    .v28-modal { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.6);
                 z-index: 9999; align-items: flex-start; justify-content: center;
                 padding: 20px; overflow-y: auto; }
    .v28-modal.open { display: flex; }
    .v28-modal-box { background: white; max-width: 760px; width: 100%; border-radius: 14px;
                     padding: 22px; margin-top: 20px; box-shadow: 0 10px 40px rgba(0,0,0,0.3); }
    .v28-modal h2 { margin: 0 0 12px; font-size: 20px; text-transform: uppercase; letter-spacing: 0.5px; }
    .v28-diff-grid { display: grid; grid-template-columns: 1fr; gap: 12px; margin-bottom: 14px; }
    @media (min-width: 720px) { .v28-diff-grid { grid-template-columns: 1fr 1fr; } }
    .v28-diff-col { background: #f7f6f2; border-radius: 10px; padding: 14px;
                    font-size: 14px; line-height: 1.5; white-space: pre-wrap;
                    max-height: 320px; overflow-y: auto; border: 1px solid #e5e3dd; }
    .v28-diff-label { font-size: 11px; font-weight: 700; text-transform: uppercase;
                      letter-spacing: 0.5px; color: #6d3d31; margin-bottom: 6px; }
    .v28-modal-actions { display: flex; gap: 10px; flex-wrap: wrap; }
    .v28-modal-actions button { padding: 12px 20px; border-radius: 8px; font-weight: 700;
                                cursor: pointer; border: none; font-size: 14px;
                                text-transform: uppercase; letter-spacing: 0.5px; font-family: inherit; }
    .v28-btn-use { background: #2563eb; color: white; }
    .v28-btn-keep { background: #f3f4f6; color: #1a1a1a; border: 1px solid #ddd; }
    .v28-hint { font-size: 13px; color: #6d3d31; margin-bottom: 14px; line-height: 1.5;
                background: #fef3c7; padding: 10px 12px; border-radius: 8px; }
  </style>
  <script>
    if (window.location.pathname !== '/') {
      history.replaceState({}, '', window.location.pathname);
      window.addEventListener('popstate', function() { window.location.href = '/'; });
    }
  </script>
</head>
<body>
  <div class="wrap">
    <a class="back" href="/">← Home</a>
    <div class="header">
      <h1>Content</h1>
      ${adminButton}
    </div>
    ${rows}
  </div>

  <!-- v2.8: Tighten modal -->
  <div id="tighten-modal" class="v28-modal">
    <div class="v28-modal-box">
      <h2>✨ Tighten with AI</h2>
      <div class="v28-hint">
        Compare the original to Claude's tightened version. To use the suggestion,
        click "Open in Edit Form" — the edit page opens with the new body pre-filled.
        Review carefully before saving. Original stays put until you save.
      </div>
      <div class="v28-diff-grid">
        <div>
          <div class="v28-diff-label">Original</div>
          <div class="v28-diff-col" id="tighten-original">—</div>
        </div>
        <div>
          <div class="v28-diff-label">Suggestion</div>
          <div class="v28-diff-col" id="tighten-suggestion">—</div>
        </div>
      </div>
      <div class="v28-modal-actions">
        <button type="button" class="v28-btn-use" id="tighten-use-btn" onclick="useTightened()">Open in Edit Form</button>
        <button type="button" class="v28-btn-use" style="background:#059669" onclick="copyTightenedToClipboard()">Copy Suggestion</button>
        <button type="button" class="v28-btn-keep" onclick="closeTightenModal()">Keep Original</button>
      </div>
    </div>
  </div>

  <script>
    var TIGHTEN_CONTENT_ID = null;
    var TIGHTEN_SUGGESTION = '';

    async function tightenContent(contentId, btn) {
      btn.disabled = true;
      var originalLabel = btn.textContent;
      btn.textContent = '✨ Tightening…';
      try {
        var res = await fetch('/api/content/' + encodeURIComponent(contentId) + '/tighten', {
          method: 'POST'
        });
        if (!res.ok) {
          var err = await res.json().catch(function() { return {}; });
          alert('Tighten failed: ' + (err.error || res.status));
          return;
        }
        var data = await res.json();
        TIGHTEN_CONTENT_ID = contentId;
        TIGHTEN_SUGGESTION = data.suggestion || '';
        document.getElementById('tighten-original').textContent = data.original || '';
        document.getElementById('tighten-suggestion').textContent = data.suggestion || '';
        document.getElementById('tighten-modal').classList.add('open');
      } catch (e) {
        alert('Tighten failed. Try again.');
      } finally {
        btn.disabled = false;
        btn.textContent = originalLabel;
      }
    }

    function closeTightenModal() {
      document.getElementById('tighten-modal').classList.remove('open');
      TIGHTEN_CONTENT_ID = null;
      TIGHTEN_SUGGESTION = '';
    }

    function useTightened() {
      if (!TIGHTEN_CONTENT_ID || !TIGHTEN_SUGGESTION) return;
      // Stash in sessionStorage; edit page will read and prefill.
      try {
        sessionStorage.setItem('tabready_tighten_prefill_' + TIGHTEN_CONTENT_ID, TIGHTEN_SUGGESTION);
      } catch (e) {}
      window.location.href = '/content/' + encodeURIComponent(TIGHTEN_CONTENT_ID) + '/edit?tightened=1';
    }

    function copyTightenedToClipboard() {
      if (!TIGHTEN_SUGGESTION) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(TIGHTEN_SUGGESTION).then(function() {
          alert('Suggestion copied to clipboard. Paste it into the Edit form.');
        }, function() {
          alert('Could not copy. Try selecting the suggestion text manually.');
        });
      } else {
        alert('Clipboard not available. Select and copy the suggestion text manually.');
      }
    }

    document.getElementById('tighten-modal').addEventListener('click', function(e) {
      if (e.target === this) closeTightenModal();
    });

    async function deleteContent(contentId, title) {
      if (!confirm('Delete content "' + title + '"?\\n\\nIt will be hidden from the app but kept in the database for audit.')) return;
      try {
        var res = await fetch('/api/content/' + encodeURIComponent(contentId) + '/delete', {
          method: 'POST'
        });
        if (res.ok) {
          window.location.reload();
        } else {
          var err = await res.json().catch(function() { return {}; });
          alert('Delete failed: ' + (err.error || res.status));
        }
      } catch (e) {
        alert('Delete failed. Try again.');
      }
    }
  </script>
</body>
</html>`, { headers: { 'Content-Type': 'text/html' } });
}

function contentFormPage(user, allRoles, existing, errorMsg, formValues) {
  const isEdit = !!existing;
  const action = isEdit ? `/content/${escapeHtml(existing.id)}` : '/content';
  const heading = isEdit ? 'Edit Content' : 'New Content';

  const v = formValues || (existing ? {
    title: existing.title, body: existing.body, tier: existing.tier,
    event_tag: existing.event_tag, language: existing.language || 'en',
    source: existing.source || '', is_emergency: !!existing.is_emergency,
    role_tags: (() => { try { return JSON.parse(existing.role_tags || '[]'); } catch { return []; } })()
  } : { title: '', body: '', tier: 3, event_tag: '', language: 'en', source: '', is_emergency: false, role_tags: [] });

  const errorBlock = errorMsg ? `<div class="error">${escapeHtml(errorMsg)}</div>` : '';
  const tierOptions = [1, 2, 3, 4, 5].map(n => {
    const sel = n === Number(v.tier) ? 'selected' : '';
    const label = n === 1 ? '1 — most restricted' : n === 5 ? '5 — most open' : String(n);
    return `<option value="${n}" ${sel}>${label}</option>`;
  }).join('');
  const langOptions = [
    { val: 'en', label: 'English' }, { val: 'es', label: 'Spanish' }
  ].map(o => `<option value="${o.val}" ${v.language === o.val ? 'selected' : ''}>${o.label}</option>`).join('');
  const roleCheckboxes = allRoles.map(r => {
    const checked = v.role_tags.includes(r.id) ? 'checked' : '';
    return `<label class="check"><input type="checkbox" name="role_tags" value="${escapeHtml(r.id)}" ${checked}><span>${escapeHtml(r.display_name || r.id)}</span></label>`;
  }).join('');
  const emergencyChecked = v.is_emergency ? 'checked' : '';

  return new Response(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${heading} — TabReady</title>
  <style>
    body { font-family: -apple-system, sans-serif; background: #f5f5f5; margin: 0; padding: 24px; font-size: 16px; }
    .wrap { max-width: 640px; margin: 24px auto; }
    .back { color: #2563eb; text-decoration: none; font-size: 16px; font-weight: 700; padding: 12px 0; display: inline-block; text-transform: uppercase; letter-spacing: 0.5px; }
    h1 { margin: 12px 0 20px; font-size: 24px; text-transform: uppercase; letter-spacing: 0.5px; }
    .card { background: white; padding: 24px; border-radius: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.03); }
    .field { margin-bottom: 16px; }
    .field label.lbl { display: block; font-size: 12px; font-weight: 700; color: #374151; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.6px; }
    input[type=text], textarea, select { width: 100%; padding: 12px; font-size: 16px; border: 1px solid #ddd; border-radius: 8px; box-sizing: border-box; font-family: inherit; }
    textarea { min-height: 140px; resize: vertical; }
    .check { display: inline-flex; align-items: center; gap: 6px; margin: 4px 12px 4px 0; padding: 6px 10px; background: #f9fafb; border-radius: 6px; font-size: 13px; cursor: pointer; }
    .check input { margin: 0; }
    .checks-wrap { background: #fafafa; padding: 10px; border-radius: 8px; border: 1px solid #eee; }
    .help { font-size: 12px; color: #888; margin-top: 4px; }
    .error { background: #fee2e2; color: #991b1b; padding: 10px 14px; border-radius: 8px; margin-bottom: 16px; font-size: 14px; }
    .actions { display: flex; gap: 10px; margin-top: 20px; }
    .btn-primary { background: #2563eb; color: white; padding: 12px 24px; border: none; border-radius: 8px; font-weight: 700; cursor: pointer; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; }
    .btn-cancel { background: #f3f4f6; color: #1a1a1a; padding: 12px 24px; border: 1px solid #ddd; border-radius: 8px; font-weight: 700; text-decoration: none; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; }
  </style>
  <script>
    if (window.location.pathname !== '/') {
      history.replaceState({}, '', window.location.pathname);
      window.addEventListener('popstate', function() { window.location.href = '/'; });
    }
  </script>
</head>
<body>
  <div class="wrap">
    <a class="back" href="/content">← Back to Content</a>
    <h1>${heading}</h1>
    ${errorBlock}
    <div class="card">
      <form method="POST" action="${action}">
        <div class="field"><label class="lbl">Title</label><input type="text" name="title" value="${escapeHtml(v.title)}" required></div>
        <div class="field"><label class="lbl">Body</label><textarea id="body-field" name="body" required>${escapeHtml(v.body)}</textarea></div>
        <div class="field"><label class="lbl">Language</label><select name="language">${langOptions}</select></div>
        <div class="field"><label class="lbl">Tier</label><select name="tier">${tierOptions}</select><div class="help">1 = most restricted · 5 = most open.</div></div>
        <div class="field"><label class="lbl">Role tags</label><div class="checks-wrap">${roleCheckboxes}</div><div class="help">Pick at least one.</div></div>
        <div class="field"><label class="lbl">Event tag <span style="color:#dc2626;font-weight:700">— do NOT clear on flip chart codes</span></label><input type="text" name="event_tag" value="${escapeHtml(v.event_tag || '')}" placeholder="e.g. living_nativity_2026, sunday_morning, safety_flipchart"><div style="font-size:12px;color:#64748b;margin-top:4px">Groups this card by event/context. Flip chart codes MUST have <code>safety_flipchart</code> here or they disappear from the flip chart.</div></div>
        <div class="field"><label class="lbl">Source (optional)</label><input type="text" name="source" value="${escapeHtml(v.source || '')}" placeholder="e.g. living_nativity_packet, sunday_sop"></div>
        <div class="field"><label class="check"><input type="checkbox" name="is_emergency" ${emergencyChecked}><span>Mark as emergency</span></label></div>
        <div class="actions">
          <button class="btn-primary" type="submit">${isEdit ? 'Save changes' : 'Create content'}</button>
          <a class="btn-cancel" href="/content">Cancel</a>
        </div>
      </form>
    </div>
  </div>
  <script>
    // v2.8: if redirected from Tighten modal, prefill body from sessionStorage
    (function() {
      var qs = window.location.search;
      if (qs.indexOf('tightened=1') === -1) return;
      var match = window.location.pathname.match(/^\\/content\\/([^\\/]+)\\/edit$/);
      if (!match) return;
      var contentId = match[1];
      try {
        var key = 'tabready_tighten_prefill_' + contentId;
        var prefill = sessionStorage.getItem(key);
        if (prefill) {
          var bodyEl = document.getElementById('body-field');
          if (bodyEl) {
            bodyEl.value = prefill;
            sessionStorage.removeItem(key);
            // Scroll the body field into view and flash a hint
            bodyEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            var hint = document.createElement('div');
            hint.textContent = '✨ Body prefilled with tightened version. Review and click "Save changes" to apply.';
            hint.style.cssText = 'background:#ecfdf5;color:#065f46;padding:10px 14px;border-radius:8px;margin-bottom:14px;font-size:14px;font-weight:600;border:1px solid #a7f3d0';
            bodyEl.parentNode.insertBefore(hint, bodyEl);
          }
        }
      } catch (e) {}
    })();
  </script>
</body>
</html>`, { headers: { 'Content-Type': 'text/html' } });
}