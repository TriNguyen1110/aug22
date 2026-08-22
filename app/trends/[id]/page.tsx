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
      <p><a href="/trends">Back to trends</a></p>
      {error && <p>Could not load trend: {error}</p>}
      {!error && !trend && <p>Trend not found.</p>}
      {trend && (
        <>
          <h1>{trend.term}</h1>
          <p>
            Recent: {trend.recent_count} · Prior: {trend.prior_count} · Score:{' '}
            {trend.score.toFixed(2)}
          </p>
          <p>
            Window: {trend.window_start} to {trend.window_end}
          </p>
          <h2>Findings</h2>
          {findings.length === 0 && <p>No findings yet.</p>}
          <ul>
            {findings.map((f) => {
              const post = postById.get(f.post_id);
              return (
                <li key={f.id} style={{ marginBottom: '1rem' }}>
                  <p>{f.claim}</p>
                  <blockquote>&quot;{f.quote}&quot;</blockquote>
                  {post ? (
                    <a href={post.url} target="_blank" rel="noreferrer">
                      Source: {post.platform} / {post.author}
                    </a>
                  ) : (
                    <span>Source post unavailable</span>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </main>
  );
}
