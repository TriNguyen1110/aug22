import { Card, CardBody, Chip, Link } from '@heroui/react';

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
      <Link href="/trends" className="text-sm">
        &larr; Back to trends
      </Link>
      {error && <p className="mt-6 text-red-600">Could not load trend: {error}</p>}
      {!error && !trend && <p className="mt-6 text-slate-500">Trend not found.</p>}
      {trend && (
        <>
          <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900">
            {trend.term}
          </h1>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-slate-600">
            <span>Recent: {trend.recent_count}</span>
            <span>&middot;</span>
            <span>Prior: {trend.prior_count}</span>
            <span>&middot;</span>
            <span>Score:</span>
            <Chip size="sm" variant="flat" color="primary">
              {trend.score.toFixed(2)}
            </Chip>
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Window: {trend.window_start} to {trend.window_end}
          </p>

          <h2 className="mt-8 text-xl font-semibold text-slate-900">Findings</h2>
          {findings.length === 0 && <p className="mt-2 text-slate-500">No findings yet.</p>}
          <ul className="mt-4 space-y-4">
            {findings.map((f) => {
              const post = postById.get(f.post_id);
              return (
                <li key={f.id}>
                  <Card className="border border-slate-200 shadow-sm">
                    <CardBody>
                      <p className="text-slate-800">{f.claim}</p>
                      <blockquote className="mt-2 border-l-2 border-slate-300 pl-3 italic text-slate-600">
                        &quot;{f.quote}&quot;
                      </blockquote>
                      {post ? (
                        <Link
                          href={post.url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-3 inline-block text-sm"
                        >
                          Source: {post.platform} / {post.author}
                        </Link>
                      ) : (
                        <span className="mt-3 inline-block text-sm text-slate-400">
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
