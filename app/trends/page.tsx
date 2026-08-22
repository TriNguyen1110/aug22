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
      <h1>Trends</h1>
      <p>Burst-detected discourse, ranked by recent-count / prior-count.</p>
      {error && <p>Could not load trends: {error}</p>}
      {!error && sorted.length === 0 && <p>No trends yet.</p>}
      {sorted.length > 0 && (
        <table border={1} cellPadding={6} style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th>Term</th>
              <th>Recent count</th>
              <th>Prior count</th>
              <th>Score</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((t) => (
              <tr key={t.id}>
                <td><a href={`/trends/${t.id}`}>{t.term}</a></td>
                <td>{t.recent_count}</td>
                <td>{t.prior_count}</td>
                <td>{t.score.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
