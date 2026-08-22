import { Card, CardBody, Link } from '@heroui/react';
import { ArrowLeft } from 'lucide-react';
import { FindingCard } from '../../../components/FindingCard';

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
    <main className="space-y-12">
      <div>
        <Link href="/competitors" className="inline-flex items-center gap-1.5 text-sm text-silver hover:text-teal">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to competitors
        </Link>
      </div>
      {error && <p className="text-red-400">Could not load company: {error}</p>}
      {!error && !company && <p className="text-silver-dim">Company not found.</p>}
      {company && (
        <>
          <section>
            <h1 className="font-display text-4xl font-semibold tracking-tight text-[#eef1f0] sm:text-5xl">
              {company.name}
            </h1>
            <p className="mt-2 text-silver-dim">{company.domain}</p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-semibold text-[#eef1f0]">Snapshots</h2>
            {snapshots.length === 0 && <p className="mt-3 text-silver-dim">No snapshots yet.</p>}
            {snapshots.length > 0 && (
              <Card className="glass-card mt-6 bg-transparent">
                <CardBody className="overflow-x-auto p-0">
                  <table className="w-full border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b border-silver/10 text-xs uppercase tracking-wide text-silver-dim">
                        <th className="px-6 py-5 font-medium">Type</th>
                        <th className="px-6 py-5 font-medium">Label</th>
                        <th className="px-6 py-5 font-medium">Value</th>
                        <th className="px-6 py-5 font-medium">Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {snapshots.map((s) => (
                        <tr key={s.id} className="border-b border-silver/5 last:border-0 transition-colors hover:bg-white/[0.03]">
                          <td className="px-6 py-5 text-silver">{s.item_type}</td>
                          <td className="px-6 py-5 text-silver">{s.label}</td>
                          <td className="px-6 py-5 text-silver">{s.value_text}</td>
                          <td className="px-6 py-5">
                            <Link href={s.url} target="_blank" rel="noreferrer" className="text-sm text-teal hover:text-teal-dim">
                              link
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardBody>
              </Card>
            )}
          </section>

          <section>
            <h2 className="font-display text-2xl font-semibold text-[#eef1f0]">Findings</h2>
            {findings.length === 0 && <p className="mt-3 text-silver-dim">No findings yet.</p>}
            {findings.length > 0 && (
              <ul className="mt-6 space-y-6">
                {findings.map((f) => {
                  const post = postById.get(f.post_id);
                  return (
                    <li key={f.id}>
                      <FindingCard finding={f} post={post} />
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}
