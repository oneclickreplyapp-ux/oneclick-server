const { createClient } = require("@supabase/supabase-js");
const express = require("express");
const cors = require("cors");
const Stripe = require("stripe");

const app = express();

// ===== Environment variables =====
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const XAI_API_KEY = process.env.XAI_API_KEY;

if (!XAI_API_KEY) {
  console.error("CRITICAL ERROR: XAI_API_KEY is missing or empty in environment variables!");
  process.exit(1);
}

console.log(`[START] XAI_API_KEY detected (length: ${XAI_API_KEY.length} chars)`);

/* =====================================================
   STRIPE WEBHOOK
===================================================== */
app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
      console.log(`Webhook verified | Type: ${event.type}`);
    } catch (err) {
      console.error("Webhook signature failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const userId = session.metadata?.userId;

      if (!userId) {
        console.warn("No userId in metadata");
        return res.json({ received: true });
      }

      console.log(`Payment success for user: ${userId}`);

      try {
        const { error } = await supabase
          .from("users")
          .upsert(
            { id: userId, is_pro: true, updated_at: new Date().toISOString() },
            { onConflict: "id" }
          );

        if (error) console.error("Supabase upsert failed:", error.message);
        else console.log(`Pro activated for ${userId}`);
      } catch (dbErr) {
        console.error("Database error in webhook:", dbErr);
      }
    }

    res.json({ received: true });
  }
);

/* =====================================================
   Middleware
===================================================== */
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => res.send("OneClick Server OK"));

/* =====================================================
   CHECK PRO STATUS
===================================================== */
app.post("/check-pro", async (req, res) => {
  const { userId } = req.body;

  if (!userId) return res.status(400).json({ error: "userId required" });

  try {
    const { data, error } = await supabase
      .from("users")
      .select("is_pro")
      .eq("id", userId)
      .single();

    if (error && error.code !== "PGRST116") {
      console.error("Supabase check-pro error:", error);
      return res.status(500).json({ isPro: false });
    }

    const isPro = data?.is_pro ?? false;
    res.json({ isPro });
  } catch (err) {
    console.error("check-pro crash:", err);
    res.json({ isPro: false });
  }
});

/* =====================================================
   GENERATE AI REPLY — ONLY GROK (xAI)
===================================================== */
app.post("/generate", async (req, res) => {
  const { emailText, type } = req.body || {};

  if (!emailText) return res.status(400).json({ error: "emailText required" });

  let instruction = "";
  switch (type) {
    case "followup":
      instruction = "Write a short, polite follow-up email based on the previous conversation.";
      break;
    case "confident":
      instruction = "Rewrite this email to sound more confident, assertive, and professional.";
      break;
    case "polite":
      instruction = "Rewrite this email to be extremely polite, friendly, and courteous.";
      break;
    case "shorten":
      instruction = "Shorten and clarify this email while keeping the main points and professional tone.";
      break;
    default:
      instruction = "Write a clear, professional, and concise reply to this incoming email.";
  }

  try {
    console.log(`[GENERATE] Request | type=${type} | text_length=${emailText.length}`);

    const response = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${XAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "grok-4-1-fast-non-reasoning",
        messages: [
          {
            role: "system",
            content: "You are a helpful professional email assistant. Keep replies concise, natural, and business-appropriate."
          },
          {
            role: "user",
            content: `${instruction}\n\nEmail content:\n${emailText}`
          }
        ],
        temperature: 0.6,
        max_tokens: 600
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[GROK FAIL] status=${response.status} | body=${errText}`);
      return res.status(500).json({ error: `Grok API error: ${response.status}` });
    }

    const data = await response.json();
    const reply = data?.choices?.[0]?.message?.content?.trim() || "";

    if (!reply) {
      console.warn("[GROK] Empty content returned");
      return res.status(503).json({ error: "Grok returned empty response" });
    }

    console.log(`[GROK SUCCESS] reply length: ${reply.length}`);
    res.json({ reply });
  } catch (error) {
    console.error("[GENERATE CRASH]", error.message);
    res.status(500).json({ error: "Sorry, server error occurred. Please try again later." });
  }
});

/* =====================================================
   STRIPE CHECKOUT + SUCCESS/CANCEL
===================================================== */
app.post("/create-checkout-session", async (req, res) => {
  const { userId } = req.body;

  if (!userId) return res.status(400).json({ error: "userId required" });

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: "OneClick Reply Pro - Lifetime" },
            unit_amount: 1200,
          },
          quantity: 1,
        },
      ],
      metadata: { userId },
      success_url: `${process.env.SERVER_URL || "https://oneclick-server-uur2.onrender.com"}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.SERVER_URL || "https://oneclick-server-uur2.onrender.com"}/cancel`,
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error("Stripe create session error:", error);
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

app.get("/success", (req, res) => {
  res.send("<h2>Payment successful!</h2><p>You are now Pro. Close this tab.</p>");
});

app.get("/cancel", (req, res) => {
  res.send("<h2>Payment canceled.</h2><p>Try again later.</p>");
});

/* =====================================================
   START SERVER
===================================================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 OneClick server running on port ${PORT}`);
});
