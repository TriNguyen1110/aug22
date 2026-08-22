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
      <p className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-teal">Reception</p>
      <h1 className="font-display text-4xl font-semibold tracking-tight text-[#eef1f0]">Monitoring</h1>
      <p className="mt-3 text-silver">How people react to Notion&apos;s own posts.</p>
      {error && <p className="mt-6 text-red-400">Could not load monitoring data: {error}</p>}
      {!error && findings.length === 0 && <p className="mt-6 text-silver-dim">No findings yet.</p>}
      <ul className="mt-8 space-y-4">
        {findings.map((f) => {
          const post = postById.get(f.post_id);
          return (
            <li key={f.id}>
              <Card className="glass-card bg-transparent">
                <CardBody>
                  <p className="text-[#eef1f0]">{f.claim}</p>
                  <blockquote className="mt-3 border-l-2 border-teal/40 pl-3 italic text-silver">
                    &quot;{f.quote}&quot;
                  </blockquote>
                  {post ? (
                    <Link
                      href={post.url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 inline-block text-sm text-teal hover:text-teal-dim"
                    >
                      Source: {post.platform} / {post.author}
                    </Link>
                  ) : (
                    <span className="mt-3 inline-block text-sm text-silver-dim">
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
