# Recon: NESA Curriculum — structured source for learning outcomes

**Date:** 2026-09-05 · **Method:** live browser recon (ego-browser) + PDF analysis of this repo's artifacts
**Goal:** determine the optimal way to obtain NSW learning-outcome data (codes + descriptions) for Scoolendar's outcome search/select form. MVP constraint: **store JSON/JSONL in git, no database, no CLI framework.**

---

## TL;DR

**Option A (structured data) is confirmed and is the winner.** curriculum.nsw.edu.au is a Next.js static site over a structured CMS (Kontent.ai). Every syllabus has an `/outcomes` page whose full data is fetchable as **plain JSON over HTTP — no auth, no cookies, works with `curl`**. The `/custom` download facility (Word/PDF) is a print service for teachers and is irrelevant for data ingestion.

---

## 1. Site architecture (observed)

- Next.js pages-router SSG app, deployed on Vercel (`digital-curriculum-next-<hash>-nesa.vercel.app` build manifests).
- Content served from Kontent.ai CMS — payloads carry `codename`, `system.type`, `elements` (rich_text, taxonomy, text).
- Syllabus content lives at `/learning-areas/<area>/<syllabus-slug>/<element>` with element pages:
  `overview`, `rationale`, `aim`, **`outcomes`**, `content`, `assessment`, `glossary`, `teaching-and-learning`.
- Page data is also exposed as **pure JSON** via Next.js data files:
  `/_next/data/<buildId>/<path>.json?slug=<path>`

## 2. Endpoint recipes (verified 2026-09-05)

```bash
# 1. Enumerate all syllabus outcomes pages
curl -s https://curriculum.nsw.edu.au/sitemap-0.xml \
  | grep -o '<loc>[^<]*</loc>' | grep '/outcomes$'
# → 82 outcome pages (e.g. .../learning-areas/mathematics/mathematics-k-10-2022/outcomes)

# 2. Resolve the current buildId (changes on every redeploy)
curl -s https://curriculum.nsw.edu.au/custom \
  | grep -o '_next/static/[^/]*/_buildManifest\.js'
# → _next/static/digital-curriculum-next-6e174blwi-nesa.vercel.app/_buildManifest.js

# 3. Fetch one syllabus's structured data (verified: HTTP 200, JSON, 1.85 MB, no browser)
BUILD=digital-curriculum-next-6e174blwi-nesa.vercel.app
SLUG=learning-areas/mathematics/mathematics-k-10-2022/outcomes
curl -s "https://curriculum.nsw.edu.au/_next/data/$BUILD/$SLUG.json?slug=$SLUG"
```

`sitemap.xml` is an index pointing at `sitemap-0.xml` (808 URLs total, 82 `…/outcomes` pages).

## 3. Payload contents (per outcomes page)

`pageProps.data` keys: `config, pageResponse, syllabuses, syllabus, focusArea, stages, years, stageGroups, keyLearningAreas, glossaries, assets, webLinkExternals, webLinkVideos, defaultFocusAreaUrls, websiteConfiguration`.

**Outcome records** (verified with Mathematics K–10 (2022)): **153 records**, resolved via
`data.syllabus.item.elements.outcomes.value` (refs) joined to `data.syllabus.linkedItems[<codename>]` (full records — join mechanism to be verified during implementation).

Each outcome record (Kontent element shape):

| Field | Type | Example |
|---|---|---|
| `code` | text | `MAO-WM-01`, `MALS-ADS-01` |
| `title` | text | "Working mathematically" (empty on some, e.g. Life Skills) |
| `description` | rich_text (HTML, may contain **MathML**) | "develops understanding and fluency in mathematics through exploring…" |
| taxonomy | e.g. syllabus type | `Mainstream` |
| `relatedlifeskillsoutcomes` | linked items | cross-refs to MALS-* outcomes |

**Bonus catalogs in the same payload:** `stages`, `years`, `stageGroups`, `keyLearningAreas`, `glossaries`, and a `syllabuses` catalog (`{items, pagination, linkedItems}` with title + KLA taxonomy + codename per syllabus).

⚠️ **buildId churn:** the build ID changes on redeploy. The importer must resolve it from live HTML before fetching (2-line step). Do not hardcode.

## 4. The `/custom` download facility (Option C — assessed, rejected for ingestion)

- Wizard: pick syllabuses (88 options incl. year versions, e.g. "Mathematics K–10 (2022)") × elements (Overview, Rationale, Aim, **Outcomes**, Content, Access content points, Examples, Tags, Teaching advice, Assessment, Glossary) → Download as **Word or PDF**.
- Clicking Download shows a *"Processing — generating your file"* modal; no useful server data endpoint observed in the network log (file generation path not needed).
- This facility produced the two NESA PDFs in this repo. Text analysis of those exports (135 pages combined): outcome mentions are **prose only**; effectively **zero** structured outcome codes. Parsing them back is lossy → rejected.

## 5. Repo artifact inventory

| File | What it is | Verdict |
|---|---|---|
| `NESA - Syllabuses (S6).pdf` (108 pp) | Official `/custom` export — multi-syllabus **overviews** (prose). Only stray `AH-LS-xx` codes. | Reference only; not a data source |
| `NESA - Syllabuses syllabus support (S6).pdf` (27 pp) | "Syllabus Support" variant — teaching material, no outcome codes | Reference only |
| `sample_report.pdf` (32 pp, image-only) | **Scoolendar's own** student Summary Report (Eliza Bell, 2023–24). Events per subject with "Stage/Learning Outcome" fields — currently **inconsistent free text**: bare codes (`PD3-4, PD3-5…`) or code+description blobs (`PHA-MSS-01 transfers movement skills…`) | The consumer pain this project fixes |
| `nsw-curriculum-outcomes-research.md` | Prior research: GitHub Actions + TS importer + DB architecture, diff/validation, versioning | Pipeline blueprint still valid |

**Licensing note:** the NESA export states a limited licence (teachers, school bodies, **home-schooling parents**) for non-commercial educational use, and explicitly excludes private tutoring companies. Keep in mind how Scoolendar republishes outcome text.

## 6. Options assessment (vs prior research doc)

| Option | Status | Verdict |
|---|---|---|
| **A. Structured endpoint** (`_next/data` JSON per outcomes page) | ✅ **Confirmed, verified with plain HTTP** | **Use this.** No HTML parsing, no PDF parsing. Importer is tiny. |
| B. Parse HTML pages | — | Unnecessary now; JSON is strictly better |
| C. Custom download facility (Word/PDF) | — | For humans; lossy round-trip; rejected |

## 7. MVP pipeline (recommended)

```text
sitemap-0.xml ──► 82 outcomes URLs
buildId resolved from live HTML
each outcomes.json (~1–2 MB × 82 ≈ 80–150 MB per full sync — fine for a batch job)
   └─► extract syllabus meta + outcome records (discard the rest)
       └─► validate (counts per syllabus, code format regex) + diff vs previous
           └─► outcomes.jsonl + syllabuses.json  ──► git commit
```

Target JSONL record (aligned with the prior research doc's model):

```json
{"code":"MAO-WM-01","title":"Working mathematically","description":"develops understanding and fluency in mathematics through exploring and connecting mathematical concepts, choosing and applying mathematical techniques to solve problems, and communicating their thinking and reasoning coherently and clearly","syllabus":"Mathematics K–10","syllabusSlug":"mathematics-k-10-2022","syllabusYear":2022,"kla":"Mathematics","stage":null,"status":"current","sourceUrl":"https://curriculum.nsw.edu.au/learning-areas/mathematics/mathematics-k-10-2022/outcomes","fetchedAt":"2026-09-05"}
```

Importer skeleton (Node/TS, matches the GitHub Actions plan in the research doc):

```ts
// 1. const html = await get('https://curriculum.nsw.edu.au/custom')
// 2. const build = html.match(/_next\/static\/([^/]+)\/_buildManifest\.js/)[1]
// 3. const urls = (await get('https://curriculum.nsw.edu.au/sitemap-0.xml'))
//      .match(/<loc>([^<]+)<\/loc>/g).map(...).filter(u => u.endsWith('/outcomes'))
// 4. for each url: get(`/_next/data/${build}/${path}.json?slug=${path}`)
// 5. extract → normalize → append to outcomes.jsonl → report {added, changed, removed, unchanged}
```

## 8. Open questions / next steps

1. **Ref join shape:** confirm `outcomes.value` ref objects link by `codename` into `syllabus.linkedItems`.
2. **Stage mapping per outcome:** not verified on the outcome record itself (syllabus-level `stages`/`stageGroups` exist). The `/outcomes` page UI groups by stage — find where that grouping lives in the payload (likely focus areas / content structure) before finalizing the JSONL schema.
3. **MathML in descriptions:** K-10 maths outcomes embed MathML. Decide: preserve raw HTML vs strip-to-text (affects search quality; MathML may need cleanup for display).
4. **The 6 missing pages:** 88 syllabus checkboxes vs 82 outcomes URLs — likely CEC/Content Endorsed Courses without outcomes pages; confirm and decide whether they matter for Scoolendar.
5. **Politeness/robustness:** check `ETag`/`Last-Modified` on the JSON responses for incremental syncs; add per-syllabus validation counts (fail the sync if a syllabus returns 0 outcomes — per the research doc's safety rule).
6. **buildId edge case:** verify behavior during a Vercel deploy window (old build id 404s?) — retry with fresh resolution.