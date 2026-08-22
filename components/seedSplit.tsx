// Real live-ingested rows use real platform ids (reddit t3_..., linkedin snapshot ids).
// Seeded/demo rows all use the stable `seed-` id prefix (see CLAUDE.md / BOARD.tsv convention).
// This only affects display grouping, never filtering: seed data is still real grounded
// content, just not from a live scrape.
export function splitSeed<T>(items: T[], getKey: (item: T) => string): { real: T[]; seed: T[] } {
  const real: T[] = [];
  const seed: T[] = [];
  for (const item of items) {
    if (getKey(item).startsWith('seed-')) {
      seed.push(item);
    } else {
      real.push(item);
    }
  }
  return { real, seed };
}

export function SeedDivider() {
  return (
    <div className="my-6 flex items-center gap-3" role="separator">
      <div className="h-px flex-1 bg-silver/10" />
      <span className="shrink-0 text-xs font-medium uppercase tracking-[0.15em] text-silver-dim">
        Seeded / demo data
      </span>
      <div className="h-px flex-1 bg-silver/10" />
    </div>
  );
}
