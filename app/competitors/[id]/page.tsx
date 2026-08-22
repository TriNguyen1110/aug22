import { Card, CardBody, Link } from '@heroui/react';

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
      <Link href="/competitors" className="text-sm">
        &larr; Back to competitors
      </Link>
      {error && <p className="mt-6 text-red-600">Could not load company: {error}</p>}
      {!error && !company && <p className="mt-6 text-slate-500">Company not found.</p>}
      {company && (
        <>
          <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900">
            {company.name}
          </h1>
          <p className="mt-1 text-slate-500">{company.domain}</p>

          <h2 className="mt-8 text-xl font-semibold text-slate-900">Snapshots</h2>
          {snapshots.length === 0 && <p className="mt-2 text-slate-500">No snapshots yet.</p>}
          {snapshots.length > 0 && (
            <Card className="mt-3 border border-slate-200 shadow-sm">
              <CardBody className="overflow-x-auto p-0">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                      <th className="px-5 py-3 font-medium">Type</th>
                      <th className="px-5 py-3 font-medium">Label</th>
                      <th className="px-5 py-3 font-medium">Value</th>
                      <th className="px-5 py-3 font-medium">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshots.map((s) => (
                      <tr key={s.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                        <td className="px-5 py-3 text-slate-700">{s.item_type}</td>
                        <td className="px-5 py-3 text-slate-700">{s.label}</td>
                        <td className="px-5 py-3 text-slate-700">{s.value_text}</td>
                        <td className="px-5 py-3">
                          <Link href={s.url} target="_blank" rel="noreferrer" className="text-sm">
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

          <h2 className="mt-8 text-xl font-semibold text-slate-900">Findings</h2>
          {findings.length === 0 && <p className="mt-2 text-slate-500">No findings yet.</p>}
          <ul className="mt-4 space-y-4">
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
        </>
      )}
    </main>
  );
}
