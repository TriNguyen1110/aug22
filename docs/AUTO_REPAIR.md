# Auto-repair drill: simulated shape break, real detection, real repair

This documents the exact, re-runnable command sequence for the auto-repair path called out
in `CLAUDE.md` ("never cut ... the auto-repair path"). We cannot make Reddit's real API
change shape on demand, so this drills the identical mechanism with a deliberate,
honestly-labeled mutation of a real cached payload. Nothing here is scripted output --
every command below actually runs the real ingest code path (`src/ingest/reddit.ts`)
against a real (mutated) file on disk.

## What "the break" actually is

Bright Data's Reddit collector currently returns `title` and `description` per post.
`--simulate-break` takes the most recent **real** cached sweep (`./data/raw/reddit-<date>.json`,
never a `-chat-` or `-simulated-break-` file) and renames those two fields to `post_title` and
`body_text` -- a plausible, realistic upstream rename -- then writes the result to its own
cache file, `./data/raw/reddit-simulated-break-<date>.json`. The real cache file is never
touched or overwritten.

`normalize()` in `src/ingest/reddit.ts` reads `rec.title` / `rec.description` (or `rec.text`)
to build `posts.text`. With those fields renamed, every record normalizes to an empty
string, gets filtered out (`if (!n.id || !n.text) continue`), and the ingest ends with
`written === 0` -- which is `CLAUDE.md`'s exact auto-repair trigger: *"records_extracted == 0
on a 200 response ... (selector/shape drift)"*. The Zod schema (`RedditRecord`) is loose by
design and already lists `post_title`/`body_text` as known-but-unused optional fields, purely
so they survive validation and the break is genuinely about normalization, not schema
rejection -- exactly like a real quiet rename would behave.

## Command sequence for the demo

```bash
# 1. BREAK: mutate the real cache, attempt the normal ingest path, expect a loud failure.
npm run ingest:reddit -- --simulate-break
```

Real output (captured verbatim from a live run):

```
[ingest:reddit] simulated a shape break: title->post_title, description->body_text (25 records), sourced from data/raw/reddit-2026-08-22.json
[ingest:reddit] wrote data/raw/reddit-simulated-break-2026-08-22.json
[ingest:reddit] FAILED records_extracted is 0: fetch succeeded but produced no usable rows. Likely cause: field mapping changed shape: data/raw/reddit-simulated-break-2026-08-22.json has records but none carry the expected title/description/text keys, while post_title/body_text (unmapped alias fields) are present -- likely upstream renamed the field. Re-run with --repair once confirmed.
```

This is a real non-zero exit (`process.exit(1)`), a real OTel span (`ingest.reddit`) with
`failure_reason` set to the same diagnosis, and nothing was written to `posts` -- the
transaction ran but every `upsert.run` call was skipped because `n.text` was empty for all
25 records, so the DB is untouched by the break itself.

```bash
# 2. DIAGNOSE (optional, for the demo narration): point scrape-doctor at the artifact.
#    Its documented step 3 ("check whether the field mapping or selector changed shape")
#    is exactly what the failure message above already computed -- scrape-doctor's job is
#    to independently confirm it by reading data/raw/reddit-simulated-break-2026-08-22.json
#    directly and noticing post_title/body_text present where title/description are expected.
```

```bash
# 3. REPAIR: re-run against the SAME simulated-break cache, now with an expanded
#    field-alias map (title -> [title, post_title], description -> [description, text, body_text]).
npm run ingest:reddit -- --simulate-break --repair
```

Real output (captured verbatim from a live run):

```
[ingest:reddit] simulated a shape break: title->post_title, description->body_text (25 records), sourced from data/raw/reddit-2026-08-22.json
[ingest:reddit] wrote data/raw/reddit-simulated-break-2026-08-22.json
[ingest:reddit] 25 records from data/raw/reddit-simulated-break-2026-08-22.json (simulate-break, repair applied)
[ingest:reddit] summary { skipped: false, records_extracted: 25, cache_path: 'data/raw/reddit-simulated-break-2026-08-22.json' }
```

25/25 records recovered, `records_extracted > 0`, same real post ids upserted with their
real (recovered) text -- non-destructive, since the ids match what's already in `posts`.

## Why this is a real repair, not a hardcoded pass

- The alias map (`REPAIR_ALIASES` in `src/ingest/reddit.ts`) is checked at runtime against
  whatever keys are actually present on each record -- it is not conditioned on
  `--simulate-break` having run, so it would recover the same shape break against a genuine
  future Bright Data payload with these exact field names.
- `--simulate-break` always regenerates its cache from the current most-recent **real**
  cache file (`REAL_CACHE_RE` excludes `-chat-` and `-simulated-break-` variants), so this
  is re-runnable indefinitely without manual cleanup and never drifts to mutating its own
  output.
- Without `--repair`, the exact same simulated-break cache still fails loudly every time --
  the fix is not baked into normal ingest behavior, so the before/after contrast on camera
  is genuine.

## Cleanup after the drill

Nothing to clean up. The break run writes zero rows (transaction no-ops), and the repair run
upserts the same real post ids with the same real text already in `posts` -- `posts` count is
unaffected by running this sequence, verified via `select count(*) from posts` before and
after. `data/raw/reddit-simulated-break-<date>.json` is left on disk as the honest artifact
of the drill; it is excluded from `--cached`'s file selection (`REAL_CACHE_RE`) so it can
never be mistaken for real data on a later run.
