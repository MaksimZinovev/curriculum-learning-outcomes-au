# ADR 0001: dedupe outcomes by record codename

Date: 2026-09-05 · Status: accepted, amended same day after first full run

## Context

Two syllabus pages can return the same outcome records. The Agriculture 11–12 page and the Agriculture Life Skills 11–12 page each return 30 records, and the 30 are identical. If the sync extracts outcomes per page, AG-LS outcomes get written twice and land under the wrong syllabus. K–10 syllabuses are the other shape: Life Skills outcomes sit inside the mainstream payload, with no separate Life Skills page.

## Decision

Each outcome record declares its own home syllabus in its `syllabus` field. AG-LS-13 says "Agriculture Life Skills 11–12 (2026)" even when it arrives inside the Agriculture 11–12 payload. So the sync emits one line per unique record codename across all payloads and takes the syllabus mapping from that back-ref, never from the page the record came from.

## Amendment

The back-ref rule needed one escape hatch. 14 CMS syllabus items have no outcomes page of their own, covering about 286 outcomes. Example: the Software Engineering page's syllabus item is `SWE-11_12-2022`, but its outcome records back-ref `software_11_12_2022`, an item with no page and no catalog entry. Updated rule: use the back-ref when it maps to a real page, otherwise map the outcome to the page that published it. Codename uniqueness was verified across all 1682 emitted rows, and record GUIDs (`system.id`) confirmed the Agriculture mirrors are the same record served twice. CMS print dummies (`outcome_printdummy`, code "NA") are PDF layout padding, not outcomes, so they are skipped and per-page counts include refs the JSONL will not contain.

## Consequences

- One JSONL line per real outcome. The global total is post-dedupe, so it does not equal the sum of per-page counts. `syllabuses.json` keeps per-page counts for the audit trail.
- The 10% validation gate compares post-dedupe totals run over run, which stays consistent.
- Rejected alternative: page-based extraction. It double-counts mirrored Life Skills outcomes and misattributes them to the mainstream syllabus.
