import dotenv from "dotenv";
dotenv.config();

import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import path from "path";

import { query, queryOne, execute, transaction } from "./lib/db.js";
import { initializeSchema } from "./lib/init-db.js";

// Initialize database schema
await initializeSchema();
import authRouter, { authMiddleware } from "./auth/auth.js";
import { deriveDepositAddress } from "./wallets/walletService.js";
import "./blockchain/worker.js"; // Start the confirmation worker
import futuresRouter from "./futures/futures.js";
import stripeRouter from "./payments/stripe.js";
import spotRouter from "./spot/spot.js";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" },
});

app.get("/admin", (req, res) => {
  res.sendFile(path.resolve("public/admin.html"));
});

app.get("/admin/chat", (req, res) => {
  res.sendFile(path.resolve("public/admin-chat.html"));
});

const PORT = process.env.PORT || 3010;

app.use(cors());
app.use("/stripe", stripeRouter);
app.use(express.json());
app.use("/uploads", express.static("uploads"));
app.use(express.static("public"));

// Socket.io connection
// Socket.io connection
import { setupChatSocket } from "./chat/socket.js";
import { setupUserWebSocket } from "./chat/userWebSocket.js"; // Raw WS for Users

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.on("join", (userId) => {
    socket.join(`user_${userId}`);
    console.log(`User ${userId} joined their room`);
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

// Initialize Hybrid Chat Logic
setupChatSocket(io);
setupUserWebSocket(httpServer, io);

// Attach io to app for use in routes
app.set("io", io);

// Routes
app.use("/auth", authRouter);
app.use("/futures", futuresRouter);
app.use("/spot", spotRouter);

// Get User Profile & Balances
app.get("/profile", authMiddleware, async (req, res) => {
  const user = await queryOne('SELECT * FROM "User" WHERE "id" = $1', [req.userId]);
  const balances = await query('SELECT * FROM "Balance" WHERE "userId" = $1', [req.userId]);
  const deposits = await query(
    'SELECT * FROM "Deposit" WHERE "userId" = $1 ORDER BY "createdAt" DESC LIMIT 10',
    [req.userId]
  );
  const kycRecord = await queryOne('SELECT * FROM "KycRecord" WHERE "userId" = $1', [req.userId]);

  res.json({
    email: user.email,
    id: user.id,
    kycStatus: user.kycStatus,
    balances,
    deposits,
    kycRecord,
  });
});

// Get or Create Deposit Address (Multi-network)
app.get("/deposit-address", authMiddleware, async (req, res) => {
  const { coin = "ETH", network = "ETH" } = req.query;
  try {
    let wallet = await queryOne(
      'SELECT * FROM "Wallet" WHERE "userId" = $1 AND "coin" = $2 AND "network" = $3',
      [req.userId, coin, network]
    );

    if (!wallet) {
      const address = deriveDepositAddress(process.env.MNEMONIC, req.userId);

      const result = await execute(
        'INSERT INTO "Wallet" ("userId", "coin", "network", "address", "derivationIndex") VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [req.userId, coin, network, address, req.userId]
      );
      wallet = result.rows?.[0] || { address };
    }

    res.json({ address: wallet.address });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to generate address" });
  }
});

// Withdraw Crypto
import { sendCrypto } from "./wallets/walletService.js";

app.post("/withdraw", authMiddleware, async (req, res) => {
  const { coin, network, amount, address } = req.body;

  if (!coin || !network || !amount || !address) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    // 1. Check Balance
    const balance = await queryOne(
      'SELECT * FROM "Balance" WHERE "userId" = $1 AND "coin" = $2',
      [req.userId, coin]
    );

    if (!balance || balance.available < amount) {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    // 2. Local Ledger Update (Deduct immediately)
    await execute(
      'UPDATE "Balance" SET "available" = "available" - $1 WHERE "id" = $2',
      [amount, balance.id]
    );

    // 3. Create Withdrawal Record
    const withdrawalResult = await execute(
      'INSERT INTO "Withdrawal" ("userId", "coin", "network", "amount", "toAddress", "status", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW()) RETURNING *',
      [req.userId, coin, network, amount, address, "PENDING"]
    );
    const withdrawal = withdrawalResult.rows?.[0] || { id: withdrawalResult.insertId };

    // 4. Attempt On-Chain Transaction (Async)
    sendCrypto(process.env.MNEMONIC, req.userId, address, amount)
      .then(async (txHash) => {
        await execute(
          'UPDATE "Withdrawal" SET "txHash" = $1, "status" = $2, "updatedAt" = NOW() WHERE "id" = $3',
          [txHash, "COMPLETED", withdrawal.id]
        );
        console.log(`Withdrawal ${withdrawal.id} successful: ${txHash}`);
      })
      .catch(async (err) => {
        console.error(`Withdrawal ${withdrawal.id} failed:`, err);
        // Refund the user on failure
        await execute(
          'UPDATE "Balance" SET "available" = "available" + $1 WHERE "id" = $2',
          [amount, balance.id]
        );
        await execute(
          'UPDATE "Withdrawal" SET "status" = $1, "updatedAt" = NOW() WHERE "id" = $2',
          ["FAILED", withdrawal.id]
        );
      });

    res.json({ message: "Withdrawal initiated", withdrawalId: withdrawal.id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to process withdrawal" });
  }
});

// Internal Transfer (User to User)
app.post("/transfer", authMiddleware, async (req, res) => {
  const { recipientEmail, coin, amount } = req.body;

  if (!recipientEmail || !coin || !amount || amount <= 0) {
    return res.status(400).json({ error: "Invalid transfer parameters" });
  }

  try {
    // 1. Find Sender (req.userId) and Recipient (by email)
    const [sender, recipient] = await Promise.all([
      prisma.user.findUnique({ where: { id: req.userId } }),
      prisma.user.findUnique({ where: { email: recipientEmail } }),
    ]);

    if (!recipient) {
      return res.status(404).json({ error: "Recipient not found" });
    }

    if (sender.id === recipient.id) {
      return res.status(400).json({ error: "Cannot transfer to yourself" });
    }

    // 2. Calculate Fee (1%)
    const fee = amount * 0.01;
    const netAmount = amount - fee;

    // 3. Execution (Atomic Transaction)
    const result = await prisma.$transaction(async (tx) => {
      // Check sender balance
      const senderBalance = await tx.balance.findUnique({
        where: { userId_coin: { userId: sender.id, coin } },
      });

      if (!senderBalance || senderBalance.available < amount) {
        throw new Error("Insufficient balance");
      }

      // Deduct from sender
      await tx.balance.update({
        where: { id: senderBalance.id },
        data: { available: { decrement: amount } },
      });

      // Add to recipient (upsert if they don't have a balance record yet)
      await tx.balance.upsert({
        where: { userId_coin: { userId: recipient.id, coin } },
        update: { available: { increment: netAmount } },
        create: { userId: recipient.id, coin, available: netAmount },
      });

      // Log the transfer
      return tx.transfer.create({
        data: {
          senderId: sender.id,
          receiverId: recipient.id,
          coin,
          amount,
          fee,
          netAmount,
        },
      });
    });

    // 4. Notify via Socket.io
    const io = app.get("io");
    io.to(`user_${sender.id}`).emit("transfer_sent", result);
    io.to(`user_${recipient.id}`).emit("transfer_received", result);

    res.json({ message: "Transfer successful", transferId: result.id });
  } catch (error) {
    console.error("Transfer error:", error.message);
    res.status(error.message === "Insufficient balance" ? 400 : 500).json({
      error: error.message || "Failed to process transfer",
    });
  }
});

// Real Webhook Handler (Alchemy Address Activity)
app.post("/webhook/alchemy", async (req, res) => {
  const { event } = req.body;
  const activity = event?.activity?.[0];

  if (!activity) return res.send("No activity");

  const toAddress = activity.toAddress;
  const value = activity.value;
  const txHash = activity.hash;
  const network = activity.network; // e.g. 'ETH_SEPOLIA'

  // Find user associated with this address
  const wallet = await prisma.wallet.findFirst({
    where: { address: { equals: toAddress, mode: "insensitive" } },
  });

  if (wallet) {
    const deposit = await prisma.deposit.upsert({
      where: { txHash },
      update: { status: "PENDING" },
      create: {
        userId: wallet.userId,
        txHash,
        amount: value,
        network: wallet.network,
        coin: wallet.coin,
        status: "DETECTED",
      },
    });

    // Notify frontend via Socket.io
    const io = app.get("io");
    io.to(`user_${wallet.userId}`).emit("deposit_update", deposit);
  }

  res.json({ success: true });
});

httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
