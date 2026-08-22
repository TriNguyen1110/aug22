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
      <h1 className="text-3xl font-bold tracking-tight text-slate-900">Trends</h1>
      <p className="mt-2 text-slate-600">
        Burst-detected discourse, ranked by recent-count / prior-count.
      </p>
      {error && <p className="mt-6 text-red-600">Could not load trends: {error}</p>}
      {!error && sorted.length === 0 && <p className="mt-6 text-slate-500">No trends yet.</p>}
      {sorted.length > 0 && (
        <Card className="mt-6 border border-slate-200 shadow-sm">
          <CardBody className="overflow-x-auto p-0">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                  <th className="px-5 py-3 font-medium">Term</th>
                  <th className="px-5 py-3 font-medium">Recent count</th>
                  <th className="px-5 py-3 font-medium">Prior count</th>
                  <th className="px-5 py-3 font-medium">Score</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((t) => (
                  <tr key={t.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <Link href={`/trends/${t.id}`} className="font-medium">
                        {t.term}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-slate-700">{t.recent_count}</td>
                    <td className="px-5 py-3 text-slate-700">{t.prior_count}</td>
                    <td className="px-5 py-3">
                      <Chip size="sm" variant="flat" color="primary">
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
