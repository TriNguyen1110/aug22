import { Link } from '@heroui/react';
import { ArrowLeft } from 'lucide-react';
import { FindingCard } from '../../../components/FindingCard';
import { SnapshotTable } from '../../../components/SnapshotTable';
import { splitSeed, SeedDivider } from '../../../components/seedSplit';

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
              <div className="mt-6">
                <SnapshotTable snapshots={snapshots} />
              </div>
            )}
          </section>

          <section>
            <h2 className="font-display text-2xl font-semibold text-[#eef1f0]">Findings</h2>
            {findings.length === 0 && <p className="mt-3 text-silver-dim">No findings yet.</p>}
            {findings.length > 0 && (() => {
              const { real, seed } = splitSeed(findings, (f) => f.post_id);
              return (
                <>
                  {real.length > 0 && (
                    <ul className="mt-6 space-y-6">
                      {real.map((f) => (
                        <li key={f.id}>
                          <FindingCard finding={f} post={postById.get(f.post_id)} />
                        </li>
                      ))}
                    </ul>
                  )}
                  {real.length > 0 && seed.length > 0 && <SeedDivider />}
                  {seed.length > 0 && (
                    <ul className={`${real.length > 0 ? '' : 'mt-6'} space-y-6`}>
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
          </section>
        </>
      )}
    </main>
  );
}
