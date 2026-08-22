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

async function getTrends(): Promise<Trend[]> {
  const base = process.env.INTERNAL_BASE_URL ?? 'http://localhost:3000';
  const res = await fetch(`${base}/api/trends`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`GET /api/trends failed: ${res.status}`);
  const data = await res.json();
  return data.trends ?? [];
}

export default async function TrendsPage() {
  let trends: Trend[] = [];
  let error: string | null = null;
  try {
    trends = await getTrends();
  } catch (err) {
    error = (err as Error).message;
  }

  const sorted = [...trends].sort((a, b) => b.score - a.score);

  return (
    <main>
      <p className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-teal">Discourse</p>
      <h1 className="font-display text-4xl font-semibold tracking-tight text-[#eef1f0]">Trends</h1>
      <p className="mt-3 text-silver">
        Burst-detected discourse, ranked by recent-count / prior-count.
      </p>
      {error && <p className="mt-6 text-red-400">Could not load trends: {error}</p>}
      {!error && sorted.length === 0 && <p className="mt-6 text-silver-dim">No trends yet.</p>}
      {sorted.length > 0 && (
        <Card className="glass-card mt-8 bg-transparent">
          <CardBody className="overflow-x-auto p-0">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-silver/10 text-xs uppercase tracking-wide text-silver-dim">
                  <th className="px-5 py-4 font-medium">Term</th>
                  <th className="px-5 py-4 font-medium">Recent count</th>
                  <th className="px-5 py-4 font-medium">Prior count</th>
                  <th className="px-5 py-4 font-medium">Score</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((t) => (
                  <tr key={t.id} className="border-b border-silver/5 last:border-0 transition-colors hover:bg-white/[0.03]">
                    <td className="px-5 py-4">
                      <Link href={`/trends/${t.id}`} className="font-medium text-[#eef1f0] hover:text-teal">
                        {t.term}
                      </Link>
                    </td>
                    <td className="px-5 py-4 text-silver">{t.recent_count}</td>
                    <td className="px-5 py-4 text-silver">{t.prior_count}</td>
                    <td className="px-5 py-4">
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
    </main>
  );
}
