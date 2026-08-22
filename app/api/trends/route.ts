import { NextResponse } from 'next/server';
import { getDb } from '../../../src/api/db';
import { getTrends } from '../../../src/api/routes';

export async function GET() {
  const result = await getTrends(getDb());
  return NextResponse.json(result);
}
