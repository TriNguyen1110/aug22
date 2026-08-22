import { NextResponse } from 'next/server';
import { getDb } from '../../../../src/api/db';
import { getCompetitorById } from '../../../../src/api/routes';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const result = await getCompetitorById(getDb(), params.id);
  if (!result) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(result);
}
