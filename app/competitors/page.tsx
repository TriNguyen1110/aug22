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

async function getCompetitors() {
  const base = process.env.INTERNAL_BASE_URL ?? 'http://localhost:3000';
  const res = await fetch(`${base}/api/competitors`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`GET /api/competitors failed: ${res.status}`);
  return res.json();
}

export default async function CompetitorsPage() {
  let companies: Company[] = [];
  let snapshots: Snapshot[] = [];
  let error: string | null = null;

  try {
    const data = await getCompetitors();
    companies = data.companies ?? [];
    snapshots = data.snapshots ?? [];
  } catch (err) {
    error = (err as Error).message;
  }

  return (
    <main>
      <h1 className="text-3xl font-bold tracking-tight text-slate-900">Competitors</h1>
      <p className="mt-2 text-slate-600">
        Pricing, changelog entries, and public activity for Linear and Asana.
      </p>
      {error && <p className="mt-6 text-red-600">Could not load competitors: {error}</p>}
      {!error && companies.length === 0 && <p className="mt-6 text-slate-500">No competitors yet.</p>}
      <div className="mt-8 space-y-10">
        {companies.map((c) => {
          const snaps = snapshots.filter((s) => s.company_id === c.id);
          return (
            <section key={c.id}>
              <h2 className="text-xl font-semibold text-slate-900">
                <Link href={`/competitors/${c.id}`} className="text-xl font-semibold">
                  {c.name}
                </Link>{' '}
                <span className="text-base font-normal text-slate-500">({c.domain})</span>
              </h2>
              {snaps.length === 0 && <p className="mt-2 text-slate-500">No snapshots yet.</p>}
              {snaps.length > 0 && (
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
                        {snaps.map((s) => (
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
            </section>
          );
        })}
      </div>
    </main>
  );
}
