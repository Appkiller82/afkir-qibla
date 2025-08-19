import { Handler } from '@netlify/functions';
import { getStore } from '@netlify/blobs';

const store = getStore({ name: 'push-subs', consistency: 'strong' });

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'POST') {
    const { subscription } = JSON.parse(event.body || '{}');
    if (!subscription?.endpoint) {
      return { statusCode: 400, body: 'Missing subscription' };
    }
    const key = Buffer.from(subscription.endpoint).toString('base64url');
    await store.set(key, JSON.stringify(subscription));
    return { statusCode: 200, body: JSON.stringify({ id: key }) };
  }

  if (event.httpMethod === 'DELETE') {
    const { endpoint } = JSON.parse(event.body || '{}');
    if (!endpoint) {
      return { statusCode: 400, body: 'Missing endpoint' };
    }
    const key = Buffer.from(endpoint).toString('base64url');
    await store.delete(key);
    return { statusCode: 200, body: 'Deleted' };
  }

  return { statusCode: 405, body: 'Method Not Allowed' };
};
