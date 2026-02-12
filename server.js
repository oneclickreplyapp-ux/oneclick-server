const express = require("express");
const cors = require("cors");
const Stripe = require("stripe");

const app = express();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

/* =====================================================
   STRIPE WEBHOOK (ДОЛЖЕН БЫТЬ ДО express.json())
===================================================== */
app.post("/webhook", express.raw({ type: "application/json" }), (req, res) => {
  const sig = req.headers["stripe-signature"];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    console.log("Payment successful for session:", session.id);
  }

  res.json({ received: true });
});

/* =====================================================
   NORMAL MIDDLEWARE
===================================================== */
app.use(cors());
app.use(express.json());

/* =====================================================
   ROOT
===================================================== */
app.get("/", (req, res) => {
  res.send("OK");
});

/* =====================================================
   OPENAI GENERATE
===================================================== */
app.post("/generate", async (req, res) => {
  try {
    const { emailText, type } = req.body || {};

    let instruction = "";

    switch (type) {
      case "followup":
        instruction = "Write a short and polite follow-up email.";
        break;
      case "confident":
        instruction = "Rewrite this email to sound confident and professional.";
        break;
      case "polite":
        instruction = "Rewrite this email to sound polite and friendly.";
        break;
      case "shorten":
        instruction = "Rewrite this email to be shorter and clearer.";
        break;
      default:
        instruction = "Write a professional reply to this inbound email.";
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        messages: [
          {
            role: "system",
            content: "You are a professional sales assistant. Keep replies concise."
          },
          {
            role: "user",
            content: `${instruction}\n\n${emailText || ""}`
          }
        ],
        temperature: 0.5,
        max_tokens: 200
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("OpenAI error:", errText);
      return res.status(500).json({ error: "OpenAI failed" });
    }

    const data = await response.json();
    const reply =
      data?.choices?.[0]?.message?.content || "No reply generated.";

    res.json({ reply });

  } catch (error) {
    console.error("Generate crash:", error);
    res.status(500).json({ error: "AI generation failed" });
  }
});

/* =====================================================
   STRIPE CHECKOUT SESSION
===================================================== */
app.post("/create-checkout-session", async (req, res) => {
  try {

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "OneClick Reply Pro"
            },
            unit_amount: 1200
          },
          quantity: 1
        }
      ],
      success_url: "https://oneclick-server-uur2.onrender.com/success",
      cancel_url: "https://oneclick-server-uur2.onrender.com/cancel"
    });

    res.json({ url: session.url });

  } catch (error) {
    console.error("Stripe error:", error);
    res.status(500).json({ error: "Stripe failed" });
  }
});

/* =====================================================
   SUCCESS / CANCEL
===================================================== */
app.get("/success", (req, res) => {
  res.send("Payment successful. You can close this tab.");
});

app.get("/cancel", (req, res) => {
  res.send("Payment canceled.");
});

/* =====================================================
   SERVER START
===================================================== */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

