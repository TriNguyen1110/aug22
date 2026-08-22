# Project rules

## Build constraint, read this first

This is a one day hackathon build. Demo grade, not production. Working beats complete,
and shipped beats correct in the abstract.

- No abstractions for future reuse. Write the specific thing.
- No refactoring. If it works and is ugly, leave it.
- No auth, no billing, no onboarding, no empty states beyond one line of text.
- Error handling only where it protects the demo: cache every fetch, assert record counts,
  and fail loudly. Everywhere else, let it throw.
- No new dependencies unless one saves more than thirty minutes.
- If the choice is between shipping something plain and not shipping, ship plain.
- If a piece is not working after 45 minutes, say so and take the documented fallback
  instead of continuing.

Scope is fixed and the clock is not. When in doubt, cut.

Fallbacks, in preference order when something will not work:

| Blocked on | Take this instead |
|---|---|
| Collector will not authenticate | Switch platform. Reddit first, then Facebook, then YouTube |
| No dated history in one fetch | Rank by absolute volume instead of growth ratio |
| Video or media download fails | Text and comments only, drop multimodal entirely |
| Dashboard behind schedule | Plain HTML table with real cited data |
| Network unreliable | Run everything from `./data/raw/` with `--cached` |

Cut order if time runs short: multimodal enrichment first, then the template recommendation,
then dashboard polish. Never cut the demo video, the Port workspace, or the auto-repair path.

## Stack

Bun, not npm (tools/ still run under `node` for now, pre-existing). TypeScript. Next for the
dashboard. SQLite via `better-sqlite3`, single file at `./data/app.db` (path from `DB_PATH`).
No Postgres, no Prisma, no separate test DB — one file, one day. Zod at every external
boundary. OpenTelemetry to SigNoz, guarded on `SIGNOZ_OTLP_ENDPOINT` being set.

Three use cases, one schema, three dashboard pages: `/trends`, `/competitors`, `/monitoring`.
See `docs/USE_CASES.md` for the why and the demo target (Notion vs Linear/Asana).

## Commands

```bash
npm run seed          # 5 posts, 3 trends, 5 findings. all quotes verbatim.
npm run seed:bad      # same plus one fabricated quote. cite-check MUST fail.
npm run smoke         # db + api, one line per check, non-zero on any failure
npm run smoke:db      # db checks only, use before the server exists
npm run cite          # every findings.quote verbatim in the post it cites
npm run cite:urls     # same, plus resolves every post URL
npm run shot          # screenshots routes at 1280x800 and 390x844
npm run weblogs       # console errors, uncaught throws, failed requests, 4xx/5xx

bun run dev           # dashboard, added when the app is scaffolded
bun run ingest -- --platform reddit --cached   # never hit the network during a demo
```

**These tools are inert until the schema is applied.** They are written against `CONTRACT.md`
and expect `DB_PATH` (default `./data/app.db`) plus the tables in `CONTRACT.md` to exist.

Order of operations. Do not run a tool before its prerequisite:

| Step | Then this works |
|---|---|
| `npm i && npx playwright install chromium` | `shot`, `weblogs` |
| Apply the `CONTRACT.md` schema (`src/db/migrate.ts`) | `seed`, `smoke:db`, `cite` |
| API routes exist and dev server is running | `smoke`, `weblogs` |

If a tool fails because its prerequisite is missing, say so and move on. Do not try to fix
the tool, and do not reimplement its checks inline. If a check is genuinely missing, add it
to the tool rather than writing it ad hoc.

Once live: `npm run smoke` after any change to ingest, detect, or the API. `npm run cite`
before anything goes on screen or into the video.

Storage note: Port is a project catalog, not a datastore. Application data lives in SQLite.

## Bright Data Scraper Studio

Terminal only. Do not open the web dashboard for anything that can be done from the CLI,
since a pure terminal workflow is part of the judging criteria.

```
BRIGHTDATA_API_TOKEN   in .env.local, never committed
Default platform       reddit
Output                 JSON to ./data/raw/<platform>-<iso-date>.json
Always cache            every successful fetch is written to disk before parsing
```

Scraper settings live in this file so they are reused automatically:

```
collector_id:        reddit_posts   # Bright Data's built-in Reddit collector, verify at first run
date_range_param:    time_filter    # 'week' for trend windows, 'month' for competitor/monitoring
records_per_call:    100
auth_method:         BRIGHTDATA_API_TOKEN bearer, no cookie needed for the public collector
retry_policy:        1 retry, then treat as a scrape-doctor case, never loop unbounded
auto_repair_trigger: records_extracted == 0 on a 200 response, or a required field comes back null
                      across the whole batch (selector/shape drift)
```

Demo targets (see `docs/USE_CASES.md`), one subreddit per row is the collector's `subreddit` param:

```
trends       r/SaaS, r/productivity, r/Notion     source_type=trend,      company_id=null
competitor   r/linear                             source_type=competitor, company=Linear
competitor   r/asana                               source_type=competitor, company=Asana
own          r/Notion                              source_type=own,        company=Notion
```

Competitor pricing/changelog snapshots are a plain fetch of the public pricing/changelog page
(not a Bright Data collector), written to `competitor_snapshots`. Cache the raw HTML/JSON to
`./data/raw/` the same as any other fetch.

When a scrape returns fewer records than expected, do not retry blindly. Use the
`scrape-doctor` agent. A 200 response with zero records is the expected failure mode here,
not an exception.

## BOARD.tsv

**Main-session rule:** every time a backend or frontend agent commits a testable slice and
appends a `review` row, dispatch the verifier agent for that row's scope before treating the
work as done or moving on. If the verifier kicks it back to `doing`, dispatch the owning
builder with the fix from `note` and repeat. Never skip straight from a builder's commit to
"looks done" — that's the exact self-certification the board's role table forbids. This loop
runs every tick, not just at the end.

**Push rule:** once the verifier marks an item `done`, the main session pushes to `origin` —
don't let verified work sit local-only. Never push while another agent has uncommitted or
in-flight changes to files you're about to push alongside; push what's actually complete and
verified, leave in-flight work uncommitted until its own agent finishes and is verified.

All shared state lives in one append-only, tab-separated file. Never edit a line, never rewrite
the file, only append with `>>`. Agents run in parallel and a rewrite loses whatever another
agent appended in between. **The last row for a given `kind` + `id` is the current truth.**
Superseding a row means appending a new one, and nothing is ever deleted.

```
ts    kind   id             value        owner      scope   note
```

Two kinds of row.

`item` is a unit of work. `value` is its state: `backlog`, `doing`, `review`, `done`,
`blocked`, `delayed`.

`fact` is something already computed that other agents would otherwise recompute. `value` is
the answer. This is the point of the file: if the backend agent counted the rows, the frontend
agent reads the count instead of opening a database connection to learn it again.

```
H+1.0	fact	api.routes	/api/trends,/api/findings	backend	-	shapes frozen in CONTRACT
H+1.2	fact	records.posts	412	backend	-	from data/raw/reddit-2026-08-20.json
H+1.3	fact	scrape.auth	cookie header, 50/call	backend	-	dry run, collector c_9f2
H+2.0	item	07	doing	frontend	SCREEN	trend citations render as links
H+2.4	fact	weblogs	clean	verifier	SCREEN	-
H+2.5	item	07	review	frontend	SCREEN	committed
H+3.0	item	07	doing	frontend	SCREEN	FAIL rows 2 and 4 render name with no href
```

Read current state with one pass, last row per key wins:

```bash
awk -F'\t' '{r[$2"\t"$3]=$0} END{for(k in r) print r[k]}' BOARD.tsv | sort -t$'\t' -k2,3
```

Your own queue, for example the frontend agent:

```bash
awk -F'\t' '{r[$2"\t"$3]=$0} END{for(k in r) print r[k]}' BOARD.tsv \
  | awk -F'\t' '$2=="item" && $5=="frontend" && $4=="doing"'
```

Write a `fact` row whenever you learn something that cost you real time and that another agent
would need: record counts, route shapes, scraper settings, which selector actually works, what
the cached payload looks like. A fact someone else has to rediscover is the most expensive
thing in a one day build.

Who may set what:

| Transition | Who |
|---|---|
| `backlog` -> `doing` | the owning builder, at tick start |
| `doing` -> `review` | the owning builder, after its commit lands |
| `review` -> `done` | **verifier only** |
| `review` -> `doing` | **verifier only**, on a failure, reason in `note` |
| anything -> `blocked` | any agent |
| anything -> `delayed` | the main session only, cutting scope is a human call |
| new `item` in `backlog` | any agent, including the verifier when it finds something |
| any `fact` | any agent |

The invariant that matters: nothing reaches `done` by its own hand. A builder can only push to
`review`. If you want to mark your own item `done`, that is the bug.

Keep `note` to one line and no tabs in it. Multi-line detail goes in your report, not the file.

## Grounding rules

Every generated claim cites a real post. `findings.quote` must appear verbatim in the
`posts.text` of its `post_id`. No exceptions, no paraphrasing into the quote field.

Statistics find trends. The LLM only names and explains them. Never ask a model to
decide what is trending.

Run the `verifier` agent before anything goes on screen or into the video.

## Port

Connected via MCP (`.mcp.json`, `port-us`, region US). Port is the factory's catalog and
governance layer, not a datastore — application data lives in SQLite regardless of what Port
knows. All three build agents (backend, frontend, verifier) carry `mcp__port-us` in their tool
list and are instructed to `upsert_entity` for what they shipped, and `verifier` additionally
records each verdict there. This is additive: if the connection isn't reachable in a given
environment, agents skip the Port call and say so rather than blocking their tick on it.
`BOARD.tsv` remains the actual source of truth for build state — Port is where a human operator
looks to see the same story without reading the board directly.

## Observability

Every stage gets a span: ingest, parse, detect, enrich, API request. Record duration,
record count, and failure reason. Instrument the failure and auto-repair paths, not just
the happy path, since monitoring failures is explicitly part of the SigNoz criteria.

Emit `records_extracted` as a metric. Alert on zero. HTTP status is not a success signal.

## Conventions

Fail loudly. Assert record counts are greater than zero rather than logging a warning.
Keep every step idempotent and resumable, and write intermediate state to disk.
Cap retries and total runtime, no unbounded loops.

When corrected, add the rule here rather than fixing the same thing twice.
