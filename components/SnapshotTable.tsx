import { Card, CardBody, Link } from '@heroui/react';
import { splitSeed, SeedDivider } from './seedSplit';

type Snapshot = {
  id: string;
  company_id: string;
  item_type: string;
  label: string;
  value_text: string;
  url: string;
  captured_at: string;
};

function Table({ rows }: { rows: Snapshot[] }) {
  return (
    <Card className="glass-card bg-transparent">
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
            {rows.map((s) => (
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
  );
}

export function SnapshotTable({ snapshots }: { snapshots: Snapshot[] }) {
  const { real, seed } = splitSeed(snapshots, (s) => s.id);
  return (
    <>
      {real.length > 0 && <Table rows={real} />}
      {real.length > 0 && seed.length > 0 && <SeedDivider />}
      {seed.length > 0 && <Table rows={seed} />}
    </>
  );
}
