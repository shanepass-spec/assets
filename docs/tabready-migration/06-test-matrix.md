# Deliverable 6 — Acceptance Test Matrix

Covers brief §18 + §11. **Mobile transition tests (M-*) must pass on real iPhone and Android devices before any
mass onboarding** (brief §11). "Automated" = can be scripted; "Device" = must be observed on a physical device.

## Legend
Result: ☐ not run · ✅ pass · ❌ fail · ⚠️ partial. Fill during Phase 5/6.

---

## E — Existing user (migration continuity) — brief §18 "Existing User Tests"

| ID | Test | Type | Pass criteria | Result |
|----|------|------|---------------|--------|
| E1 | Open old `tabready.shanepass.workers.dev/` | Device | Bridges to `tabready.thetabsrq.net/`, logged in | ☐ |
| E2 | Old deep link `…workers.dev/directory?x=1` | Automated | Lands on `…thetabsrq.net/directory?x=1` — **path + query preserved**, not homepage | ☐ |
| E3 | Session transfer w/ valid old cookie | Device | New church cookie issued; **no** email code, **no** QR, **no** re-onboard | ☐ |
| E4 | Identity stable across transfer | Automated | Same `usr_…` id before/after | ☐ |
| E5 | Roles unchanged across transfer | Automated | Role set identical to pre-migration | ☐ |
| E6 | Departments unchanged | Automated | Same ministry/content visibility | ☐ |
| E7 | No duplicate user created | Automated | `users` count == 157 (baseline) after test cohort logs in | ☐ |
| E8 | Existing home-screen icon still reaches TabReady | Device (iOS+Android) | Icon opens → old host → bridge → church host, logged in | ☐ |
| E9 | Transfer token is single-use | Automated | Replaying `__xfer` token is rejected | ☐ |
| E10 | Transfer token expires | Automated | Token older than TTL (≤60s) rejected | ☐ |

## M — Mobile / PWA transition — brief §11 (gate for mass onboarding)

| ID | Test | Type | Pass criteria | Result |
|----|------|------|---------------|--------|
| M1 | iPhone Safari saved **shortcut** | Device | Opens, bridges, logged in | ☐ |
| M2 | iPhone **installed PWA** (standalone) | Device | `start_url` (old host) → bridge → church host in standalone chrome | ☐ |
| M3 | Android Chrome saved shortcut | Device | Same as M1 | ☐ |
| M4 | Android **installed PWA** | Device | Same as M2 | ☐ |
| M5 | Desktop bookmark | Device | Path-preserving redirect | ☐ |
| M6 | Existing open session (not expired) | Device | Seamless handoff | ☐ |
| M7 | Expired session | Device | Falls through to login / Restore Access — no loop | ☐ |
| M8 | Cleared browser data | Device | Login or Restore Access works without Shane | ☐ |
| M9 | Lost-device restoration | Device | Restore Access on a new phone works; old sessions revocable | ☐ |
| M10 | Service-worker cache behavior | Device | SW deletes caches on activate; no stale old-host shell served | ☐ |
| M11 | Manifest `start_url`/`scope` on church host | Automated | Resolve to church host; install prompts correctly | ☐ |
| M12 | Icons + app name on church host | Device | "TabReady" + maskable icons render | ☐ |
| M13 | Installed app transitions to new host | Device | After bridge, subsequent same-origin nav stays on church host | ☐ |
| M14 | "Update your home-screen icon" prompt | Device | Offered **only when necessary**, driven by bridge telemetry | ☐ |

## N — New user onboarding — brief §18 "New User Tests"

| ID | Test | Pass criteria | Result |
|----|------|---------------|--------|
| N1 | New user gets an **individual** QR | One QR ↔ one person | ☐ |
| N2 | QR uses the **church** host | No `workers.dev`/personal host in payload | ☐ |
| N3 | QR activates the intended existing record | Correct `usr_…` activated | ☐ |
| N4 | QR cannot activate another person | Token bound to one user | ☐ |
| N5 | QR cannot be reused | `used_at` enforced on confirm | ☐ |
| N6 | Expired QR rejected safely | Clear error, no session | ☐ |
| N7 | Correct ministry roles appear | Only approved roles | ☐ |
| N8 | Unapproved roles do **not** appear | No leakage | ☐ |
| N9 | Link-copy matches reality | 7-day link actually lasts 7 days (fix §01.3 defect) | ☐ |

## R — Restore Access — brief §18 "Restore Access Tests"

| ID | Test | Pass criteria | Result |
|----|------|---------------|--------|
| R1 | Existing person gets a fresh recovery QR | Issued by authorized leader/admin | ☐ |
| R2 | Recovery creates **no** duplicate user | `users` count unchanged | ☐ |
| R3 | Recovery preserves permissions | Roles/departments intact | ☐ |
| R4 | Recovery works **without email delivery** | No dependency on Resend arriving | ☐ |
| R5 | Recovery token expires (~1 hr) | Rejected after TTL | ☐ |
| R6 | Recovery token single-use | Replay rejected | ☐ |
| R7 | Old sessions revocable when selected | `session_epoch++` invalidates prior tokens | ☐ |
| R8 | Audit record complete | All §15 fields present, no raw token stored | ☐ |
| R9 | "I previously had TabReady" creates a visible request | Leader sees the recovery request | ☐ |
| R10 | Code-request rate limit | Repeated requests throttled; real failures surfaced | ☐ |

## D — Delegated leader / helper scope — brief §18 "Delegated Leader Tests"

| ID | Test | Pass criteria | Result |
|----|------|---------------|--------|
| D1 | Children's leader assists approved Children's users | Allowed | ☐ |
| D2 | Children's leader **cannot** grant Youth/Safety/Staff/Facilities/admin | Denied server-side | ☐ |
| D3 | Youth leader limited to Youth | Cross-ministry denied | ☐ |
| D4 | Onboarding Helper **cannot** self-promote | Denied | ☐ |
| D5 | Helper cannot view confidential/pastoral content | Denied | ☐ |
| D6 | Shane retains admin oversight | Admin can do all; audit visible | ☐ |
| D7 | Scope enforced server-side (not just UI) | Direct API call with forged scope denied | ☐ |

## G — Migration integrity — brief §18 "Migration Tests"

| ID | Test | Pass criteria | Result |
|----|------|---------------|--------|
| G1 | Media DB record counts match source | users 157 / user_roles 227 / roles 15 / content 140 / registry 21 / all tables | ☐ |
| G2 | Internal user IDs stable | Byte-identical `usr_…` | ☐ |
| G3 | Roles & departments match | Per-user diff empty | ☐ |
| G4 | Required secrets + bindings exist in Media | DB, PHOTOS, DOCS, SESSION_SECRET, PROVISION_SECRET, PCO_*, RESEND, VAPID_*, ANTHROPIC, SCHEDULE_INTAKE | ☐ |
| G5 | Scheduled cron works in Media | Cache warm + digest fire; no PCO 429 | ☐ |
| G6 | Emails + integrations work | Resend from `thetabsrq.net`; PCO calls succeed | ☐ |
| G7 | Health endpoint reports expected version | `2.9.276`+ on church host | ☐ |
| G8 | Old deployment available for rollback | Personal Worker + DB intact | ☐ |
| G9 | Permanent domain → correct prod Worker | `tabready.thetabsrq.net` serves Media Worker | ☐ |
| G10 | Old personal host still bridges | Legacy links continue to reach church host | ☐ |
| G11 | R2 photo keys resolve on church host | Directory/incident photos load | ☐ |
| G12 | Digest email links use church host | `CANONICAL_BASE_URL` in emails | ☐ |

**Do-not-declare-done rule (brief §21):** G-tests passing is **not** sufficient. E-, M-, R- device tests on real
iPhone + Android are required before calling the migration complete.
