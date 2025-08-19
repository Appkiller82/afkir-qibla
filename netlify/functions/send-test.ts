import { Handler } from "@netlify/functions";
import webpush from "web-push";
import { createStore } from "@netlify/blobs";

const store = createStore("push-subs");

const vapidKeys = {
  publicKey: process.env.VITE_VAPID_PUBLIC_KEY!,
  privateKey: process.env.VAPID_PRIVATE_KEY!,
};
webpush.setVapidDetails(
  process.env.VAPID_SUBJECT!,
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    let sub = body.sub;

    if (!sub && body.id) {
      // fallback: hent subscription fra Blobs via endpoint
      const saved = await store.get(body.id);
      if (saved) sub = JSON.parse(saved);
    }

    if (!sub) {
      return { statusCode: 400, body: "Missing subscription" };
    }

    await webpush.sendNotification(
      sub,
      JSON.stringify({
        title: "Test notification",
        body: "Push works 🚀",
      })
    );

    return { statusCode: 200, body: "Push sent" };
  } catch (err: any) {
    return { statusCode: 500, body: `send-test error: ${err}` };
  }
};
