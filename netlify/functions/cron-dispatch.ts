
// netlify/functions/cron-dispatch.ts
import type { Handler } from '@netlify/functions';

const CRON_SECRET = process.env.CRON_SECRET;
const BASE = process.env.URL || process.env.DEPLOY_URL || '';

export const handler: Handler = async () => {
  try {
    const res = await fetch(`${BASE}/.netlify/functions/cron-run?secret=${CRON_SECRET}`);
    const txt = await res.text();
    return { statusCode: 200, body: txt };
  } catch (e: any) {
    return { statusCode: 500, body: `cron-dispatch failed: ${e?.message}` };
  }
};
