# Curriculum Manager (`tab-curriculum-upload`)

The one page you use each quarter to get Sunday School curriculum in front of
your teachers. It writes into the same R2 bucket (`tab-curriculum`) that the
teacher-facing viewer (`tab-curriculum`) reads from.

**Live URL:** https://tab-curriculum-upload.media-ffd.workers.dev/
**Teacher view:** https://tab-curriculum.media-ffd.workers.dev/

---

## For the person doing the upload (plain English)

There are **three steps**, all on one page:

1. **Upload** — Unzip the curriculum package first, then drag the whole folder
   onto the drop box. The files land in a *staging* area (`_incoming`) and are
   **not** visible to teachers yet. (This is why nothing "went live" before —
   uploading is only step 1.)

2. **Review** — Tap **"Check what's waiting to publish."** The tool reads the
   package's manifest and shows you exactly what will go live: which quarter
   (e.g. *Fall 2026*), how many lessons and files are ready, and anything
   that's missing. Nothing is written during review.

3. **Publish** — Tap **"Publish … to teachers."** The tool copies the staged
   files into the live quarter folder and teachers see it in the app right
   away. You'll get a link to check the teacher view.

**Access code:** the first time you open the page it asks for a code. Paste it
once; the device remembers it. (It's the token on your bookmarked link.)

### Safety rails
- Uploading never touches the live quarter — publishing is a separate, deliberate tap.
- A quarter that's **already published** or marked **protected** is never
  overwritten unless you tick **Replace**.
- If some files named in the manifest are missing, publish stops and lists them
  (you can tick **Publish anyway** to go ahead without them).
- If the package has no manifest, or the manifest doesn't say which quarter to
  publish into, the tool declines and tells you what's needed — it never guesses.

---

## For developers

### Routes
| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Public. Binding + version status. |
| GET | `/` | Public UI shell (asks for the code, stored in `localStorage`). |
| PUT | `/put?t=CODE&key=K` | Write one object (used by the uploader). |
| GET | `/ls?t=CODE&prefix=P` | List keys. |
| GET | `/get?t=CODE&key=K` | Read one object. |
| GET | `/seasons?t=CODE` | List published quarters + file counts. |
| POST | `/publish?t=CODE&source=_incoming[&dry=1][&replace=1][&allow_missing=1]` | Review (`dry=1`) or publish a staged quarter. |

The access code may also be sent as an `x-access-code` header.

### What "publish" does
`/publish` is **manifest-driven**. Under the staging prefix it looks for
`…/TABREADY_IMPORT/manifest.json` (falling back to any `…/manifest.json`),
reads it, and:

1. resolves the target quarter folder from the manifest,
2. builds the viewer's `index.json` from the manifest,
3. copies each referenced file from staging into `<Season_YYYY>/<path>`,
4. writes `<Season_YYYY>/index.json`.

`dry=1` returns the plan and writes nothing.

### Manifest shape the publisher expects
The publisher reads these fields (it accepts a few aliases and fails loudly if
they're absent — it does not guess):

```jsonc
{
  "season": "Fall_2026",                 // required — target folder (also: season_folder | target | folder)
  "display_title": "Fall 2026 — …",       // optional — heading shown in the viewer
  "lessons": [                            // required — one row per week in the viewer table
    { "week": 1, "week_label": "Week 1", "display_date": "Sep 6",
      "title": "God Speaks to His People", "focal_passage": "Exodus 3" }
  ],
  "files": [                              // required — what each cell links to
    { "lane": "adult_leader", "week": 1,
      "path": "adult/01-teacher.pdf",     // destination under the season folder
      "source": "curriculum/2026_Q3/adult-csb/01 - … Teacher Packet.pdf" }
      // "source" is optional; if omitted the publisher matches by "path" or by
      // filename under the manifest's own folder.
  ]
}
```
Alternatively the manifest may carry a ready-made viewer index under an
`"index"` key with the same `{ display_title, lessons, files }` shape.

Viewer **lanes**: `adult_leader`, `senior_adult_leader`, `daily_discipleship`,
`schedule` (the "Read Me First" link). Extra lanes are ignored by the current
viewer's fixed columns.

> If a future package's manifest uses a different shape, the review screen will
> say exactly what it found and what it needs — update the field aliases in
> `planOrPublish()` rather than guessing in the UI.

### Deploy
Both curriculum Workers live on the **church** Cloudflare account
(`ffd360…`) and deploy via `.github/workflows/deploy.yml` on merge to `main`:
they're listed in `CHURCH_WORKERS` (church-account deploy, bindings preserved)
and in `CHURCH_ONLY_WORKERS` (skipped by the personal-account job). `tabready`
is **not** touched here — it deploys through its own gated workflow.

### Binding
`CURRICULUM` → R2 bucket `tab-curriculum` (church account).
