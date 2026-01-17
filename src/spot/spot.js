import express from "express";
import { prisma } from "../lib/prisma.js";
import { authMiddleware } from "../auth/auth.js";

const router = express.Router();

// hardcoded rate for BTC/USDT for MVP
const BTC_USDT_RATE = 102145.5;

/**
 * POST /spot/swap
 * Instant exchange between cryptocurrencies
 */
router.post("/swap", authMiddleware, async (req, res) => {
  const { from, to, amount } = req.body;

  if (!from || !to || !amount || amount <= 0) {
    return res.status(400).json({ error: "Invalid swap parameters" });
  }

  // Currently only supporting BTC to USDT for MVP
  if (from.toUpperCase() !== "BTC" || to.toUpperCase() !== "USDT") {
    return res.status(400).json({ error: "Swap pair currently not supported" });
  }

  try {
    const rate = BTC_USDT_RATE;
    const creditAmount = parseFloat(amount) * rate;

    // Execute atomic transaction
    const result = await prisma.$transaction(async (tx) => {
      // 1. Check sender's "from" balance
      const fromBalance = await tx.balance.findUnique({
        where: {
          userId_coin: { userId: req.userId, coin: from.toUpperCase() },
        },
      });

      if (!fromBalance || fromBalance.available < amount) {
        throw new Error(`Insufficient ${from} balance`);
      }

      // 2. Deduct from "from" coin
      const updatedFromBalance = await tx.balance.update({
        where: { id: fromBalance.id },
        data: { available: { decrement: parseFloat(amount) } },
      });

      // 3. Credit to "to" coin
      const updatedToBalance = await tx.balance.upsert({
        where: { userId_coin: { userId: req.userId, coin: to.toUpperCase() } },
        update: { available: { increment: creditAmount } },
        create: {
          userId: req.userId,
          coin: to.toUpperCase(),
          available: creditAmount,
        },
      });

      // 4. Log the swap
      const swapLog = await tx.swap.create({
        data: {
          userId: req.userId,
          fromCoin: from.toUpperCase(),
          toCoin: to.toUpperCase(),
          fromAmount: parseFloat(amount),
          toAmount: creditAmount,
          rate: rate,
        },
      });

      return { updatedFromBalance, updatedToBalance, swapLog };
    });

    res.json({
      message: "Swap successful",
      fromBalance: result.updatedFromBalance,
      toBalance: result.updatedToBalance,
      swap: result.swapLog,
    });
  } catch (error) {
    console.error("Swap error:", error.message);
    res.status(error.message.startsWith("Insufficient") ? 400 : 500).json({
      error: error.message || "Failed to process swap",
    });
  }
});

export default router;
