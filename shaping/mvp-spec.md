# Spec: NSW Curriculum Outcomes Sync — MVP

**Status:** all 4 decisions settled (raw storage awaiting your nod) · **Source:** grill rounds 1–2, recon in `nsw-curriculum-outcomes-recon.md`

## Goal

Fetch all NESA learning outcomes as structured data into this repo, committed as git-tracked files. No consumer yet — this MVP proves the pipeline end to end. Scoolendar ingest/search comes later against the same files.

## Settled decisions

| # | Decision | Answer |
|---|----------|--------|
| 1 | First consumer | None — prove the pipeline; file rewritten on each sync, history via git |
| 2 | Scope | All 82 syllabus outcomes pages + fetch-level metadata |
| 3 | Life Skills outcomes | Included, flagged `lifeSkills: true` |
| 4 | Old-format codes (`PD3-4`) | **Out of scope** — known gap, documented |
| 6 | Description | Both `descriptionHtml` (raw, incl. MathML) + `descriptionText` (stripped) |
| 7 | Validation | Only a **>10% total drop aborts**; individual fetch failures = warning + auditable |
| 8 | Runtime | Plain `sync.mjs`, Node 22 built-in fetch, zero deps |
| 9 | Schedule | GitHub remote + Actions cron **now**, plus manual `node sync.mjs` |
| 10 | Layout | Single `data/outcomes.jsonl` + `data/syllabuses.json` + gitignored `data/raw/` (last snapshot only) |

## Pipeline

```text
sitemap-0.xml ──► 82 /outcomes URLs
resolve buildId from live page HTML
GET each outcomes.json (failure → warn + record, don't abort)
normalize ──► rewrite data/outcomes.jsonl + data/syllabuses.json + data/sync-metadata.json
gate: total count drop >10% vs previous committed sync ──► abort (exit 1, no commit)
git commit ──► push
```

## Record schemas

**Outcome** — one per line in `data/outcomes.jsonl` (deduped by record codename; LS records mirrored in both a mainstream and a Life Skills 11–12 payload emit once, syllabus mapping from the record's own back-ref):

```json
{
  "code": "MAO-WM-01",
  "title": "Working mathematically",
  "descriptionHtml": "<p>develops understanding and fluency…</p>",
  "descriptionText": "develops understanding and fluency…",
  "lifeSkills": false,
  "isOverarching": true,
  "stages": ["Early Stage 1", "Stage 1", "Stage 2", "Stage 3", "Stage 4", "Stage 5"],
  "relatedLifeSkillsOutcomeCodes": [],
  "syllabusCodename": "mathematics_k_10_2022",
  "syllabusSlug": "mathematics-k-10-2022",
  "syllabus": "Mathematics K–10",
  "syllabusYear": 2022,
  "kla": "Mathematics",
  "sourceUrl": "https://curriculum.nsw.edu.au/learning-areas/mathematics/mathematics-k-10-2022/outcomes",
  "fetchedAt": "2026-09-05T…"
}
```

(Fields per probe — see `shaping/payload-probe.md`. `stages` comes straight from each record's taxonomy; no derivation. Each outcome carries its source syllabus mapping — codename, slug, name, year, KLA — from its own back-ref.)

**Syllabus** — array in `data/syllabuses.json`: `{ codename, slug, name, year, kla, stages, syllabusType, relatedLifeSkillsSyllabus, outcomesCount, status, lastFetched, sourceUrl }`

**Sync metadata** — `data/sync-metadata.json` (rewritten each run): `{ fetchedAt, buildId, totalOutcomes, perSyllabus: [{ slug, status: ok|failed|stale, count, error? }], warnings[] }`

## Validation semantics

- **Abort:** new total < 90% of previous committed total → exit 1, no commit, no partial writes.
- **Warn (auditable, no abort):** single fetch failure; syllabus returning 0 outcomes. Recorded in `sync-metadata.json`.
- **Failed-syllabus rows:** keep last-known rows in the JSONL, mark the syllabus `stale` in metadata.

## Raw data for audit

Required by decision 10. **Storage (settled): last raw snapshot only, kept OUT of git history.**

- `data/raw/` holds one `.json.gz` per syllabus — overwritten each sync, **gitignored** (repo stays tiny; history grows ~0).
- `data/sync-metadata.json` (committed) stores per-syllabus SHA-256 + source URL + timestamp — the permanent audit record.
- GH Actions uploads each run's raw as a workflow **artifact** (~90-day retention) — the recoverable audit window.

Why not commit raw: git keeps every version of every file you ever commit — replacing `data/raw/x.json.gz` with a newer copy doesn't delete the old one from history, it *adds* the new one alongside it (~10–15 MB per sync, forever). Keeping raw out of git is the only true "last copy only"; in-repo deletion doesn't shrink history.

Note: git dedupes byte-identical files (unchanged syllabuses would cost ~nothing even if committed), but site redeploys can shift bytes, so it's not a guarantee.

## Decisions status

1. **Stage in v1** ✅ — probed: `stages` array present on every outcome record; no fallback needed.
2. **Failed fetch handling** ✅ — keep last-known rows in the JSONL, mark the syllabus `stale` in metadata.
3. **Raw storage** ✅ — `data/raw/` gitignored (last snapshot only, overwritten per sync); SHA-256 + URL + timestamp committed in metadata; Actions artifact keeps ~90-day recoverable window. Confirm and this is final.
4. **Repo visibility** ✅ — private (NESA Crown-copyright content; licence excludes tutoring companies from redistribution).

## Out of scope (v1)

- Old-format code reconciliation (`PD3-4` style) — existing Scoolendar events referencing pre-reform syllabuses won't match this catalog; revisit at ingest design.
- Any DB, API, or search UI.
- Incremental syncs (ETag/Last-Modified).
- Stage backfill if probe fails (follow-up sync fills it).
