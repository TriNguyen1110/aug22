import { NextResponse } from 'next/server';
import { getDb } from '../../../src/api/db';
import { getCompetitors } from '../../../src/api/routes';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const industry = searchParams.get('industry');
  const sort = searchParams.get('sort');
  const q = searchParams.get('q');
  const result = await getCompetitors(getDb(), { industry, sort, q });
  return NextResponse.json(result);
}
