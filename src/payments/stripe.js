import express from "express";
import Stripe from "stripe";
import { prisma } from "../lib/prisma.js";
import { authMiddleware } from "../auth/auth.js";

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// 1. Webhook Route FIRST (Must handle raw body)
router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error(`Webhook Error: ${err.message}`);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const { userId, coin, amount } = session.metadata;

      console.log(`Payment Succeeded for User ${userId}: ${amount} ${coin}`);

      try {
        await prisma.balance.upsert({
          where: {
            userId_coin: {
              userId: parseInt(userId),
              coin: coin.toUpperCase(),
            },
          },
          update: {
            available: { increment: parseFloat(amount) },
          },
          create: {
            userId: parseInt(userId),
            coin: coin.toUpperCase(),
            available: parseFloat(amount),
            locked: 0,
          },
        });
        console.log(`Credited ${amount} ${coin} to User ${userId}`);
      } catch (error) {
        console.error("Fulfillment Error:", error);
      }
    }

    res.json({ received: true });
  }
);

// 2. Regular JSON processing for other routes
router.use(express.json());

// POST /stripe/buy: Create Checkout Session
router.post("/buy", authMiddleware, async (req, res) => {
  const { amount, coin = "USDT" } = req.body;

  if (!amount || amount <= 0) {
    return res.status(400).json({ error: "Invalid amount" });
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });

    // Create or retrieve Stripe Customer
    let stripeCustomerId = user.stripeCustomerId;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { userId: user.id },
      });
      stripeCustomerId = customer.id;
      await prisma.user.update({
        where: { id: user.id },
        data: { stripeCustomerId },
      });
    }

    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `Buy ${coin}`,
              description: `Purchasing ${amount} ${coin} tokens`,
            },
            unit_amount: Math.round(amount * 100), // Stripe expects cents
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${
        process.env.FRONTEND_URL || "http://localhost:5173"
      }/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${
        process.env.FRONTEND_URL || "http://localhost:5173"
      }/cancel`,
      client_reference_id: user.id.toString(),
      metadata: {
        userId: user.id.toString(),
        coin,
        amount: amount.toString(),
      },
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error("Stripe Session Error:", error);

    // Return specific Stripe error messages (e.g., amount too small) to the user
    if (error.type === "StripeInvalidRequestError" || error.raw?.message) {
      return res
        .status(400)
        .json({ error: error.message || error.raw?.message });
    }

    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

// POST /stripe/sell: Initiate a payout (Sell Crypto)
router.post("/sell", authMiddleware, async (req, res) => {
  const { amount, coin = "USDT" } = req.body;

  if (!amount || amount <= 0) {
    return res.status(400).json({ error: "Invalid amount" });
  }

  try {
    // 1. Check user's balance
    const balance = await prisma.balance.findUnique({
      where: { userId_coin: { userId: req.userId, coin: coin.toUpperCase() } },
    });

    console.log("Amount is sufficient", balance);
    if (!balance || balance.available < amount) {
      return res
        .status(400)
        .json({ error: "Network Erroe: Insufficient balance" });
    }

    // 2. Atomic: Deduct balance and create withdrawal record
    const result = await prisma.$transaction(async (tx) => {
      await tx.balance.update({
        where: { id: balance.id },
        data: { available: { decrement: parseFloat(amount) } },
      });

      return tx.withdrawal.create({
        data: {
          userId: req.userId,
          coin: coin.toUpperCase(),
          network: "STRIPE_PAYOUT", // Special network tag
          amount: parseFloat(amount),
          toAddress: "Stripe Card/Bank",
          status: "PENDING",
        },
      });
    });

    // NOTE: In a production app with Stripe Connect, you would here:
    // 1. Check if user has a Connected Account
    // 2. Call stripe.payouts.create()
    // For this prototype, we mark it as PENDING for admin review.

    res.json({
      message: "Sell order initiated. Payout is being processed.",
      withdrawalId: result.id,
    });
  } catch (error) {
    console.error("Stripe Sell Error:", error);
    res.status(500).json({ error: "Failed to process sell order" });
  }
});

export default router;
