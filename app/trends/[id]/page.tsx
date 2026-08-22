import { Card, CardBody, Chip, Link } from '@heroui/react';
import { ArrowLeft } from 'lucide-react';

type Trend = {
  id: string;
  term: string;
  recent_count: number;
  prior_count: number;
  score: number;
  window_start: string;
  window_end: string;
};

type Post = {
  id: string;
  url: string;
  author: string;
  platform: string;
  text: string;
};

type Finding = {
  id: string;
  post_id: string;
  trend_id: string | null;
  claim: string;
  quote: string;
  category: string;
  confidence: number;
};

async function getTrend(id: string) {
  const base = process.env.INTERNAL_BASE_URL ?? 'http://localhost:3000';
  const res = await fetch(`${base}/api/trends/${id}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`GET /api/trends/${id} failed: ${res.status}`);
  return res.json();
}

export default async function TrendDetailPage({ params }: { params: { id: string } }) {
  let trend: Trend | null = null;
  let findings: Finding[] = [];
  let posts: Post[] = [];
  let error: string | null = null;

  try {
    const data = await getTrend(params.id);
    trend = data.trend ?? null;
    findings = data.findings ?? [];
    posts = data.posts ?? [];
  } catch (err) {
    error = (err as Error).message;
  }

  const postById = new Map(posts.map((p) => [p.id, p]));

  return (
    <main>
      <Link href="/trends" className="inline-flex items-center gap-1.5 text-sm text-silver hover:text-teal">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to trends
      </Link>
      {error && <p className="mt-6 text-red-400">Could not load trend: {error}</p>}
      {!error && !trend && <p className="mt-6 text-silver-dim">Trend not found.</p>}
      {trend && (
        <>
          <h1 className="mt-5 font-display text-4xl font-semibold tracking-tight text-[#eef1f0]">
            {trend.term}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-silver">
            <span>Recent: {trend.recent_count}</span>
            <span className="text-silver-dim">&middot;</span>
            <span>Prior: {trend.prior_count}</span>
            <span className="text-silver-dim">&middot;</span>
            <span>Score:</span>
            <Chip size="sm" variant="flat" className="chip-score">
              {trend.score.toFixed(2)}
            </Chip>
          </div>
          <p className="mt-1 text-sm text-silver-dim">
            Window: {trend.window_start} to {trend.window_end}
          </p>

          <h2 className="mt-10 font-display text-xl font-semibold text-[#eef1f0]">Findings</h2>
          {findings.length === 0 && <p className="mt-2 text-silver-dim">No findings yet.</p>}
          <ul className="mt-5 space-y-4">
            {findings.map((f) => {
              const post = postById.get(f.post_id);
              return (
                <li key={f.id}>
                  <Card className="glass-card bg-transparent">
                    <CardBody>
                      <p className="text-[#eef1f0]">{f.claim}</p>
                      <blockquote className="mt-3 border-l-2 border-teal/40 pl-3 italic text-silver">
                        &quot;{f.quote}&quot;
                      </blockquote>
                      {post ? (
                        <Link
                          href={post.url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-3 inline-block text-sm text-teal hover:text-teal-dim"
                        >
                          Source: {post.platform} / {post.author}
                        </Link>
                      ) : (
                        <span className="mt-3 inline-block text-sm text-silver-dim">
                          Source post unavailable
                        </span>
                      )}
                    </CardBody>
                  </Card>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </main>
  );
}
