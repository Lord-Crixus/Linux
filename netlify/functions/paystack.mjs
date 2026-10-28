import crypto from "node:crypto";
import { PLANS, DAY, tg, paystack, members, payments, fmt } from "../lib/shared.mjs";

export const config = { path: "/api/paystack" };

export default async (req) => {
  const raw = await req.text();
  const sig = req.headers.get("x-paystack-signature") || "";
  const expected = crypto.createHmac("sha512", process.env.PAYSTACK_SECRET_KEY).update(raw).digest("hex");
  if (sig !== expected) return new Response("bad signature", { status: 401 });

  try {
    const event = JSON.parse(raw);
    if (event.event === "charge.success") await grant(event.data.reference);
  } catch (e) {
    console.error("paystack error", e);
  }
  return new Response("ok"); // always 200 so Paystack does not keep retrying
};

async function grant(reference) {
  // 1. Never process the same payment twice
  const done = await payments().get(reference);
  if (done) return;

  // 2. Re-check the payment directly with Paystack
  const v = await paystack(`/transaction/verify/${encodeURIComponent(reference)}`);
  const d = v.data;
  if (!v.status || !d || d.status !== "success") return;

  const meta = d.metadata || {};
  const plan = PLANS[meta.plan];
  const userId = meta.telegram_id;
  if (!plan || !userId) return;
  const expectedCur = meta.currency === "USD" ? "USD" : "KES";
  const expectedAmt = (expectedCur === "USD" ? plan.usd : plan.kes) * 100;
  if (d.currency !== expectedCur || d.amount !== expectedAmt) {
    console.error("amount mismatch", reference, d.amount, d.currency);
    return;
  }

  // 3. Work out the new expiry (renewals add to the time left)
  const store = members();
  const key = String(userId);
  const old = await store.get(key, { type: "json" });
  const now = Date.now();
  const base = old && old.active && old.expiry > now ? old.expiry : now;
  const expiry = base + plan.days * DAY;

  await store.setJSON(key, {
    userId,
    username: meta.telegram_username || "",
    plan: meta.plan,
    expiry,
    active: true,
    reminded: false,
  });
  await payments().set(reference, String(now));

  // 4. Single-use invite link, valid 24 hours
  const link = await tg("createChatInviteLink", {
    chat_id: process.env.CHANNEL_ID,
    member_limit: 1,
    expire_date: Math.floor(now / 1000) + 86400,
    name: `tg${userId}`,
  });

  const url = link.ok ? link.result.invite_link : null;
  await tg("sendMessage", {
    chat_id: userId,
    text: url
      ? `Payment received. Thank you!\n\nPlan: ${plan.label}\nAccess until: ${fmt(expiry)}\n\nJoin the VIP channel here (link works once, for 24 hours):\n${url}\n\nIf you are already in the channel, you do not need the link. Your time has been extended.`
      : `Payment received. Plan: ${plan.label}, access until ${fmt(expiry)}. We could not create your link automatically, please message @gizmoinsightsadmin.`,
  });

  if (process.env.ADMIN_CHAT_ID) {
    await tg("sendMessage", {
      chat_id: process.env.ADMIN_CHAT_ID,
      text: `New payment: ${plan.label}, ${expectedCur} ${expectedAmt / 100}. User ${meta.telegram_username ? "@" + meta.telegram_username : userId}. Expires ${fmt(expiry)}.`,
    });
  }
}
