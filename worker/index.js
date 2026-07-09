// High Prophet Productions — store backend (Cloudflare Worker)
// -----------------------------------------------------------------------------
// The static site (index.html, audio/, etc.) is served automatically via the
// [assets] binding. This Worker only runs for /api/* routes.
//
//   POST /api/checkout  -> creates a Stripe Checkout Session, returns { url }
//   POST /api/webhook   -> (fulfillment: R2 delivery + license + email) — next slice
//
// Secrets (set in the Cloudflare dashboard, never in this repo):
//   STRIPE_SECRET_KEY      sk_test_... while building, sk_live_... at launch
//   STRIPE_WEBHOOK_SECRET  whsec_...   (added when the webhook endpoint is created)
//   RESEND_API_KEY         re_...      (added for the email slice)

// Per-tier pricing floors/ceilings in CENTS. Mirrors the site's PWYW sliders so a
// tampered request can't drop the price below the tier's minimum.
const TIERS = {
  leaseLimited:   { label: "Name Your Offer",         min: 500,   max: 3000 },   // $5–$30
  leaseBasic:     { label: "Basic · MP3 Lease",       min: 3500,  max: 5000 },   // $35–$50
  leasePremium:   { label: "Premium · WAV + Stems",   min: 7500,  max: 15000 },  // $75–$150
  leaseUnlimited: { label: "Unlimited · Master Lease", min: 20000, max: 40000 }, // $200–$400
  // "exclusive" and non-beat items are handled by the artist via the contact form.
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/checkout" && request.method === "POST") {
      return handleCheckout(request, env);
    }
    if (url.pathname === "/api/session" && request.method === "GET") {
      return handleSession(url, env);
    }
    if (url.pathname === "/api/webhook" && request.method === "POST") {
      // Fulfillment is implemented in the next slice. Acknowledge for now so
      // Stripe doesn't retry while we build it out.
      console.log("webhook — received; fulfillment not yet implemented.");
      return new Response("ok", { status: 200 });
    }
    // Anything else: hand back to the static site.
    return env.ASSETS.fetch(request);
  },
};

async function handleCheckout(request, env) {
  try {
    if (!env.STRIPE_SECRET_KEY) {
      console.log("checkout — STRIPE_SECRET_KEY is not configured on the Worker.");
      return json({ error: "Checkout is not configured yet." }, 500);
    }

    const body = await request.json().catch(() => ({}));
    const tier = String(body.tier || "");
    const track = String(body.track || "");
    const cfg = TIERS[tier];

    if (!cfg) {
      // exclusive / mixes / merch — route the buyer to contact instead of charging.
      console.log(`checkout — tier not auto-sellable, routing to contact. tier=${tier} track=${track}`);
      return json({ error: "handled_by_contact" }, 400);
    }

    // Amount comes from the tier's slider (whole dollars). Clamp to the tier's
    // floor/ceiling so a hand-crafted request can't underpay.
    const requestedCents = Math.round((Number(body.amount) || 0) * 100);
    const amount = Math.min(cfg.max, Math.max(cfg.min, requestedCents || cfg.min));

    const origin = url_origin(request);
    const form = new URLSearchParams();
    form.set("mode", "payment");
    form.set("success_url", `${origin}/?purchase=success&session_id={CHECKOUT_SESSION_ID}`);
    form.set("cancel_url", `${origin}/?purchase=cancelled`);
    form.set("line_items[0][quantity]", "1");
    form.set("line_items[0][price_data][currency]", "usd");
    form.set("line_items[0][price_data][unit_amount]", String(amount));
    form.set(
      "line_items[0][price_data][product_data][name]",
      `${cfg.label}${track ? " — " + track : ""}`
    );
    // Carry the sale details through to the webhook for fulfillment.
    form.set("metadata[tier]", tier);
    form.set("metadata[track]", track);
    form.set("payment_intent_data[metadata][tier]", tier);
    form.set("payment_intent_data[metadata][track]", track);

    const resp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
    const data = await resp.json();

    if (!resp.ok) {
      console.log(
        `checkout — Stripe session creation failed. status=${resp.status} ` +
          `tier=${tier} track=${track} amount=${amount} err=${JSON.stringify(data.error || data)}`
      );
      return json({ error: "Could not start checkout. Please try again." }, 502);
    }

    return json({ url: data.url });
  } catch (e) {
    console.log(`checkout — unexpected error. message=${e && e.message}`);
    return json({ error: "Unexpected error starting checkout." }, 500);
  }
}

// Looks up a completed Checkout Session so the thank-you page can confirm the
// purchase. Returns only safe, display-only fields.
async function handleSession(url, env) {
  try {
    const id = url.searchParams.get("id") || "";
    if (!/^cs_[A-Za-z0-9_]+$/.test(id)) {
      return json({ error: "invalid session id" }, 400);
    }
    if (!env.STRIPE_SECRET_KEY) {
      console.log("session — STRIPE_SECRET_KEY is not configured on the Worker.");
      return json({ error: "not configured" }, 500);
    }
    const resp = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(id)}`,
      { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } }
    );
    const s = await resp.json();
    if (!resp.ok) {
      console.log(`session — lookup failed. status=${resp.status} id=${id} err=${JSON.stringify(s.error || s)}`);
      return json({ error: "lookup failed" }, 502);
    }
    return json({
      status: s.payment_status, // "paid" when complete
      tier: (s.metadata && s.metadata.tier) || "",
      track: (s.metadata && s.metadata.track) || "",
      amount: s.amount_total, // cents
      email: (s.customer_details && s.customer_details.email) || "",
    });
  } catch (e) {
    console.log(`session — unexpected error. message=${e && e.message}`);
    return json({ error: "error" }, 500);
  }
}

function url_origin(request) {
  return new URL(request.url).origin;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
