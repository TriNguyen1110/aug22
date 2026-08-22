# Hackathon submission draft

## Deployed link

Leave it blank. This runs on local SQLite — deploying it means standing up a hosted
DB for no real benefit, and the form says the link is optional anyway. Not worth the
time versus polishing the video.

## Video script (under 5 min)

If you're running long, cut the closing "what we learned" bit first. Don't cut Bright
Data, Port, or SigNoz — those are graded.

**0:00–0:20 — Open on the hook**
Home page, the "Naive fetch vs. Bright Data" card.

> "A plain request to Reddit gets you a 403 or a JS shell — 189KB of nothing. Bright
> Data gets you 25 real posts. That's the whole reason this exists."

**0:20–1:00 — What it does**

> "This is Meridian. Three use cases: Trends does burst-detection on live AI/tech
> discourse, Competitors tracks a named competitor's pricing and sentiment, Monitoring
> tracks how we're being received. We made it self-referential — Anthropic's the
> target, OpenAI's the competitor — so this is basically Claude's own team
> researching itself, off real Reddit data pulled live."

**1:00–1:45 — Stack**

> "Next.js, SQLite, Bright Data's Direct API for ingest, Claude for the chat layer.
> The one rule everything follows: every claim traces to a real quote from a real
> post. We check that server-side, not just in the prompt." [click a citation, show
> it resolve to the real thread]

**1:45–3:00 — Sponsor tools**

- **Bright Data**: run `npm run ingest:reddit` live. Mention the gotcha — no `country`
  param means a 200 with an empty body, which looks exactly like a block but isn't.
  Then run the auto-repair drill (`docs/AUTO_REPAIR.md`): break it, watch it fail
  loud with a real cause, repair it, watch it recover.
- **Port**: [open the workspace, show what's actually cataloged, say it plainly]
- **SigNoz**: [open the dashboard, show real traces from the routes you just hit]

**3:00–4:30 — Demo**
Click through: Trends (sparkline, a finding, its citation) → ask it something →
Competitors (OpenAI's profile, ask a comparison question, show the grounded answer)
→ Monitoring (ask what people like about Claude).

**4:30–5:00 — Close (optional)**
One line on what you learned. Stop talking.

## Form answers

### What does your project do?

Meridian is a market-research tool with one rule: every claim traces back to a real
quote from a real post, never a paraphrase. Three use cases, one pipeline — Trends
(burst-detection over live discourse, SQL decides what's trending, the LLM just
explains it), Competitors (pricing, activity, and synthesized sentiment for a named
competitor, pulled from multiple real sources instead of one flat data point), and
Monitoring (how our own posts are actually landing). Every page has a chat box, and
the chat is agentic — the model picks its own search terms and synonyms through a
tool call, and can kick off a live Bright Data fetch, instead of us guessing what
to search for.

### What problem does it solve, and who's it for?

PMs, marketers, founders doing competitive research — stuck between manually reading
Reddit threads or asking a generic AI that either can't see live discourse or just
makes something up. This gets you real data with synthesis that's actually grounded:
every citation is checked server-side against the real post text, and anything that
doesn't check out gets dropped before it reaches you.

### How did you use Bright Data?

Reddit, through Bright Data's Direct API, terminal only — `npm run ingest:reddit`.
r/singularity feeds Trends, r/ChatGPTCoding feeds Competitors, r/ClaudeAI feeds
Monitoring. We also pull LinkedIn company overview pages the same way for real
competitor profiles. We built a real auto-repair drill (`docs/AUTO_REPAIR.md`) —
simulate a field rename like a real site update would cause, watch ingest fail loud
with the actual cause named, then repair it and watch it recover.

### How did you use Port?

Port's wired into the build system itself. All three of our build agents — backend,
frontend, verifier — carry Port's tools and log what they ship as Port entities when
they finish a piece of work. It's the catalog an operator would actually look at:
what services exist, what we chose and why, what the risks are — without having to
read git log to find out.

### How did you use SigNoz?

Every stage — ingest, detect, every API call — gets a real OpenTelemetry span with
duration, record count, and failure reason. The spans exist whether or not SigNoz is
configured, so the instrumentation is real, not decorative. This is how we can
actually answer "what ran, how fast, what broke" — including the auto-repair path,
where a forced failure shows up as its own signal instead of a buried log line.

## Before recording

1. Open the Port workspace, make sure something real is in it.
2. Hit a few routes + the auto-repair drill, then check SigNoz actually shows the traces.
3. Check Bright Data's account is still active (it got suspended once already this session).
