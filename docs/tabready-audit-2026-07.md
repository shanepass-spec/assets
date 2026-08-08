# TabReady Cleanup — Audit & Planning Report

**Prepared for:** Scout review → eventual elder presentation
**Date:** 2026-07-14
**Mode:** Audit and planning only. **No production edits, no deployment, no destructive cleanup** were performed. This document is the entire deliverable.
**Scope note:** Relay Roundtable / control-plane completion remains the active architecture priority. This report is a *plan*, not a build. Nothing here should be started ahead of the Scout–Builder–Relay loop, and it is deliberately staged so the quick wins are cheap and the large items (page redesign, bot rebuild) are gated behind decisions.

---

## 0. How this audit was done (and an important caveat)

TabReady is a single ~396 KB Cloudflare Worker (`workers/tabready/worker.js`, v2.9.36) that is a **rendering engine over data**, not a content store. Almost all of the "content" a volunteer sees — greeter instructions, reference cards, staff contacts, map descriptions — lives in a **D1 `content` table** and in **R2** (map images), *not* in the code. The code decides *how* things render and *who* can see them; the D1/R2 data decides *what* they say.

**This split matters for every finding below.** Several items in the source feedback describe things that are *not visible in the code* and therefore must be problems in the **live data** (which this audit can read only in part). Where that is the case, it is flagged explicitly and moved to the "must verify" list rather than asserted as fact. The most important correction:

> **Some of the feedback's assumptions are already handled well in the current build.** The greeter view is *not* a full inline emergency dump, the emergency codes are *already* single-source canonical, and the map cards are *already* image-first. The real defects are narrower and different from the initial hypotheses — which is the point of auditing before rebuilding.

Evidence was gathered by reading the worker source directly (file:line references throughout) and, for the codes/greeter area, cross-checking against the live production D1 (`dcadb25c-d503-45a7-9e29-254c2d5f50e5`).

---

## 1. Current UX / content problems (evidence-based)

### 1.1 Facilities directory / people contacts

| # | Problem | Evidence | Type |
|---|---------|----------|------|
| A | **Contact records are thin.** A person has only `display_name`, `phone`, `email`. No address, no "text vs call" distinction, no title/role. | `apiTeamDirectory` SELECT — `worker.js:554‑561` | Data model |
| B | **Email is fetched but never shown.** Directory pills render name + phone only; the `email` column is selected and discarded. | pills at `worker.js:5627‑5648`; `email` unused | UX |
| C | **No "Full Directory" view.** The only presentation is collapsed per-team cards → a pill grid. There is no all-people list, no A–Z, no search-within-directory beyond global search. | `directoryCardHTML` `worker.js:5618‑5667`; no `Full Directory` string exists | UX |
| D | **No "Save Contact" / vCard / Add to Phone.** Phone is a `tel:` link only; no `mailto:` in the directory, no vCard export anywhere. | `tel:` pill `worker.js:5635`; searched `vcard`/`Save Contact`/`Add to Phone` → 0 matches | Feature gap |
| E | **"Direct contact to be added" / Ostertag placeholder is NOT in the code.** It lives in **live D1 content**, so it is a data-correction item, not a code fix. | grep `Ostertag`/`Direct contact to be added` → 0 matches in source | **Content (verify)** |
| F | **The directory is one canonical D1 endpoint, but it is consumed by ≥3 divergent, copy-pasted renderers, plus a separate un-linked free-text contact channel.** See §3.1. | see §3.1 | Data architecture |

### 1.2 Greeter daily view — **better than feared, but with a real bug**

- The greeter packet (`greeter_sunday_basics`, "Greeter Sunday Morning Basics", ~1.8 KB) is **well structured**: it has `BEFORE SERVICE`, `WHEN GUESTS ARRIVE`, `DURING SERVICE`, `AFTER SERVICE`, an "If Something Seems Off" section, explicit instructions to find a Safety Team member (cobalt-blue shirts), and a **one-line summary of each code + a pointer** — *not* a full inline protocol dump. This is the good pattern the feedback was asking us to move toward. It is already here.
- **Minor redundancy only:** "Find a Safety Team member immediately" appears twice; the Welcome Center Team Leader escalation is stated three times. This is light cleanup, not the "long scrolling from repeated content" described.
- **The real defect — a broken cross-reference / access mismatch:** the greeter packet says *"See the Codes flip chart for full detail,"* but the greeter role **cannot open it**:
  - Codes tab is hidden unless `USER_CAN_SEE_CODES` (admin/safety only) — `worker.js:4208`, flag at `worker.js:3110`.
  - `/api/codes` hard-403s non-safety — `worker.js:602`.
  - Flip-chart rows are stripped from `/api/content` for non-admins — `worker.js:589`.
  - The `fc_*` rows even carry `role_tags` that *include* `"greeters"`, but those tags are **vestigial** — they grant no access because two other gates block it. A greeter is told to use a resource the system forbids them from opening.

### 1.3 Maps & building reference

- **Map cards are already image-first.** `renderMapGrid` (`worker.js:4933‑4941`) renders thumbnail (or a PDF tile) **first**, then a clean human-readable name + a type tag (Evacuation/Fire/etc.). **No filename, author, year, or provenance narrative appears** on the Maps tab.
- **Therefore the "map-note page leads with archival details instead of the map" problem is a *content-data* problem, not a Maps-tab problem.** It almost certainly refers to an authored **Reference content packet** (free text in D1, rendered via `packetize(linkifyContent(...))`) that *describes* a map with prose like source/author/year before the image. That is curation of D1 content, not a code change. **Must be confirmed against live data (verify list §8).**
- **No full-screen modal and no download button** on maps. The only "view large" affordance is opening the raw R2 object in a new tab (`<a href target="_blank">`, `worker.js:4934`). Full-screen + download are genuine feature gaps.
- **Storage is single-source, but the folder split invites confusion.** Maps are R2 objects in one bucket (`env.PHOTOS`) under two prefixes: `facilities-map/` (broad) and `facilities-map-safety/` (restricted). There is **no per-team mirroring** — each map exists in exactly one folder. Metadata (building/type/name) is **encoded into the R2 key** and parsed back out (`prettyMapName` `worker.js:1926‑1946`); there is no D1 table for maps, so the filename *is* the database.

### 1.4 Emergency codes — **already canonical**

- Codes are a single set of D1 rows (`event_tag='safety_flipchart'`, ids `fc_00`…`fc_22`) owned by the Safety Codes tab. Colors/sections are **derived from the id** (`codeColorForId` `worker.js:618`, `sectionForId` `worker.js:672`), not re-authored per team.
- **No cross-team protocol duplication exists.** The greeter packet holds only one-line summaries. The feedback's goal ("full reference belongs in Safety, links from Greeters") is **structurally already true** — what's missing is *making the greeter's link actually work* (see §1.2).

### 1.5 AI bot — see §5 (full assessment)

---

## 2. Proposed information architecture

The target is **one canonical record per kind of thing, many role-scoped views by reference.** Concretely:

```
CANONICAL SOURCES (one each)
├── People/Contacts   → D1 `users` (+ `user_roles`)          [single source of truth for "who / how to reach"]
├── Maps              → R2 map objects (broad / safety split) [single source; keyed by building__type__name]
├── Safety procedures → D1 `content` event_tag=safety_flipchart (fc_00–fc_22) [already canonical]
├── Reference content → D1 `content` (role_tagged packets)   [already canonical, needs curation]
└── Bot knowledge     → the SAME D1 content above            [stop drift: no separate knowledge store]

ROLE VIEWS (assembled by reference, never by copy)
├── Facilities/Homebase → master maps + full directory + building reference
├── Greeters            → greeter packet + Safety-contact + WORKING link into codes
├── Safety              → owns codes flip chart + emergency maps + safety directory
└── Admin               → everything + provenance/history fields + change-request queue
```

**Governing rules:**
1. A person, a map, a code, or a reference card is **defined once**. Team views point at it; they never hold their own copy.
2. **Provenance is admin-only metadata**, never the lead of a user-facing view (§4).
3. **Access follows the reference:** if a role's content links to a resource, that role must be able to open it (the greeter/codes bug is the canonical violation).
4. **Dead/dormant paths are retired or clearly quarantined**, not left to masquerade as live features (the PCO `my-team` path, vestigial `greeters` tags on `fc_*`).

---

## 3. Recommended canonical sources

### 3.1 People / contacts — **converge on D1 `users`, retire the competing renderers**

Today the *data* is already canonical (one D1 endpoint, `/api/team-directory`), but it is consumed four+ ways, three of which are copy-pasted or dead:

1. **My Team** cards — `directoryCardHTML` `worker.js:5618‑5667` ✅ keep as the base renderer.
2. **Safety Team Directory** — `loadSafetyDirectory` `worker.js:5716‑5769`, a near-verbatim copy of #1 hardcoded to `role=safety`. → **Collapse into #1** (pass a role param).
3. **Global search "Person" index** — `ensureSearchData` `worker.js:6134‑6150`, a third consumer flattening the same endpoint. ✅ acceptable (search index), keep.
4. **Legacy PCO `my-team`** — `/api/my-team` + `PCO_GROUP_MAP` `worker.js:219‑229` (commented out), "still in the worker for future use but no longer called" (`worker.js:117‑119`). → **Retire or clearly quarantine.** It returns `pco_not_configured` and confuses the picture.

Plus a **fifth, unlinked channel:** contacts typed as **free text inside content bodies**, turned into pills by `pillifyContacts` (`worker.js:6019‑6048`) and `content-tile-phone` (`worker.js:4648`). These are regex-parsed prose (e.g. `Lead: Eric Wyrosdic — (941) 228‑2656`) with **no link to the `users` table** — the same person can exist as a D1 user *and* as hand-typed text, able to drift apart. → **Decide a policy** (see §8): either (a) treat D1 `users` as the only contact source and strip inline contacts, or (b) keep inline contacts for non-user vendors but never for staff who exist in `users`.

**Canonical people source recommendation:** D1 `users` + `user_roles`, extended with the missing fields (address optional, title, preferred contact method). Everything else references it.

### 3.2 Maps — keep R2 single-source; add a thin metadata layer

Keep one R2 bucket with the broad/safety split. The current "filename *is* the database" approach works but makes provenance and titles brittle. **Option (deferred, not now):** a small D1 `maps` table keyed to the R2 object for title, operational instructions, and admin-only provenance — so the user view can lead with a clean title + instructions while provenance stays in admin fields. Until then, do **not** duplicate maps into team folders.

### 3.3 Safety procedures — already canonical, leave the source alone

`safety_flipchart` rows (fc_00–fc_22) are the single source. **Do not touch the data**; fix only the *access path* so linked-in roles (greeters) can reach the full detail.

### 3.4 Bot knowledge — the SAME D1 content, not a parallel store

The bots already read the shared D1 `content` / `CONTENT_DB`. The drift risk is in **hardcoded prompts and baked-in facts**, not the data (§5). Canonical rule: **facts live in content; prompts hold only voice/behavior.**

---

## 4. Role-based page recommendations

### Facilities / Homebase (the operational hub)
- **Full Directory** entry point (all people, A–Z, searchable), in addition to per-team cards.
- Master maps + building reference live here; other teams link in.
- Rich contact actions: call, text (`sms:`), email (`mailto:`), **Save Contact (vCard)**.

### Greeters
- Keep the current well-structured daily packet.
- **Fix the codes link so it actually opens** for greeters — the single highest-value greeter change (see §7 Quick wins for the two clean options).
- Trim the 2–3× repeated escalation lines.
- Show only the map(s) relevant to greeter duties, by link — not a copy.

### Safety
- Owns the codes flip chart and emergency maps (already true).
- Safety directory folds into the unified directory renderer (§3.1 #2).
- Emergency maps link directly from here.

### Administrators
- Provenance/history fields (source filename, author, year, internal notes) visible **here only**.
- Change-request queue already exists (`change_requests` D1 table + admin email, `worker.js:1198‑1276`) — make it the intake for all content corrections found in this audit.

### Map-page presentation standard (all normal-user views)
Lead with, in order: **(1) the map image, (2) operational title, (3) short instructions matching visible symbols, (4) full-screen / download, (5) relevant emergency contacts/links.** Hide from normal view: source filename, author, year, provenance, and narrative "this map shows…" text — preserved in admin/history fields, never retired.

---

## 5. AI-bot weakness assessment & redesign options

### 5.1 What exists (four assistants, not one)

| Worker | Role | LLM |
|--------|------|-----|
| `tab-website-ai` | Public website Q&A; the canonical doctrinal engine | Claude Haiku 4.5 |
| `tabready` "Tab" | The bot embedded **in TabReady** (`/api/ask`); routes some Qs out to `tab-website-ai`, else answers locally | Claude Haiku 4.5 |
| `jennie-gateway` | Single-user pastor assistant ("Ask Jennie"); not in TabReady | Claude Haiku 4.5 |
| `jennie-lite` | Deterministic field console (Living Nativity); **no LLM** | — |

The bot a TabReady user talks to is **"Tab"** (`apiAsk`, prompt `worker.js:942‑970`, model `worker.js:986‑998`). It filters content by role server-side, then conditionally forwards doctrinal/connect/events/staff questions to `tab-website-ai` (`forwardToWebsiteAI` `worker.js:830‑849`), falling back to a local Claude call.

### 5.2 Weaknesses (evidence)

1. **Knowledge is largely canonical, but prompts and facts are duplicated and will drift.** The website bot and Tab have **two independently-authored system prompts** for the same church (`tab-website-ai:802‑1116` vs `tabready:942‑970`). Editing one does not update the other.
2. **Hardcoded contact facts in multiple places, guarded by a hallucination filter.** Phone/address/surname are baked into the prompt, into `SAFE_FALLBACK` constants, **and** into a regex filter that *blocks any phone ≠ 941‑355‑8858 or address not containing "4141 DeSoto"* (`tab-website-ai:9‑11, 335, 359`). If the church's number/address ever changes, several spots must change together **or the filter will actively suppress the correct new info.** This is the single most dangerous piece of hidden coupling.
3. **Hardcoded fallback schedule** (`tab-website-ai:557‑563`: Sun 9:00/10:15, Wed 6:45) — used when the DB returns no rows; silently stale.
4. **Hardcoded doctrinal framing** not in the DB ("376+ sermons", named guest-series carve-outs, priority ordering) — drifts from the live site.
5. **No page awareness, thin role awareness.** The front end sends only `{ question, history }` (`worker.js:5459`). Role is applied by *filtering content*, never stated to the model. The bot never knows what page you're on or who you are by name/team.
6. **Answer-only. No tool use / actions / navigation** in any LLM bot (no `tools:`/`tool_use` anywhere). Tab cannot take a user to a record or perform a workflow.
7. **The staff-list rule concedes non-authority** — Tab tells users to go to the website "which has the complete and current staff listing" (`worker.js:962`): an explicit admission its own copy can be stale.

**Positive:** uncertainty handling is already designed in — all three LLM bots have explicit "don't fabricate / say you don't know" instructions, and `tab-website-ai` enforces it with a post-generation filter.

### 5.3 Redesign options (do **not** start a rebuild now — decision-gated)

- **Option A — Minimal de-drift (cheap, low risk).** Extract church facts (phone, address, schedule) into **one shared config or content row** consumed by every bot; delete the duplicate hardcoded copies; make the hallucination filter read from that source instead of a literal. Unifies the two system prompts into one shared "voice" block. No architecture change.
- **Option B — Grounded + context-aware (medium).** Pass role + current page into Tab's context; ground every answer in the shared D1 content only; remove hardcoded doctrinal/schedule blocks. Keep answer-only.
- **Option C — Agentic (large, later).** Add scoped, permissioned, auditable tool-use so Tab can navigate to a record or start a workflow — only where safe and useful. **Explicitly out of scope for this phase.**

Recommended sequencing: **A now-ish (small), B during the page redesign, C only after Relay Roundtable ships and the redesign settles.**

---

## 6. Reusable design standards (portable to Foundation School & other tools)

These are extracted as standards *because they should be reused* — but the apps stay separate (TabReady, Foundation School, Foundation Workorders each keep their own purpose, permissions, DB, and source of truth; do **not** merge them or copy TabReady wholesale).

1. **Role-based daily views** — one colored box per team; short 6-second tiles → detail (`renderRoleBoxes` `worker.js:4503`). Good pattern; carry forward.
2. **One canonical record, many views by reference** — never copy data across team views.
3. **Provenance is admin metadata, not user-facing lead.**
4. **Access follows the reference** — if a view links to X, that role can open X.
5. **Consistent contact actions** — call / text / email / Save Contact, everywhere a person appears.
6. **Complete directories** — no "to be added" placeholders in normal view once real data exists.
7. **Link to the hub, don't duplicate** — maps/procedures/people referenced, not mirrored.
8. **Bot facts live in content, prompts hold only behavior** — no parallel knowledge store.
9. **Retire dead paths** — don't leave dormant integrations posing as features.
10. **Change-requests as the correction intake** — reuse the existing `change_requests` pattern.

---

## 7. Phased cleanup plan

> Ordered cheapest-safest first. **Nothing here preempts Relay Roundtable.** No production edits are proposed in this document; each phase below is a *future* unit of work to be scheduled after the active priority.

### Phase 1 — Quick corrections (low risk, mostly data/small code)
- **Greeter → codes access fix** (highest value). Two clean options — pick in §8:
  (a) give greeters read-only access to the flip chart (adjust the 3 gates: `worker.js:589, 602, 4208`), or (b) create a tiny greeter-visible "codes summary" reference card and repoint the greeter packet's link to it. Do **not** duplicate the protocols.
- **Data corrections** via change-request queue: fill David Ostertag's real contact; remove "Direct contact to be added" once verified; fix any Reference "map-note" cards that lead with provenance (move prose to admin note, lead with the map).
- Trim the 2–3× repeated escalation lines in `greeter_sunday_basics`.
- Surface `email` in directory cards (already fetched, just unused).

### Phase 2 — Consolidation (code, no schema change)
- Collapse the Safety directory renderer into the shared `directoryCardHTML` (§3.1 #2).
- Retire or quarantine the dormant PCO `my-team` path and vestigial `greeters` tags on `fc_*`.
- Decide + apply the inline-contact-vs-D1-user policy (§3.1 #5).
- Add contact actions: `sms:`, `mailto:`, and vCard "Save Contact".

### Phase 3 — Page redesign (larger; needs a design pass)
- Facilities "Full Directory" view + Homebase as the maps/reference hub.
- Map-page presentation standard (§4): image-first, title, instructions, full-screen/download, contacts. Introduce the thin D1 `maps` metadata layer (§3.2) if adopted.
- Role-scoped map links instead of blanket visibility.

### Phase 4 — AI-bot work (decision-gated; **no rebuild started**)
- Option A de-drift (extract shared facts; unify voice; fix the hallucination filter's hardcoded literals).
- Then Option B (role/page context, fully grounded) alongside the redesign.
- Option C (agentic) only later.

---

## 8. Questions / data to verify before any implementation

1. **Ostertag / "Direct contact to be added":** confirm this is live D1 content (not code) and provide the correct phone/email/text preference. *(Not found in source.)*
2. **The "map-note page that leads with provenance":** which exact page/card? Confirm it is a **Reference content packet** (D1), not the Maps tab (which is already image-first). Provide the card id.
3. **Inline contacts vs D1 users (§3.1 #5):** policy decision — strip inline free-text contacts for anyone who exists in `users`, or keep them for vendors/non-users only?
4. **Greeter codes access (§7 Phase 1):** grant greeters read access to the flip chart, or give them a separate summary card? (Affects safety-content exposure — likely a Safety/elder call.)
5. **PCO `my-team` path:** retire it, or is PCO integration still planned? If planned, when?
6. **Contact fields to add:** address? title/role? preferred contact method? SMS-capable flag per number?
7. **Map metadata layer:** adopt a thin D1 `maps` table (title + instructions + admin provenance), or keep filename-encoding?
8. **Full directory scope:** all people church-wide, or only teams the viewer belongs to? (Permission implications.)
9. **Bot facts source (§5 Option A):** where should the single church-facts record live — a D1 config row, or a designated `content` row? Who owns edits?
10. **AI-bot boundaries:** confirm answer-only for now; confirm Option C (agentic actions) is explicitly deferred.

---

## 9. Change separation (so each type routes to the right approval + risk path)

| Category | Examples from this audit | Risk / gate | Touches |
|----------|--------------------------|-------------|---------|
| **Content corrections** | Ostertag contact; remove "to be added"; fix provenance-first map notes; trim greeter repetition | Low; via `change_requests` queue; **no deploy** | D1 data only |
| **UX changes** | Full Directory view; contact action buttons; show email; map-page presentation; full-screen/download | Medium; needs code + design review | `tabready` worker code |
| **Data-architecture changes** | Collapse duplicate directory renderers; retire PCO path; inline-contact policy; optional D1 `maps` table | Medium–high; may need schema/migration | worker code + D1 schema |
| **AI changes** | Extract shared facts; unify prompts; fix hallucination-filter literals; role/page context; (later) agentic | Medium now → high later; **no rebuild** | `tab-website-ai` + `tabready` bot code |
| **Deployment changes** | Any of the code items above | **`.github/workflows/deploy.yml` auto-deploys any `workers/**` push to `main`.** So code changes ship the moment they merge. Keep this audit branch off `main`; land code items only when intended to go live. | CI/CD |

---

## Constraints honored

- ✅ No production edits, no deployment, no destructive cleanup performed.
- ✅ No preserved knowledge removed — items are marked "hide from normal view / preserve in admin," never "retire the knowledge."
- ✅ No new duplicate sources of truth proposed; the direction is *fewer* sources.
- ✅ No bot rebuild started; bot work is decision-gated and staged.
- ✅ Relay Roundtable remains the active priority; this is a plan, not a build.
- ✅ TabReady, Foundation School, and Foundation Workorders remain separate systems; only *design standards* are shared, not code or databases.

## Content classification key (for the per-item pass, §5 of the request)

Apply to each existing content item during Phase 1–2 curation:
**Preserve · Correct · Consolidate · Simplify · Hide-from-daily-view · Link-by-role · Retire.**
A worked example: the `fc_*` codes = **Preserve** (data) + **Link-by-role** (fix greeter access); greeter escalation repetition = **Simplify**; map-note provenance prose = **Hide-from-daily-view** (move to admin, don't Retire); PCO `my-team` path = **Retire** (dead code); Ostertag placeholder = **Correct**.
