import webpush from "web-push";
import { subs } from "./subscribe";

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const { id } = await req.json();
  const sub = subs.find((s) => s.id === id);
  if (!sub) {
    return new Response("subscription not found", { status: 404 });
  }

  try {
    await webpush.sendNotification(sub.sub, JSON.stringify({
      title: "Test",
      body: "Hello world 🚀"
    }));
    return new Response("ok");
  } catch (err: any) {
    return new Response(`push failed: ${err.message}`, { status: 500 });
  }
};
