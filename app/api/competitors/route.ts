import { NextResponse } from 'next/server';
import { getDb } from '../../../src/api/db';
import { getCompetitors } from '../../../src/api/routes';

export async function GET() {
  const result = await getCompetitors(getDb());
  return NextResponse.json(result);
}
