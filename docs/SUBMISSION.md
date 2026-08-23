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

**0:20–1:10 — What it does**

> "This is Meridian, built for market researchers. Trends surfaces what's actually
> bubbling up in AI/tech discourse right now. Competitors goes deep on named
> competitors — OpenAI, Google, Meta, xAI — pricing, news, updates, and what people
> actually think of them, not just a spec sheet. Monitoring tracks how we ourselves
> are being received. It goes deeper than a search engine or a generic AI prompt
> because it's actually diving into real communities on Reddit, and related
> subreddits and topics, not just the one you typed in. We made it self-referential
> — Anthropic's the target, OpenAI's the competitor — so this is Claude's own team
> researching itself, off real data pulled live."

**1:10–1:50 — Stack**

> "Next.js, SQLite, Bright Data's Direct API for ingest, Claude for the chat layer.
> The one rule everything follows: every claim traces to a real quote from a real
> post. We check that server-side, not just in the prompt." [click a citation, show
> it resolve to the real thread]

**1:50–3:10 — Sponsor tools**

- **Bright Data**: run `npm run ingest:reddit` live. Mention the gotcha — no `country`
  param means a 200 with an empty body, which looks exactly like a block but isn't.
  Then run the auto-repair drill (`docs/AUTO_REPAIR.md`): break it, watch it fail
  loud with a real cause, repair it, watch it recover.
- **Port**: [open the workspace, show what's actually cataloged, say it plainly]
- **SigNoz**: [open the dashboard, show real traces from the routes you just hit]

**3:10–4:30 — Demo**
Click through: Trends (search a term, show the related-terms it picked up on its
own, a sparkline, a finding and its citation) → Competitors (OpenAI's profile, ask a
comparison question — show the synthesized pros/cons pulling from both Reddit and
LinkedIn, each line grounded in a real quote) → Monitoring (ask what people like
about Claude, same grounding).

**4:30–5:00 — Close (optional)**
One line on what you learned. Stop talking.

## Form answers

### What does your project do?

Meridian is a research tool for market researchers. It does three things: finds
what's trending with real users, digs into named competitors — pricing, news,
updates, and what people actually think of them — and monitors how your own
product is being received.

It goes deeper than a search engine or an AI prompt can. Ask ChatGPT what people
think of your product and it'll confidently make something up. Meridian won't —
every claim it makes has to point back to a real quote from a real post, or it
doesn't get said. And it doesn't stop at the one subreddit you typed in: it dives
into multiple communities and related topics on Reddit, decides what to search for
and picks its own synonyms, pulls fresh data live, and answers with receipts.

We built it to research Claude itself — what's trending in AI right now, how Claude
stacks up against OpenAI, Google, Meta, and xAI, and how people actually feel about
what we ship.

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
