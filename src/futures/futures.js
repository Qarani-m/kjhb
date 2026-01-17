import express from "express";
import { prisma } from "../lib/prisma.js";
import { authMiddleware } from "../auth/auth.js";

const router = express.Router();

// GET /futures/positions: Fetch active positions
router.get("/positions", authMiddleware, async (req, res) => {
  try {
    const positions = await prisma.position.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: "desc" },
    });
    res.json(positions);
  } catch (error) {
    console.error("Fetch positions error:", error);
    res.status(500).json({ error: "Failed to fetch positions" });
  }
});

// POST /futures/orders: Open a new position
router.post("/orders", authMiddleware, async (req, res) => {
  // Destructure with defaults to handle missing fields from frontend
  const {
    side = "BUY",
    price,
    amount,
    leverage = 20,
    symbol = "BTCUSDT",
    marginMode = "Cross",
    type = "limit",
  } = req.body;

  // Basic validation for critical fields
  if (!price || !amount || !side) {
    return res
      .status(400)
      .json({ error: "Missing required fields: price, amount, or side" });
  }

  const parsedPrice = parseFloat(price);
  const parsedAmount = parseFloat(amount);
  const parsedLeverage = parseInt(leverage);

  const cost = (parsedPrice * parsedAmount) / parsedLeverage;

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. Check USDT balance
      const balance = await tx.balance.findUnique({
        where: { userId_coin: { userId: req.userId, coin: "USDT" } },
      });

      if (!balance || balance.available < cost) {
        throw new Error("Insufficient USDT balance");
      }

      // 2. Deduct cost from balance
      await tx.balance.update({
        where: { id: balance.id },
        data: { available: { decrement: cost } },
      });

      // 3. Create Position
      return tx.position.create({
        data: {
          userId: req.userId,
          symbol,
          side,
          type,
          marginMode,
          entryPrice: parsedPrice,
          size: parsedAmount,
          marginUsed: cost,
          leverage: parsedLeverage,
        },
      });
    });

    res.json({ message: "Order placed successfully", position: result });
  } catch (error) {
    console.error("Order placement error:", error.message);
    res.status(error.message === "Insufficient USDT balance" ? 400 : 500).json({
      error: error.message || "Failed to place order",
    });
  }
});

// POST /futures/close-position: Market close position
router.post("/close-position", authMiddleware, async (req, res) => {
  const { positionId, currentMarketPrice } = req.body;

  if (!positionId || !currentMarketPrice) {
    return res
      .status(400)
      .json({ error: "Missing positionId or currentMarketPrice" });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. Fetch position
      const position = await tx.position.findUnique({
        where: { id: parseInt(positionId) },
      });

      if (!position || position.userId !== req.userId) {
        throw new Error("Position not found or unauthorized");
      }

      // 2. Calculate PnL
      // Long PnL = (Current Price - Entry Price) * Size
      // Short PnL = (Entry Price - Current Price) * Size
      let pnl = 0;
      if (position.side === "BUY") {
        pnl = (currentMarketPrice - position.entryPrice) * position.size;
      } else {
        pnl = (position.entryPrice - currentMarketPrice) * position.size;
      }

      // 3. Refund margin + PnL to user balance
      const refundAmount = position.marginUsed + pnl;

      await tx.balance.upsert({
        where: { userId_coin: { userId: req.userId, coin: "USDT" } },
        update: { available: { increment: refundAmount } },
        create: { userId: req.userId, coin: "USDT", available: refundAmount },
      });

      // 4. Delete position
      await tx.position.delete({
        where: { id: position.id },
      });

      return { pnl, refundAmount };
    });

    res.json({ message: "Position closed", ...result });
  } catch (error) {
    console.error("Close position error:", error.message);
    res
      .status(
        error.message === "Position not found or unauthorized" ? 404 : 500
      )
      .json({
        error: error.message || "Failed to close position",
      });
  }
});

export default router;
