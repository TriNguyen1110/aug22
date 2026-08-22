# Hackathon insights

Event: WeMakeDevs, hosted at Bright Data, 625 2nd St, San Francisco. Judged by Anthropic engineers.
Sponsors and required tools: Port, Bright Data Scraper Studio, SigNoz.

## Rubric, from the listing

Grand prize, NVIDIA DGX Spark, ~$5,000: "Best Full-Stack Integration," for seamlessly combining
all three tools into one complete pipeline.

Track prizes, Keychron keyboard per team member, ~$120:
- Port: clearest workspace showing goals, technical choices, risk factors, cataloged services
- Bright Data: pure terminal workflow, proper scraper rules configuration, clean JSON output,
  working auto-repair execution
- SigNoz: active tracing, log collection, metric tracking across data endpoints and background jobs

Grand prize is ~40x a track prize, so completeness across three tools beats depth in one.

Mandatory submissions: GitHub repo with commit history and README, plus a 3 to 5 minute demo video
showing terminal workflow, Port dashboard, live SigNoz monitoring, and auto-repair working.
A missing video is a zero regardless of code.

Originality is not a judging criterion anywhere in the listing.

## Verified experiment: naive scraping fails silently

Run locally, no API keys. Both plain curl and a browser user agent.

| Target | Naive | Browser UA | Result |
|---|---|---|---|
| `reddit.com/r/SaaS.json` | 403 | 403 | Blocked |
| `reddit.com/r/SaaS/` | 200 | 200 | 8,400 bytes, 0 post titles, JS shell only |
| `instagram.com/explore/tags/saas/` | 302 | 200 + wall | Login wall |
| `x.com/search?q=saas` | 200 + wall | 200 + wall | Login wall |
| `facebook.com/groups/discover/` | 200 + wall | 400 | Wall, then rejected |

The Reddit row is the demo spine. HTTP 200 with zero records is a success code that lies, and it
is the failure mode that ties all three tools into one story:

- Bright Data is what returns actual records
- SigNoz is the only way to notice, since the signal is `records_extracted == 0` while HTTP stays green
- Port is where that failure mode is logged as a project risk before code is written

## Firecrawl comparison

Firecrawl blocks social media by policy. Instagram, YouTube, and TikTok return
"This website is no longer supported." It does have stealth and mobile proxy modes, so a claim
that it "cannot do logins" would be contestable. The policy block is not.

Source caveat: this came from competitor blogs. Reproduce it locally with the existing
`FIRECRAWL_API_KEY` before repeating it, so the evidence is first-party.

Depth difference that matters: Bright Data returns typed records with a stable `post_id` join key.
Firecrawl returns prose that has to be re-structured by an LLM, which is where hallucinated
citations come from.

## Bright Data catalog, verified

11 platforms. Field availability decides the design.

| Platform | Posts | Comments | Extras |
|---|---|---|---|
| Facebook | Pages, Groups, Reels | Yes | Company Reviews, Marketplace, Events |
| Reddit | Yes | Yes | Community name on both |
| Instagram | Posts, Reels | Yes | Profiles with business/verified flags |
| TikTok | Yes | Yes | Engagement rates, digg/share/collect counts |
| YouTube | Videos | Yes | Channels, subscriber counts |
| X | Yes | **No** | Profiles, quoted posts |
| LinkedIn | Yes | **No** | Post text, headline |
| Pinterest, Quora, Bluesky, Vimeo | Yes | Partial | |

X and LinkedIn have no comment endpoint. Complaints and reactions live in comments, so those two
are wrong targets despite being the most obviously login-gated.

Primary target: Reddit. Long-form quotable complaints, posts and comments both available,
community name gives free audience segmentation, and it is genuinely hostile to scrapers since
the API lockdown. Fallback: Facebook, richer via Company Reviews and Group posts, more moving parts.

Reels give URL, user, description, hashtags, comments, date, likes, views. No video, no transcript.

## Architecture

Schema is the seam. Write it first, seed it with fake rows immediately, then nothing waits on
a real scrape.

```
posts    (id, platform, author, url, text, posted_at, fetched_at)
findings (id, post_id, claim, quote, category, confidence)
```

Services, kept separate because Port wants a catalog and SigNoz wants background jobs traced:

```
ingest worker   -> posts        (Bright Data, terminal only)
detect job      -> trends       (SQL burst score)
enrich worker   -> explanations (top 5 only, multimodal)   [FIRST TO CUT]
api + dashboard -> reads all three
```

Trend detection, no LLM in the detection step:

1. Pull posts across a date range, not a snapshot
2. Extract hashtags and 1 to 3 word n-grams from captions and comments
3. Bucket by day
4. Score = count in last 3 days / count in prior 14 days, with a floor on absolute count
5. Rank by score

Statistics find the trend. The LLM only names it and cites the posts that drove it. Every claim
resolves to a real post, checked by the verifier agent.

## Must verify before Saturday

1. Does the collector return posts across a date range, or only a snapshot? If snapshot only,
   the growth ratio is impossible and the whole detection design collapses. Check this first.
2. One authenticated collector call returning real JSON from the terminal.
3. How auto-repair triggers, and how to force it on demand.
4. Whether a video media file can actually be retrieved. Signed short-lived URLs are likely.
5. Does SigNoz receive traces. Cloud or self-hosted.
6. Actual event start time and submission cutoff. The listing only says "end of the day."

## Cut order, decided in advance

1. Enrichment worker, multimodal. Gone from the start when solo.
2. Template recommendation output.
3. Dashboard polish. A plain table with real cited data demos fine.
4. Never the video, never Port, never auto-repair.

## Fallbacks

- Collector will not authenticate -> switch platform
- No dated history -> collect twice a few days apart, or rank by volume instead of growth
- Media download fails -> text and comments only
- Dashboard behind -> plain HTML table
- Wifi saturated -> cached scrape results plus a `--cached` flag, phone hotspot as backup

45 minute rabbit hole rule. If a component is not working in 45 minutes, take the fallback.

## Day-of shape, hours from build start

```
H+0.0  Port workspace finalized, repo cloned, deps installed
H+1.0  Schema written, seeded with fake rows
H+2.0  ONE real authenticated call returning records   <- hard checkpoint
H+3.0  Ingest writing to posts, OTel spans visible in SigNoz
H+4.0  Burst score query returning ranked terms
H+5.0  Auto-repair working, record that video segment immediately
H+6.0  Dashboard reading real data
H-1.5  Stop building. README, Port catalog, assemble video.
```

Record video segments as each piece starts working, never all at the end. This is the whole
solo strategy: it converts four simultaneous deadlines into a series.

## Competitive landscape

Social listening is a mature, expensive category: Brandwatch, Sprinklr, Meltwater, Talkwalker,
Brand24, Awario. Pricing runs $29/month to $150,000+/year. Sprinklr alone runs over 10 billion
predictions per day.

GummySearch, the closest existing product to Reddit pain-point mining, closed to new customers
on 30 November 2025 and is winding down through 2026. Validates the wedge and warns it was hard
to hold. Data access is both the moat and the thing that kills you.

TikTok Creative Center is free, official, and shows trending hashtags and sounds without a login.
It is TikTok only.

Do not claim novelty on stage. The defensible claim: existing tools chart volume, this one
explains the format.

## Notes on presenting

Open on the silent 200, not on a personal introduction. First 20 seconds decide whether judges
keep watching, and with roughly 40 to 70 finished submissions they will watch videos rather
than read code.

Show Bright Data against the naive result side by side, 15 seconds, no editorializing about
competitors. Then move to auto-repair, which is what is actually graded.

Expect roughly 200 to 250 people present out of 400 registered, and far fewer finished
submissions. Finishing is a bigger filter than quality.
