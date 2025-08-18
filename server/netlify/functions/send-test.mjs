import webpush from "web-push";
import { getStore } from "@netlify/blobs";

webpush.setVapidDetails(process.env.VAPID_SUBJECT, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors() });
  const { id } = await req.json();
  if (!id) return new Response('Bad request', { status: 400, headers: cors() });

  const store = getStore('subs');
  const json = await store.get(`subs/${id}.json`);
  if (!json) return new Response('Not found', { status: 404, headers: cors() });

  const rec = JSON.parse(json);
  await webpush.sendNotification(rec.subscription, JSON.stringify({
    title: "Testvarsel",
    body: "Dette er en test fra AfkirQibla.",
    url: "/"
  }));

  return new Response('ok', { headers: cors() });
};

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
}
