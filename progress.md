# Status

Shipped 2026-09-05: `sync.mjs` pulls all 81 NESA syllabuses in ~4s and commits 1682 outcomes (1068 mainstream / 614 Life Skills) to `data/outcomes.jsonl` + `data/syllabuses.json`.
GitHub Actions runs it monthly and on manual dispatch; each run leaves a raw-payloads artifact (~90 days) and auto-commits refreshed data. Verified green end to end.
Repo is private (MaksimZinovev/curriculum-learning-outcomes-au), `.git` is 6.5MB, raw payloads never enter git.
Validation tested: a >10% total drop aborts with no writes; a failed fetch keeps last-known rows flagged stale.
Docs live in `shaping/`: MVP spec (final), payload probe, ADR 0001 (dedupe + back-ref fallback).
Next: Scoolendar ingest/search against `outcomes.jsonl`; matching old free-text codes (PD3-4 style) is a documented gap for that phase.
