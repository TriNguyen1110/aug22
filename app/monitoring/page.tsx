type Post = {
  id: string;
  url: string;
  author: string;
  platform: string;
  text: string;
  posted_at: string;
};

type Finding = {
  id: string;
  post_id: string;
  claim: string;
  quote: string;
  category: string;
  confidence: number;
};

async function getMonitoring() {
  const base = process.env.INTERNAL_BASE_URL ?? 'http://localhost:3000';
  const res = await fetch(`${base}/api/monitoring`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`GET /api/monitoring failed: ${res.status}`);
  return res.json();
}

export default async function MonitoringPage() {
  let posts: Post[] = [];
  let findings: Finding[] = [];
  let error: string | null = null;

  try {
    const data = await getMonitoring();
    posts = data.posts ?? [];
    findings = data.findings ?? [];
  } catch (err) {
    error = (err as Error).message;
  }

  const postById = new Map(posts.map((p) => [p.id, p]));

  return (
    <main>
      <h1>Monitoring</h1>
      <p>How people react to Notion&apos;s own posts.</p>
      {error && <p>Could not load monitoring data: {error}</p>}
      {!error && findings.length === 0 && <p>No findings yet.</p>}
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
    </main>
  );
}
