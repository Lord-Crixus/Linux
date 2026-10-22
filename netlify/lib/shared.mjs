import { getStore } from "@netlify/blobs";

// Your plans. Prices are in KES. Change here if you ever change prices.
export const PLANS = {
  "3w":  { label: "3+ odds · Weekly",  kes: 1950,  days: 7 },
  "3m":  { label: "3+ odds · Monthly", kes: 3900,  days: 30 },
  "10w": { label: "10+ odds · Weekly", kes: 5200,  days: 7 },
  "10m": { label: "10+ odds · Monthly", kes: 11050, days: 30 },
};

export const DAY = 86400000;
export const members = () => getStore("members");
export const payments = () => getStore("payments");

export async function tg(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function paystack(path, { method = "GET", body } = {}) {
  const res = await fetch(`https://api.paystack.co${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

export const fmt = (ms) => new Date(ms).toISOString().slice(0, 10);
