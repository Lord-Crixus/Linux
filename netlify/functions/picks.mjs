import { siteStore } from "../lib/shared.mjs";

// The website reads the settled-picks list from here.
export const config = { path: "/api/picks" };

export default async () => {
  const picks = (await siteStore().get("picks", { type: "json" })) || [];
  return new Response(JSON.stringify({ picks }), {
    headers: { "content-type": "application/json", "cache-control": "public, max-age=60" },
  });
};
