# Hackathon submission draft

Answers below are grounded in what's actually built and verified in this repo as of
2026-08-22. Where something isn't confirmed yet, it's flagged explicitly — don't submit
a claim we haven't actually checked.

## Deployed link to project

**Recommendation: leave blank.** This app runs on a local SQLite file
(`./data/app.db`) and a local dev server — there's no hosted deployment, and standing
one up on Vercel/similar would mean either switching to a hosted DB (Postgres/Turso)
or accepting the data resets on every cold start, neither of which is a good use of
remaining time versus polishing the demo video. If there's real time left after the
video is done, a quick Vercel deploy with a hosted SQLite-compatible DB (e.g. Turso)
is doable, but it's optional per the form — don't force it.

## Video script (target: under 5 minutes)

Cut order if you're running long: cut the "learning and growth" section first, then
tighten the demo section — never cut the Bright Data auto-repair segment or the Port/
SigNoz segments, those are explicitly graded.

**[0:00–0:20] Open on the hook, not an introduction**
Show the naive-fetch-vs-Bright-Data comparison on the home page
(`/`, the "Naive fetch vs. Bright Data" card). Say something like:

> "A plain HTTP request to Reddit gets you a 403 or a JavaScript shell — 189KB of
> nothing. Bright Data gets you 25 real posts. That gap is the whole reason this
> project exists."

**[0:20–1:00] What the project does (~40s)**
> "This is Meridian — a market research tool with three real use cases: Trends,
> which does statistical burst-detection on live AI/tech discourse; Competitors,
> which tracks a named competitor's pricing, activity, and sentiment; and
> Monitoring, which tracks how our own company is being received. We built it
> self-referentially — Anthropic is the target, OpenAI is the tracked competitor —
> so the whole demo is Claude's own team researching itself and its competitor,
> using real Reddit data pulled live through Bright Data."

**[1:00–1:45] Tech stack and architecture (~45s)**
> "Next.js frontend, SQLite for storage, Bright Data's Direct API for live ingest,
> and Claude (Anthropic API) for the grounded chat layer. The core invariant is
> grounding: every single claim on this site — every trend, every competitor
> insight, every chat answer — traces back to a real, verbatim quote from a real
> post. We verify that server-side, not just prompt for it: [show a citation link
> resolving to the real Reddit thread]."

**[1:45–3:00] Sponsor tools — be concrete, not just "we used X" (~75s)**

- *Bright Data*: "Terminal-only, per the rules — [show `npm run ingest:reddit` running
  live in a terminal]. It hits Bright Data's Direct API with a Bearer token, and we
  had to learn the hard way that omitting a `country` param gets you a 200 with an
  empty body — looks exactly like a block, isn't. Auto-repair: [run the
  `--simulate-break` / `--repair` drill live — see `docs/AUTO_REPAIR.md` for the exact
  commands] — we simulate a field-rename the way a real site update would break us,
  show it fail loudly with a named cause, then show the repair recovering all records."
- *Port*: **[FILL IN once the Port workspace is actually confirmed set up — see "Open
  items" below. Do not claim this in the video until you've looked at the real
  workspace on screen.]**
- *SigNoz*: **[FILL IN once you've confirmed traces are visible in the SigNoz
  dashboard — see "Open items" below. Show the actual dashboard with real span data
  from hitting the API, not just the code.]**

**[3:00–4:30] Live demo (~90s)**
Click through: home → Trends (show the sparkline + a real finding + citation) →
type a real question into the trends chat → Competitors (show OpenAI's profile +
ask a real comparison question, show the grounded answer with sources) → Monitoring
(ask what people appreciate about Claude, show the answer).

**[4:30–5:00] Close (~30s, optional if time allows)**
One sentence on what was learned (e.g. the Bright Data auth debugging, or the
citation-grounding architecture) and stop.

## Form answers

### What does your project do?

Meridian is a market-research tool built around one hard rule: every claim it makes
must trace back to a real, verbatim quote from a real, cited post — never a
paraphrase, never an invented statistic. It covers three use cases from one shared
data pipeline: **Trends** (statistical burst-detection over live social discourse,
no model decides what's trending — SQL does, the LLM only explains it), **Competitors**
(pricing, activity, and LLM-synthesized sentiment for a named competitor, combining
multiple real sources rather than one flat data point), and **Monitoring** (how a
company's own posts/products are actually being received). A chat interface on every
page lets a user ask a free-form question and get a grounded answer with real
citations — the chat itself is agentic: the model picks its own search terms
(including synonyms) via a forced tool call and can trigger a live Bright Data fetch,
rather than the app guessing what to search for.

### What problem does your project solve, and who is it for?

It's for anyone doing market/competitive research — PMs, marketers, founders — who
currently has two bad options: manually reading through Reddit threads (slow, doesn't
scale), or asking a generic AI assistant (fast, but it either can't see live social
discourse at all, or it hallucinates a plausible-sounding answer with no real source).
This closes that gap: real live data, gathered through Bright Data, with LLM synthesis
that's provably grounded — every citation is independently verified server-side as a
literal substring of the real post it claims to quote, and any claim that doesn't
verify gets dropped before it reaches the user, not silently kept.

### How did you use Bright Data in your project?

We scrape Reddit through Bright Data's Direct API (Web Unlocker product, Bearer
token auth) from the terminal only — `npm run ingest:reddit`, no dashboard. Three
subreddits map to the three use cases: r/singularity for general AI/tech trend
discourse, r/ChatGPTCoding for competitor (OpenAI/Codex) sentiment, and r/ClaudeAI for
monitoring our own reception. We also pull a company's public LinkedIn overview page
through the same Direct API for real competitor profile data. A real, re-runnable
auto-repair drill (`--simulate-break` / `--repair`, see `docs/AUTO_REPAIR.md`)
demonstrates the failure-detection-and-recovery path Bright Data data pipelines need:
we simulate a field-rename the way a real site update would break us, the ingest
fails loudly with a clear diagnostic naming the likely cause instead of silently
returning zero records, and a repair step with a field-alias fallback recovers the
real records on retry.

### How did you use Port in your project?

**[OPEN ITEM — do not fill in until confirmed.]** Port is registered as an MCP server
(`.mcp.json`, checked into the repo) and all three build agents (backend, frontend,
verifier) carry `mcp__port-us` in their tool list with instructions to catalog what
they ship as Port entities. In practice, Port MCP was **not reachable from any
subagent process this session** (confirmed by direct test — the tool doesn't even
appear in a subagent's tool list, not just an auth failure), so the real Port
workspace setup was delegated to a separate, already-authenticated session
(`aug22-a6`) with instructions to catalog: the five real services (ingest, detect,
api, chat, dashboard), the project's goals, the technical choices made (SQLite over
Postgres, Direct API over the Web Unlocker proxy, LinkedIn overview scraping), and
the risk factors (single live platform today, Bright Data account dependency, one
hallucination bug found and fixed in the chat layer). **Before submitting, open that
Port workspace and confirm it's actually populated** — screenshot it for the video,
and only write the real form answer once you've seen it with your own eyes.

### How did you use SigNoz in your project?

Every pipeline stage (ingest, detect, each API request) is wrapped in a real OTel
span (`src/otel.ts`) recording duration, record count, and failure reason as
attributes — this is real instrumentation, not console.log dressed up: spans are
created unconditionally so the code path is genuinely testable, and export to SigNoz
is a no-op only when `SIGNOZ_OTLP_ENDPOINT`/`SIGNOZ_INGESTION_KEY` aren't set. Those
are now set to a real SigNoz Cloud endpoint. **Open item: a manual test of the
ingestion endpoint returned 200 for an empty payload, and the app makes real
instrumented API calls with no export errors surfacing in logs — both good signs —
but nobody has actually opened the SigNoz dashboard and confirmed real trace data is
visible there.** Do this before filling in the real answer or recording the video
segment: hit a few API routes, then check the SigNoz dashboard for those traces
(latency, record counts, and any failure-reason attributes on a forced failure, e.g.
running the auto-repair `--simulate-break` drill and confirming that failure shows up
as a distinct signal, not just a log line).

## Open items before submitting (check these, then delete this section)

1. **Port workspace** — confirm `aug22-a6` actually populated a real Port workspace.
   If it didn't, do it manually before recording video — this is graded and explicitly
   called out as "never cut" in `CLAUDE.md`.
2. **SigNoz dashboard** — confirm real traces are visible, not just that the code
   emits them. Screenshot latency/error data for the video.
3. **Bright Data account** — confirm it's still active at recording time (it was
   suspended earlier this session and required an account-manager intervention).
4. Fill in the two `[FILL IN...]` video script sections once 1 and 2 are confirmed.
