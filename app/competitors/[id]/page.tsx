type Company = {
  id: string;
  name: string;
  domain: string;
  role: string;
};

type Snapshot = {
  id: string;
  company_id: string;
  item_type: string;
  label: string;
  value_text: string;
  url: string;
  captured_at: string;
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
  company_id: string | null;
  claim: string;
  quote: string;
  category: string;
  confidence: number;
};

async function getCompany(id: string) {
  const base = process.env.INTERNAL_BASE_URL ?? 'http://localhost:3000';
  const res = await fetch(`${base}/api/competitors/${id}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`GET /api/competitors/${id} failed: ${res.status}`);
  return res.json();
}

export default async function CompetitorDetailPage({ params }: { params: { id: string } }) {
  let company: Company | null = null;
  let snapshots: Snapshot[] = [];
  let findings: Finding[] = [];
  let posts: Post[] = [];
  let error: string | null = null;

  try {
    const data = await getCompany(params.id);
    company = data.company ?? null;
    snapshots = data.snapshots ?? [];
    findings = data.findings ?? [];
    posts = data.posts ?? [];
  } catch (err) {
    error = (err as Error).message;
  }

  const postById = new Map(posts.map((p) => [p.id, p]));

  return (
    <main>
      <p><a href="/competitors">Back to competitors</a></p>
      {error && <p>Could not load company: {error}</p>}
      {!error && !company && <p>Company not found.</p>}
      {company && (
        <>
          <h1>{company.name}</h1>
          <p>{company.domain}</p>

          <h2>Snapshots</h2>
          {snapshots.length === 0 && <p>No snapshots yet.</p>}
          {snapshots.length > 0 && (
            <table border={1} cellPadding={6} style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Label</th>
                  <th>Value</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {snapshots.map((s) => (
                  <tr key={s.id}>
                    <td>{s.item_type}</td>
                    <td>{s.label}</td>
                    <td>{s.value_text}</td>
                    <td><a href={s.url} target="_blank" rel="noreferrer">link</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

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
