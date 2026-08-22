import { Card, CardBody, Chip, Link } from '@heroui/react';
import { PageChat } from '../../components/PageChat';
import { FindingCard } from '../../components/FindingCard';
import { splitSeed, SeedDivider } from '../../components/seedSplit';

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

async function getTrends(): Promise<Trend[]> {
  const base = process.env.INTERNAL_BASE_URL ?? 'http://localhost:3000';
  const res = await fetch(`${base}/api/trends`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`GET /api/trends failed: ${res.status}`);
  const data = await res.json();
  return data.trends ?? [];
}

async function searchTrends(q: string) {
  const base = process.env.INTERNAL_BASE_URL ?? 'http://localhost:3000';
  const res = await fetch(`${base}/api/trends?q=${encodeURIComponent(q)}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`GET /api/trends?q=${q} failed: ${res.status}`);
  return res.json();
}

export default async function TrendsPage({
  searchParams,
}: {
  searchParams?: { q?: string };
}) {
  const q = searchParams?.q?.trim() || '';

  let trends: Trend[] = [];
  let error: string | null = null;

  let matchedPosts: number | null = null;
  let searchTrendsResult: Trend[] = [];
  let searchFindings: Finding[] = [];
  let searchPosts: Post[] = [];
  let searchError: string | null = null;

  try {
    trends = await getTrends();
  } catch (err) {
    error = (err as Error).message;
  }

  if (q) {
    try {
      const data = await searchTrends(q);
      matchedPosts = typeof data.matched_posts === 'number' ? data.matched_posts : null;
      searchTrendsResult = data.trends ?? [];
      searchFindings = data.findings ?? [];
      searchPosts = data.posts ?? [];
    } catch (err) {
      searchError = (err as Error).message;
    }
  }

  const sorted = [...trends].sort((a, b) => b.score - a.score);
  const postById = new Map(searchPosts.map((p) => [p.id, p]));

  return (
    <main className="space-y-12">
      <section>
        <p className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-teal">Discourse</p>
        <h1 className="font-display text-4xl font-semibold tracking-tight text-[#eef1f0] sm:text-5xl">
          Trends
        </h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-silver">
          Burst-detected discourse, ranked by recent-count / prior-count.
        </p>
      </section>

      <section>
        <form action="/trends" method="get" className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="Search discourse by term..."
            className="w-full max-w-md rounded-md border border-silver/20 bg-transparent px-4 py-2 text-sm text-[#eef1f0] placeholder:text-silver-dim focus:border-teal focus:outline-none"
          />
          <button
            type="submit"
            className="rounded-md bg-teal px-4 py-2 text-sm font-medium text-[#0a0d0c] hover:bg-teal-dim"
          >
            Search
          </button>
          {q && (
            <Link href="/trends" className="text-sm text-silver hover:text-teal">
              Clear
            </Link>
          )}
        </form>
      </section>

      {q && (
        <section>
          <h2 className="font-display text-2xl font-semibold text-[#eef1f0]">
            Search results for &quot;{q}&quot;
          </h2>
          {searchError && (
            <p className="mt-3 text-red-400">Could not search trends: {searchError}</p>
          )}
          {!searchError && matchedPosts !== null && (
            <p className="mt-3 text-sm text-silver-dim">
              {matchedPosts === 0
                ? `No posts found for "${q}".`
                : `${matchedPosts} matching post${matchedPosts === 1 ? '' : 's'} for "${q}".`}
            </p>
          )}

          {!searchError && matchedPosts !== null && matchedPosts > 0 && (
            <>
              {searchTrendsResult.length > 0 && (
                <Card className="glass-card mt-6 bg-transparent">
                  <CardBody className="overflow-x-auto p-0">
                    <table className="w-full border-collapse text-left text-sm">
                      <thead>
                        <tr className="border-b border-silver/10 text-xs uppercase tracking-wide text-silver-dim">
                          <th className="px-6 py-5 font-medium">Term</th>
                          <th className="px-6 py-5 font-medium">Recent count</th>
                          <th className="px-6 py-5 font-medium">Prior count</th>
                          <th className="px-6 py-5 font-medium">Score</th>
                        </tr>
                      </thead>
                      <tbody>
                        {searchTrendsResult.map((t) => (
                          <tr
                            key={t.id}
                            className="border-b border-silver/5 last:border-0 transition-colors hover:bg-white/[0.03]"
                          >
                            <td className="px-6 py-5 font-medium text-[#eef1f0]">{t.term}</td>
                            <td className="px-6 py-5 text-silver">{t.recent_count}</td>
                            <td className="px-6 py-5 text-silver">{t.prior_count}</td>
                            <td className="px-6 py-5">
                              <Chip size="sm" variant="flat" className="chip-score">
                                {t.score.toFixed(2)}
                              </Chip>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardBody>
                </Card>
              )}

              {searchFindings.length > 0 && (() => {
                const { real, seed } = splitSeed(searchFindings, (f) => f.post_id);
                return (
                  <div className="mt-6">
                    <h3 className="font-display text-xl font-semibold text-[#eef1f0]">Findings</h3>
                    {real.length > 0 && (
                      <ul className="mt-4 space-y-6">
                        {real.map((f) => (
                          <li key={f.id}>
                            <FindingCard finding={f} post={postById.get(f.post_id)} />
                          </li>
                        ))}
                      </ul>
                    )}
                    {real.length > 0 && seed.length > 0 && <SeedDivider />}
                    {seed.length > 0 && (
                      <ul className={`${real.length > 0 ? '' : 'mt-4'} space-y-6`}>
                        {seed.map((f) => (
                          <li key={f.id}>
                            <FindingCard finding={f} post={postById.get(f.post_id)} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })()}
            </>
          )}
        </section>
      )}

      <section>
        <h2 className="font-display text-2xl font-semibold text-[#eef1f0]">All trends</h2>
        {error && <p className="mt-3 text-red-400">Could not load trends: {error}</p>}
        {!error && sorted.length === 0 && <p className="mt-3 text-silver-dim">No trends yet.</p>}
        {sorted.length > 0 && (
          <Card className="glass-card mt-6 bg-transparent">
            <CardBody className="overflow-x-auto p-0">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-silver/10 text-xs uppercase tracking-wide text-silver-dim">
                    <th className="px-6 py-5 font-medium">Term</th>
                    <th className="px-6 py-5 font-medium">Recent count</th>
                    <th className="px-6 py-5 font-medium">Prior count</th>
                    <th className="px-6 py-5 font-medium">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((t) => (
                    <tr key={t.id} className="border-b border-silver/5 last:border-0 transition-colors hover:bg-white/[0.03]">
                      <td className="px-6 py-5">
                        <Link href={`/trends/${t.id}`} className="font-medium text-[#eef1f0] hover:text-teal">
                          {t.term}
                        </Link>
                      </td>
                      <td className="px-6 py-5 text-silver">{t.recent_count}</td>
                      <td className="px-6 py-5 text-silver">{t.prior_count}</td>
                      <td className="px-6 py-5">
                        <Chip size="sm" variant="flat" className="chip-score">
                          {t.score.toFixed(2)}
                        </Chip>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardBody>
          </Card>
        )}
      </section>

      <PageChat scope="trends" label="trends" />
    </main>
  );
}
