import { Card, CardBody, Chip, Link } from '@heroui/react';
import { PageChat } from '../../components/PageChat';

type Company = {
  id: string;
  name: string;
  domain: string;
  role: string;
  industry?: string | null;
  market_share?: number | null;
  size?: string | null;
  niche?: string | null;
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

async function getCompetitors(q?: string) {
  const base = process.env.INTERNAL_BASE_URL ?? 'http://localhost:3000';
  const qs = q ? `?q=${encodeURIComponent(q)}` : '';
  const res = await fetch(`${base}/api/competitors${qs}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`GET /api/competitors${qs} failed: ${res.status}`);
  return res.json();
}

export default async function CompetitorsPage({
  searchParams,
}: {
  searchParams?: { q?: string };
}) {
  const q = searchParams?.q?.trim() || '';
  let companies: Company[] = [];
  let snapshots: Snapshot[] = [];
  let matchedCompanies: number | null = null;
  let error: string | null = null;

  try {
    const data = await getCompetitors(q || undefined);
    companies = data.companies ?? [];
    snapshots = data.snapshots ?? [];
    matchedCompanies = typeof data.matched_companies === 'number' ? data.matched_companies : null;
  } catch (err) {
    error = (err as Error).message;
  }

  const profileCompanyIds = new Set(
    snapshots.filter((s) => s.item_type === 'profile').map((s) => s.company_id),
  );

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

      <section>
        <form action="/competitors" method="get" className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="Search price, activity, name, or niche..."
            className="w-full max-w-md rounded-md border border-silver/20 bg-transparent px-4 py-2 text-sm text-[#eef1f0] placeholder:text-silver-dim focus:border-teal focus:outline-none"
          />
          <button
            type="submit"
            className="rounded-md bg-teal px-4 py-2 text-sm font-medium text-[#0a0d0c] hover:bg-teal-dim"
          >
            Search
          </button>
          {q && (
            <Link href="/competitors" className="text-sm text-silver hover:text-teal">
              Clear
            </Link>
          )}
        </form>
        {q && matchedCompanies !== null && (
          <p className="mt-3 text-sm text-silver-dim">
            {matchedCompanies === 0
              ? `No matches for "${q}".`
              : `${matchedCompanies} matching compan${matchedCompanies === 1 ? 'y' : 'ies'} for "${q}".`}
          </p>
        )}
      </section>

      {error && <p className="text-red-400">Could not load competitors: {error}</p>}
      {!error && companies.length === 0 && (
        <p className="text-silver-dim">{q ? `No matches for "${q}".` : 'No competitors yet.'}</p>
      )}
      <div className="space-y-12">
        {companies.map((c) => {
          const snaps = snapshots.filter((s) => s.company_id === c.id);
          const hasProfile = profileCompanyIds.has(c.id);
          const profileSnap = snaps.find((s) => s.item_type === 'profile');
          return (
            <section key={c.id}>
              <h2 className="font-display text-2xl font-semibold text-[#eef1f0]">
                <Link href={`/competitors/${c.id}`} className="font-display text-2xl font-semibold hover:text-teal">
                  {c.name}
                </Link>{' '}
                <span className="text-base font-sans font-normal text-silver-dim">({c.domain})</span>
              </h2>

              <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-silver">
                {typeof c.market_share === 'number' && (
                  <span className="inline-flex items-center gap-2">
                    Market share: {c.market_share}%
                    <Chip size="sm" variant="flat" className="chip-est">
                      Est.
                    </Chip>
                  </span>
                )}
                {c.size && (
                  <span className="inline-flex items-center gap-2">
                    Size: {c.size}
                    <Chip size="sm" variant="flat" className="chip-est">
                      Est.
                    </Chip>
                  </span>
                )}
                {c.niche && !hasProfile && (
                  <span className="inline-flex items-center gap-2">
                    Niche: {c.niche}
                    <Chip size="sm" variant="flat" className="chip-est">
                      Est.
                    </Chip>
                  </span>
                )}
                {hasProfile && profileSnap && (
                  <span className="inline-flex items-center gap-2 text-[#eef1f0]">
                    {profileSnap.value_text}
                    <Chip size="sm" variant="flat" className="bg-teal/15 text-teal">
                      LinkedIn
                    </Chip>
                  </span>
                )}
              </div>

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

      <PageChat scope="competitor" label="competitors" />
    </main>
  );
}
