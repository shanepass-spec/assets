# Curriculum Viewer (`tab-curriculum`)

The read-only, teacher-facing page for Sunday School curriculum. Linked from
the tabready app under **Resources → Sunday School** (for the Adult SS role).

**Live URL:** https://tab-curriculum.media-ffd.workers.dev/

It lists every published quarter found at the root of the `tab-curriculum` R2
bucket — each `Season_YYYY/` folder that has an `index.json` — and renders the
lessons table with links to the lesson PDFs. It never writes anything.

New quarters are put here by the **Curriculum Manager**
(`workers/tab-curriculum-upload`), which stages an upload and then publishes it
into a `Season_YYYY/` folder. See that folder's README for the full flow and
the `index.json` / manifest shape.

The footer carries a discreet, access-code-gated **staff link** to the manager,
so upload/publish is reachable from the same place teachers open the viewer.

**Binding:** `CURRICULUM` → R2 bucket `tab-curriculum` (church account).
**Deploy:** via `.github/workflows/deploy.yml` (church-account job) on merge to `main`.
