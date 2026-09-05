# curriculum-learning-outcomes-au

NSW (NESA) curriculum learning outcomes as structured data. `sync.mjs` fetches every syllabus outcomes page on curriculum.nsw.edu.au, normalizes it, and commits `data/outcomes.jsonl` + `data/syllabuses.json` on change. GitHub Actions runs it monthly; raw payloads per run live in workflow artifacts, not in git.

- run locally: `node sync.mjs` (Node 22+, zero deps)
- run manually: Actions tab → sync → Run workflow
- design, spec, decisions: `shaping/`

Private repo on purpose: the content is NESA Crown copyright and the licence excludes redistribution by tutoring companies.
