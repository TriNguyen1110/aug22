import { Chip, Link } from '@heroui/react';
import { ArrowLeft } from 'lucide-react';
import { FindingCard } from '../../../components/FindingCard';

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
    <main className="space-y-12">
      <div>
        <Link href="/trends" className="inline-flex items-center gap-1.5 text-sm text-silver hover:text-teal">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to trends
        </Link>
      </div>
      {error && <p className="text-red-400">Could not load trend: {error}</p>}
      {!error && !trend && <p className="text-silver-dim">Trend not found.</p>}
      {trend && (
        <>
          <section>
            <h1 className="font-display text-4xl font-semibold tracking-tight text-[#eef1f0] sm:text-5xl">
              {trend.term}
            </h1>
            <div className="mt-4 flex flex-wrap items-center gap-2 text-silver">
              <span>Recent: {trend.recent_count}</span>
              <span className="text-silver-dim">&middot;</span>
              <span>Prior: {trend.prior_count}</span>
              <span className="text-silver-dim">&middot;</span>
              <span>Score:</span>
              <Chip size="sm" variant="flat" className="chip-score">
                {trend.score.toFixed(2)}
              </Chip>
            </div>
            <p className="mt-2 text-sm text-silver-dim">
              Window: {trend.window_start} to {trend.window_end}
            </p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-semibold text-[#eef1f0]">Findings</h2>
            {findings.length === 0 && <p className="mt-3 text-silver-dim">No findings yet.</p>}
            {findings.length > 0 && (
              <ul className="mt-6 space-y-6">
                {findings.map((f) => {
                  const post = postById.get(f.post_id);
                  return (
                    <li key={f.id}>
                      <FindingCard finding={f} post={post} />
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}
