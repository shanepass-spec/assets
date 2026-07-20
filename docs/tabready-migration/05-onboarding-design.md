# Deliverable 5 — Onboarding, Recovery & Delegation Design

Design for the five flows the brief requires, mapped onto what already exists (Deliverable 1) so the build is
**additive** and non-regressive. Guiding rule (brief §2): **every user keeps one individual identity** — their
internal `usr_…` id — and changing an email or phone must never create a new identity or drop permissions.

## 0. What already exists vs. what must be built

| Capability | Today | Build |
|---|---|---|
| Individual identity (`users.id`, roles, audit) | ✅ | Keep; forbid duplicate creation in every new flow. |
| Admin-created accounts + magic-link/QR | ✅ (`apiAdminCreateUser`, `apiAdminOnboardLink`) | Reuse the mechanism. |
| Machine provisioning | ✅ dormant (`apiProvision`, secret-gated, adds-only, never admin) | Reuse as the batch engine. |
| Member / Volunteer / Admin tiers | ✅ (base tile set / role tags / `is_global_admin`) | Keep. |
| **Restore Access** (recovery ≠ onboarding) | ❌ | **New.** |
| **"I previously had TabReady"** on login | ❌ | **New.** |
| **Onboarding Helper** (scoped, non-admin) | ❌ | **New** — biggest build. |
| **Ministry Leader** scoped onboarding | ⚠️ ~30% (`team_lead_user_id` view-scope + `team_leader` schedule-write, on two disjoint mechanisms) | **Unify + extend.** |
| **Batch onboarding / roster import** of accounts | ❌ (PCO sync ≠ account creation) | **New** (built on provision). |
| **General-member self-service** | ❌ | **New.** |
| Session revocation / lost-device | ❌ | **New** (Deliverable 4 §5). |

## 1. Initial Onboarding (person never activated)

Keep today's flow; make it delegable and church-domain correct.
1. Approved `users` record exists (created by admin, leader, helper, or batch — §5/§6).
2. Roles/departments assigned **before** activation (as today, `assigned_by` recorded).
3. Personal onboarding QR / link generated — **single-use, 7-day, church host** (fix the 15-min vs 7-day defect,
   §01.3).
4. Person scans/taps → `handleAuthVerifyConfirm` activates the **existing** record.
5. Persistent session established (400-day rolling cookie).
6. Home-screen install instructions shown (existing install helper, iOS/Android aware).
7. Credential consumed (`used_at`) — unusable after success.

## 2. Restore Access (person had TabReady, lost the device/login) — **new**

A first-class admin **and delegated-leader** action, distinct from onboarding — it never routes a returning person
through new-person creation.

**Flow (brief §3):**
1. Authorized leader/helper/admin **locates the existing person** (search within their scope).
2. Selects **Restore Access**.
3. System mints a **temporary, single-use recovery credential** (QR + clickable link), **~1 hour**, revocable,
   fully audited — reuse the magic-link engine with a `purpose='restore'` tag.
4. Person scans/taps → confirms the **existing** identity.
5. **Existing roles/departments retained unchanged.**
6. Fresh persistent session established. **No email code required. No duplicate user.**
7. Optionally **revoke old device sessions** (Deliverable 4 §5 `session_epoch++`) — for lost/stolen phones.
8. Credential consumed on use.

**Endpoint sketch:** `POST /api/restore/{personId}` → returns `{ login_url, qr_svg }`; gated by
`canOnboard(actor, personId)` (§4). Mechanically ≈ existing relink, but **scoped, purpose-tagged, revocation-
capable, and delegable** rather than global-admin-only.

## 3. Kill the email-code loop — **new login-screen path**

Add to `loginPage()` a clear **"I previously had TabReady"** option (brief §4). It does **not** rely on email
delivery:
- The user identifies themselves; the system **locates an existing account without revealing whether arbitrary
  people exist** (brief §16 — always respond neutrally).
- If automated verification can't complete, it creates a **visible recovery request** for the appropriate
  authorized leader:
  > *Sarah Jones — existing Children's Ministry volunteer — requesting access restoration.*
- The leader verifies the person and issues a **Restore Access** link/QR (§2).
- Add a **rate limit on code *requests*** (today only verify is capped, `worker.js:1461`) and surface real send
  failures instead of always returning generic success (`worker.js:1440`) — so the loop can't recur silently.

## 4. Delegated permission model — **new tiers + unify existing primitives**

Extend the current model (which cleanly supports Member / Volunteer / Admin) with two scoped tiers. Authorization
stays **server-side** on every mutation (brief §16); `assigned_by` — recorded today but never checked — becomes an
input to a real scope check.

| Tier | Can | Cannot |
|---|---|---|
| **Member** | Use approved general resources. | Ministry/sensitive content. |
| **Ministry Volunteer** | Access resources for their approved roles. | Manage anyone. |
| **Onboarding Helper** *(new)* | Within assigned ministries: locate approved people, show/regenerate onboarding QR, issue **Restore Access**, confirm activation. | Create unrestricted users, assign sensitive roles, act outside assigned ministries, view confidential/pastoral content, **self-promote**, change system settings. |
| **Ministry Leader** *(unify)* | Review their ministry roster, approve volunteer access **within their ministry**, assign **allowed** ministry roles, generate initial invites, **Restore Access** for their ministry, review status. | Grant Safety/Facilities/Staff/Elder/admin or any unrelated department. |
| **TabReady Admin** | Everything: cross-department, exceptions, sensitive perms, audit, session revocation, config. | — |
| **Shane** | Governance/oversight/exceptions/sensitive decisions/audit. | Is **not** required for routine setup or login restoration. |

**Core new authorization primitive** — a single scope check used by every delegated action:

```
canOnboard(actor, targetPersonId, requestedRoles):
  - actor is TabReady Admin  → allow (any role)
  - actor is Ministry Leader/Helper for ministry M:
        target must be in-scope for M
        every requestedRole ∈ ALLOWED_ROLES[M]   (never 'staff','elders','safety','facilities',
                                                   'is_global_admin', or cross-ministry)
        actor may never grant a role they don't lead
  - else → deny
```

Build notes:
- **Unify delegation.** Today "leads a ministry" is split between `roles.team_lead_user_id` (directory view,
  `worker.js:8064`) and the `team_leader` role (schedule write, `worker.js:10648`). Introduce one canonical
  **ministry↔leader↔allowed-roles** model (extend `roles` / add a `ministry_scope` table) so a leader's onboarding
  powers derive from a single source. Support **multiple leaders per ministry** and **helper grants**.
- **Self-promotion guard (explicit).** Today safety relies on there being *no* non-admin write path. Once
  delegated writes exist, hard-block: granting `is_global_admin`, granting outside `ALLOWED_ROLES[M]`, and
  assigning to oneself a role one doesn't already lead. Follow the provisioner precedent that hard-codes
  `is_global_admin=0` (`worker.js:3592`).
- **Sensitive departments** (Safety, Facilities, Staff, Elder, Pastoral, confidential directory) require explicit
  TabReady-Admin approval — never a Helper/Leader grant.

## 5. Batch / mass onboarding — **new, built on provision**

Reuse the **dormant `apiProvision` engine** (idempotent upsert-by-email, adds-only, never admin) as the per-person
primitive; add a batch orchestration layer for authorized admins/leaders (brief §6):
1. Import/select an **approved roster** (CSV or PCO group).
2. **Match to existing `users`/`people_registry`** records — **prevent duplicates** (email/phone match first).
3. Assign **allowed** department roles (scoped by `canOnboard`).
4. Generate **individual** onboarding credentials in bulk (each QR belongs to **one** person — brief §6).
5. Print individual QR cards / send private links by text or email.
6. Track status.

**Status model** (brief §6): `record_created · awaiting_approval · approved · invite_not_generated ·
invite_ready · invite_sent · activated · needs_help · restore_requested · access_restored · disabled`. Store as
a column on the person/onboarding row; drive the leader dashboard from it.

## 6. General-member self-service — **new, general access only**

Simpler public path (brief §7), granting **only** general-member access:
1. Person scans a **public information QR**.
2. Enters identifying + contact info.
3. System attempts a match to an existing church record (PCO/registry) — neutral responses only.
4. Grants **general-member** access only (campus maps, general announcements, public emergency info, approved
   general resources, directory only where privacy rules allow).
5. **Any** ministry/sensitive access requires separate approval.

A public QR must **never** auto-grant Children's, Youth, Safety, Facilities, Staff, pastoral, admin, or
confidential-directory access (brief §7). Enforce server-side: the public path can write **only** a general-member
role and nothing in `ALLOWED_ROLES` for any ministry.

## 7. Audit model (brief §15)

Record every security-sensitive onboarding/recovery action in `audit_log_v2` (already present) with:
person affected · **existing internal user id** · action type (`onboard` | `restore`) · credential
generated/expires/used/revoked times · issuing leader/admin · ministry scope · device/session revocation flag ·
success/failure + reason · old→new host transfer event · new-host session creation · `VERSION`.

**Never** store raw reusable credentials or secrets in the log (store hashes / references only) — brief §15/§16.

## 8. Security requirements checklist (brief §16) — how each is met

- Random, unguessable credentials → 244-bit magic tokens (existing); recovery/transfer likewise.
- Store **hashes** where practical; the external incident-share path already hashes tokens (SHA-256, `worker.js`
  `/r/:token`) — apply the same to recovery tokens rather than storing raw.
- Expiry on all credentials (existing constants); recovery ~1 hr; transfer ≤60 s; **all single-use**.
- Credentials tied to **one** user + **one** action (purpose tag).
- Role checks **server-side** (existing pattern); add `canOnboard` scope.
- Helpers stay **ministry-scoped**; no self-promotion; sensitive departments gated to Admin.
- Lost devices → session revocation (`session_epoch`).
- **Rate-limit** activation/recovery **requests** (new — closes the code-loop hole).
- **Don't reveal** whether arbitrary people exist (neutral responses everywhere).
- Don't put sensitive data in query strings except the short-lived single-use transfer design.
- Never log session cookies, secrets, or full tokens.
