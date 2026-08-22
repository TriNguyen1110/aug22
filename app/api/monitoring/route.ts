import { NextResponse } from 'next/server';
import { getDb } from '../../../src/api/db';
import { getMonitoring } from '../../../src/api/routes';

export async function GET() {
  const result = await getMonitoring(getDb());
  return NextResponse.json(result);
}
