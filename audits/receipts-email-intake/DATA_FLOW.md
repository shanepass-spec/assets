# DATA_FLOW.md — receipts-email-intake

Traced from the deployed bundles (2026-07-24). Function names/line refs are to
the preserved copies in [`deployed/`](deployed/) and the downstream `receipts`
bundle.

## Happy path (v1.2 personal)

```
Sender forwards receipt email
        │
        ▼
Cloudflare Email Routing  ──delivers──►  receipts-email-intake.email(message,env,ctx)
        │                                        │
        │                                        ▼   ctx.waitUntil(process(message, env, message.to))
        │                          ┌─────────────────────────────────────────────┐
        │                          │ readEmailRaw(message)  (≤15MB, TextDecode)   │
        │                          │ sender = extractSenderEmail(getHeader From)  │  ← From header, NOT authenticated  (F-02)
        │                          │ if !senderAllowed(sender,env) return         │  ← default OPEN when unset          (F-03)
        │                          │ att = extractBestAttachment(raw)             │  ← image/* | pdf | octet-stream     (F-05,F-06,F-07)
        │                          │ if !att return                               │  ← else silent drop                 (F-13)
        │                          │ if att.b64 > 14MB return                     │
        │                          │ memo = extractMemo(extractBodyText(raw))     │
        │                          │ intent = detectIntent(to, subject, memo)     │  ← attacker-controllable            (F-04)
        │                          └──────────────────┬──────────────────────────┘
        │                                             ▼
        │                     POST {RECEIPTS_URL}/api/intake                       ← response IGNORED, no retry         (F-13)
        │                     x-intake-secret: env.INTAKE_SECRET || <literal>       ← hard-coded fallback secret          (F-01)
        │                     { from_addr, to_addr, intent, subject, memo,
        │                       filename, content_type, image_base64 }
        ▼
receipts worker  handleEmailIntake(request, env)                     [downstream, receipts.shanepass.workers.dev]
        │  secret !== (env.INTAKE_SECRET || <same literal>)  → 403    ← same fallback secret                            (F-01)
        │  id = crypto.randomUUID()
        │  r2key = pending/<id>.<ext>            ── BUCKET.put(...) ──►  R2 receipts-files    ← non-guessable key (good)
        │  owner = single active user matching lower(from_addr)         ← From decides owner                            (F-02)
        │  status = owner ? 'pending' : 'unassigned'
        │  INSERT pending_email_receipts(...)  ── D1 receipts ──►                             ← R2.put THEN D1.insert    (F-14)
        ▼
In-app review:  GET /api/pending  →  GET /api/pending/:id/image (owns|admin+unassigned)      ← serves stored bytes
                POST /api/pending/:id/promote  → sniffMediaType → parse → INSERT receipts     ← promote sniffs bytes (good)
                                                                                                 but /image serves raw  (F-05,F-09)
```

## v1.0 (church) differences
- `extractAllAttachments` → forwards **every** attachment (loop of POSTs);
  `dedupeAttachments` only collapses duplicates **within one email**.
- If no attachment: `extractBody` captures the raw HTML/text body and POSTs it as
  `content_type:'text/html'`, `body_html:<raw, unsanitized>` → stored as
  `pending/<id>.html` and later served by `/api/pending/:id/image` with
  `Content-Type: text/html` **inline**. (F-09)

## Trust boundaries
1. **Internet → Email Routing → worker.** Only transport auth (SPF/DKIM) exists at
   Cloudflare; the worker does **not** consult it. Everything after is
   attacker-influenced: `From`, `To` local-part, subject, body, attachment
   headers/bytes/filename.
2. **Worker → downstream.** Static shared secret (with in-source fallback).
3. **Downstream → user.** Session/PIN gated for reads; ownership enforced on
   pending read/promote/discard. Intake write path is **not** user-gated.

## Storage/DB outcome per accepted attachment
- 1 R2 object `pending/<uuid>.<ext>` + 1 `pending_email_receipts` row.
- `BUCKET.put` runs **before** the `INSERT`; the INSERT is not wrapped to undo the
  R2 object on failure ⇒ possible orphan object (F-14, downstream).
