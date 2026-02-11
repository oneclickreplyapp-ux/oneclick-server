const express = require("express");
const cors = require("cors");
const Stripe = require("stripe");

const app = express();
app.use(cors());
app.use(express.json());

// ✅ Вставь ключи
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;   // sk-...
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY); // sk_test_...

// Чтобы в браузере не было "Cannot GET /"
app.get("/", (req, res) => {
  res.send("OK");
});

// ---------- OpenAI ----------
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
          { role: "system", content: "You are a professional sales assistant. Keep replies concise." },
          { role: "user", content: `${instruction}\n\n${emailText || ""}` }
        ],
        temperature: 0.5,
        max_tokens: 200
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("OpenAI error:", errText);
      return res.status(500).json({ error: "OpenAI failed", details: errText });
    }

    const data = await response.json();
    const reply = data?.choices?.[0]?.message?.content || "No reply generated.";
    res.json({ reply });

  } catch (e) {
    console.error("Generate crash:", e);
    res.status(500).json({ error: "AI generation failed" });
  }
});

// ---------- Stripe ----------
app.post("/create-checkout-session", async (req, res) => {
  try {
    console.log("Stripe endpoint hit");

    // Для начала делаем ПРОСТОЙ one-time payment (без subscription)
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: "OneClick Reply Pro" },
            unit_amount: 1200
          },
          quantity: 1
        }
      ],
      success_url: "http://localhost:3000/success",
      cancel_url: "http://localhost:3000/cancel"
    });

    res.json({ url: session.url });

  } catch (e) {
    console.error("Stripe error:", e);
    res.status(500).json({ error: "Stripe failed", details: String(e?.message || e) });
  }
});

app.get("/success", (req, res) => res.send("Payment successful. You can close this tab."));
app.get("/cancel", (req, res) => res.send("Payment canceled."));

app.listen(3000, () => console.log("Server running on http://localhost:3000"));
