# Research: Automating NSW Curriculum Outcomes Data

## Problem 


Is there a standard for student learning outcomes in NSW (e.g. codes and description), is there API that allows to fetch up to date definitions of outcomes and codes ? I want to use them in my web form to allow users search and select desired outcomes.
what option you would recommend to obtain data ? pros cons? I would prefer more simpler, cheaper and robust


## Recommendation

For Scoolendar, I would use:

**GitHub Actions + a TypeScript importer + your existing database.**

The application should not depend on NSW being available at runtime. Instead, NSW Curriculum is the source of truth, while your database is the runtime source for searching and selecting outcomes.

```text
                 NESA / NSW Curriculum
                         │
                         │ weekly
                         ▼
                  GitHub Action
                         │
                         ▼
                TypeScript importer
                         │
                  ┌──────┴──────┐
                  │             │
              validation       diff
                  │             │
                  └──────┬──────┘
                         ▼
                      Your DB
                         │
                         ▼
                  Scoolendar API
                         │
                         ▼
                 Outcome search
```

## Why this approach

### Simple

You do not need a separate synchronization server, cron service, or third-party curriculum API.

A scheduled GitHub Action can run something like:

```yaml
name: Sync NSW Curriculum

on:
  schedule:
    - cron: "0 2 * * 0"
  workflow_dispatch:

jobs:
  sync:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - run: npm ci
      - run: npm run curriculum:sync
```

This runs weekly and can also be triggered manually.

### Cheap

For a small project, GitHub Actions is effectively free within GitHub's included Actions usage.

The sync itself only needs to run periodically. There is no reason to query NSW on every user search.

### Robust

Your users are not affected if:

- the NSW website is temporarily unavailable
- the NSW site is slow
- NSW changes its frontend
- NSW changes page URLs
- many users search outcomes simultaneously

Your application continues to use its own database.

## What the importer should do

Conceptually:

```text
1. Discover available NSW syllabuses
2. Fetch their current outcome data
3. Extract code + description + metadata
4. Validate the result
5. Compare it with your existing data
6. Add new outcomes
7. Update changed outcomes
8. Mark removed/retired outcomes
9. Record what changed
```

Example normalized record:

```json
{
  "code": "TE4-SDP-01",
  "description": "explains relationships between sustainability, design and production",
  "syllabus": "Technology 7–8",
  "syllabusYear": 2023,
  "stage": "Stage 4",
  "status": "current",
  "sourceUrl": "https://curriculum.nsw.edu.au/..."
}
```

The NSW Curriculum website currently exposes syllabus outcome codes and descriptions on individual syllabus pages and provides a custom curriculum download facility where Outcomes can be selected.

## Do not blindly overwrite the database

The sync should generate a diff before applying changes.

For example:

```text
NSW Curriculum sync

Added:       17
Changed:      3
Removed:      0
Unchanged:  2,841
```

Add validation safeguards.

For example, if NSW unexpectedly returns zero Mathematics outcomes, the job should fail rather than deleting all existing Mathematics records.

That makes the synchronization process much safer.

## Where the data should come from

There are three possible sources, in order of preference.

### A. A structured NSW data endpoint

**Best case.**

If the NSW website uses a suitable structured endpoint, the importer can fetch JSON or another structured representation.

```text
NSW structured data
        ↓
your importer
        ↓
database
```

This would be the cleanest implementation.

However, an undocumented internal endpoint should not become a runtime dependency of your application. Use it only as an ingestion source, with your database remaining the application source.

### B. NSW Curriculum HTML pages

If no suitable public endpoint exists, parse the official NSW Curriculum pages.

The current site presents outcomes in structured syllabus sections, making this a reasonable fallback.

```text
NSW webpage
    ↓
HTML parser
    ↓
outcomes
```

This is preferable to parsing PDFs if the HTML contains all required fields.

### C. Official downloadable documents

The NSW Curriculum site provides a custom download facility allowing users to select a syllabus, stage and curriculum elements including Outcomes.

This could be used as an ingestion source if it proves more reliable than HTML extraction.

Document parsing is less attractive because it is generally more fragile than structured data or HTML.

## Automatically discover new syllabuses

Do not hard-code every syllabus if possible.

Instead of:

```text
fetch Mathematics
fetch English
fetch Science
...
```

prefer:

```text
Discover available syllabuses
             ↓
Detect new/changed syllabuses
             ↓
Fetch their outcomes
             ↓
Update database
```

This means that when NSW introduces another syllabus, the importer can potentially pick it up without a code change.

## Versioning is important

Do not model curriculum data simply as:

```text
code → description
```

NSW is transitioning between syllabus versions and implementation dates.

An existing Scoolendar learning plan may legitimately reference an older outcome.

Therefore retain syllabus/version information rather than overwriting historical records.

A more useful model is:

```text
outcome
-------
id
syllabus_id
stage
code
description
status
effective_from
effective_until
source_url
```

And:

```text
syllabus
--------
id
name
code
version
status
```

This allows current and historical syllabus versions to coexist.

## Recommended architecture

```text
                 NSW Curriculum
                       │
                       │ periodic sync
                       ▼
                GitHub Actions
                       │
                       ▼
             TypeScript importer
                       │
              ┌────────┴────────┐
              │                 │
          validation           diff
              │                 │
              └────────┬────────┘
                       ▼
                  PostgreSQL
                       │
                       ▼
                 Scoolendar API
                       │
                       ▼
              Search/select UI
```

### API exposed by Scoolendar

For example:

```http
GET /api/curriculum/syllabuses
GET /api/curriculum/stages
GET /api/curriculum/outcomes
GET /api/curriculum/outcomes?query=fractions
GET /api/curriculum/outcomes?syllabus=mathematics-k-10&stage=2
```

The frontend searches your API rather than NSW directly.

## Practical recommendation

Start with the smallest version:

1. Identify the best official NSW source.
2. Build a TypeScript importer.
3. Store normalized outcomes in your existing DB.
4. Add validation and diff reporting.
5. Run the importer weekly with GitHub Actions.
6. Add automatic syllabus discovery if the NSW source supports it.
7. Keep syllabus/version information so historical learning plans remain valid.

**The next technical investigation should be the NSW Curriculum website itself: determine whether it exposes a structured endpoint or usable downloadable data. If it does, the importer could be very small and avoid building a full scraper.**
