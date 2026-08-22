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
    <main className="space-y-12">
      <section>
        <p className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-teal">Landscape</p>
        <h1 className="font-display text-4xl font-semibold tracking-tight text-[#eef1f0] sm:text-5xl">
          Competitors
        </h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-silver">
          Pricing, changelog entries, and public activity for Linear and Asana.
        </p>
      </section>
      {error && <p className="text-red-400">Could not load competitors: {error}</p>}
      {!error && companies.length === 0 && <p className="text-silver-dim">No competitors yet.</p>}
      <div className="space-y-12">
        {companies.map((c) => {
          const snaps = snapshots.filter((s) => s.company_id === c.id);
          return (
            <section key={c.id}>
              <h2 className="font-display text-2xl font-semibold text-[#eef1f0]">
                <Link href={`/competitors/${c.id}`} className="font-display text-2xl font-semibold hover:text-teal">
                  {c.name}
                </Link>{' '}
                <span className="text-base font-sans font-normal text-silver-dim">({c.domain})</span>
              </h2>
              {snaps.length === 0 && <p className="mt-3 text-silver-dim">No snapshots yet.</p>}
              {snaps.length > 0 && (
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
                        {snaps.map((s) => (
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
          );
        })}
      </div>
    </main>
  );
}
