# C1 Probe Report — outcomes.json payload structure

**Date:** 2026-09-05 · **Method:** 3 diverse payloads fetched + deep-probed (Mathematics K–10, Agriculture 11–12, Agriculture Life Skills 11–12) · Raw payloads: `/tmp/nesa-probe/*.json` · Probe scripts: throwaway, logic absorbed into sync design.

## Answers

**1. Stage — SOLVED, no derivation needed.** Every outcome record carries `elements.stages__stages` (taxonomy array of `{name, codename}`). 0 missing across all 3 payloads. Examples: `MAO-WM-01` → ES1…S5 (it's overarching), `AG-11-01` → `[Stage 6]`, `MALS-ADS-01` → `[Stage 4, Stage 5]`. Schema field becomes **`stages: string[]`** (display names).

**2. Ref/join shape — exact recipe.**

- Page refs: `data.syllabus.item.elements.outcomes.value` = array of codename **strings** (`"mao_wm_01"`). 0 unresolved in maths (153/153 joined).
- Records: `data.syllabus.linkedItems[<codename>]` = `{elements, system}` — **no `.item` wrapper** (earlier recon note wrong).
- Filter: `system.type === "outcome"` + codename ∈ refs. `system.name` = display code (sometimes suffixed w/ syllabus name), `system.lastModified` available per record.

**3. Life Skills identification — reliable via taxonomy.** Record `elements.syllabus_type__items.value[].codename === "life_skills"`. Verified mixes: Maths K–10 = 131 Mainstream + 22 Life Skills (MALS-*); Agriculture 11–12 = 14 Mainstream + 16 LS (AG-LS-*).

**4. Syllabus meta — all present** on `data.syllabus.item.elements`: `title`, `code` (codename), `publication_year`, `key_learning_area__items[].name`, `stages__stages[]`, `syllabus_type__items[]`, `relatedlifeskillssyllabus` (mainstream→LS codename; LS syllabuses don't point back).

**5. Duplication found — important.** The Agriculture 11–12 and Agriculture Life Skills 11–12 payloads contain **the same 30 outcome records** (LS syllabus page mirrors mainstream). Every outcome record declares its own canonical home via `elements.syllabus` back-ref (AG-LS-13 says "Agriculture Life Skills 11–12" even inside the mainstream payload). **Rule:** emit one line per unique record codename across all 82 payloads; syllabus mapping taken from the **record's own back-ref**, never from the fetched page. K–10 syllabuses have no separate LS page (LS outcomes embedded in same payload) — rule handles both shapes.

**6. Data quality in sample:** no record missing code, description, or stages. `title` is empty on 11–12 outcomes (expected); Maths has `title` = "Working mathematically" + `isoverarching` yes/no flag.

## Final outcome schema (spec update)

```json
{
  "code": "MAO-WM-01",
  "title": "Working mathematically",
  "descriptionHtml": "<p>…</p>",
  "descriptionText": "…",
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

New vs spec: `stages` (was nullable `stage` — real data is an array), `isOverarching`, `relatedLifeSkillsOutcomeCodes` (mainstream outcome → its LS outcome codes, resolved codename→code within same payload — directly serves the sample_report matching pain), `syllabusCodename` (stable ID).

`data.syllabuses` catalog (`{items, pagination, linkedItems}`) exists in every payload → back-ref codename → syllabus meta resolution possible inside any payload (title/year/KLA), with fetched-page meta as fallback.

**syllabuses.json entry:** `{ codename, slug, name, year, kla, stages, syllabusType, relatedLifeSkillsSyllabus, outcomesCount, status, lastFetched, sourceUrl }`

## Risks / notes

- **88 checkboxes vs 82 pages** (recon gap): likely CEC courses without outcomes pages. C2 full fetch will surface any 0-outcome pages as warnings; no blocker.
- K–10 LS focus-area records (`MA_K_10_LS_FA_*`) exist in linkedItems but are `focus_area` type — excluded by the `type=outcome` + refs filter.
- `description` is rich text incl. MathML; text-strip needs entity decoding.
