let subs: { id: string; sub: any }[] = [];

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const body = await req.json();
  if (!body || !body.endpoint) {
    return new Response(JSON.stringify({ message: "invalid subscription" }), { status: 400 });
  }

  const id = Date.now().toString();
  subs.push({ id, sub: body });

  return new Response(JSON.stringify({ id }), { headers: { "content-type": "application/json" } });
};

export { subs };
