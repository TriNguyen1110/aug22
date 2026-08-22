import { NextResponse } from 'next/server';
import { getDb } from '../../../src/api/db';
import { getTrends, getTrendsSearch } from '../../../src/api/routes';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q');
  if (q !== null) {
    const result = await getTrendsSearch(getDb(), q);
    return NextResponse.json(result);
  }
  const result = await getTrends(getDb());
  return NextResponse.json(result);
}
