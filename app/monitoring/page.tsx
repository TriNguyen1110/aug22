import { FindingCard } from '../../components/FindingCard';
import { PageChat } from '../../components/PageChat';
import { splitSeed, SeedDivider } from '../../components/seedSplit';

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
    <main className="space-y-12">
      <section>
        <p className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-teal">Reception</p>
        <h1 className="font-display text-4xl font-semibold tracking-tight text-[#eef1f0] sm:text-5xl">
          Monitoring
        </h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-silver">
          How people react to Anthropic&apos;s own posts and products.
        </p>
      </section>
      {error && <p className="text-red-400">Could not load monitoring data: {error}</p>}
      {!error && findings.length === 0 && <p className="text-silver-dim">No findings yet.</p>}
      {findings.length > 0 && (() => {
        const { real, seed } = splitSeed(findings, (f) => f.post_id);
        return (
          <>
            {real.length > 0 && (
              <ul className="space-y-6">
                {real.map((f) => (
                  <li key={f.id}>
                    <FindingCard finding={f} post={postById.get(f.post_id)} />
                  </li>
                ))}
              </ul>
            )}
            {real.length > 0 && seed.length > 0 && <SeedDivider />}
            {seed.length > 0 && (
              <ul className="space-y-6">
                {seed.map((f) => (
                  <li key={f.id}>
                    <FindingCard finding={f} post={postById.get(f.post_id)} />
                  </li>
                ))}
              </ul>
            )}
          </>
        );
      })()}
      <PageChat scope="own" label="monitoring" />
    </main>
  );
}
