import { Card, CardBody, Link } from '@heroui/react';

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
      <h1 className="text-3xl font-bold tracking-tight text-slate-900">Monitoring</h1>
      <p className="mt-2 text-slate-600">How people react to Notion&apos;s own posts.</p>
      {error && <p className="mt-6 text-red-600">Could not load monitoring data: {error}</p>}
      {!error && findings.length === 0 && <p className="mt-6 text-slate-500">No findings yet.</p>}
      <ul className="mt-6 space-y-4">
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
    </main>
  );
}
