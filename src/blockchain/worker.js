import { prisma } from "../lib/prisma.js";
import { JsonRpcProvider } from "ethers";

const provider = new JsonRpcProvider(process.env.ALCHEMY_URL);

/**
 * Periodically checks for pending deposits and updates their confirmation count.
 * This is the "Heartbeat" of the exchange ledger.
 */
async function checkConfirmations() {
  console.log("Worker: Checking confirmations...");

  const pendingDeposits = await prisma.deposit.findMany({
    where: { status: { in: ["DETECTED", "PENDING"] } },
  });

  for (const deposit of pendingDeposits) {
    try {
      const tx = await provider.getTransactionReceipt(deposit.txHash);
      if (!tx) continue;

      const currentBlock = await provider.getBlockNumber();
      const confirmations = currentBlock - tx.blockNumber + 1;

      console.log(`TX ${deposit.txHash}: ${confirmations} confirmations`);

      let newStatus = deposit.status;
      if (confirmations >= 12 && deposit.status !== "CONFIRMED") {
        newStatus = "CONFIRMED";

        // Credit the balance
        await prisma.balance.upsert({
          where: {
            userId_coin: { userId: deposit.userId, coin: deposit.coin },
          },
          update: { available: { increment: deposit.amount } },
          create: {
            userId: deposit.userId,
            coin: deposit.coin,
            available: deposit.amount,
          },
        });

        console.log(
          `Credited ${deposit.amount} ${deposit.coin} to user ${deposit.userId}`
        );
      } else if (confirmations > 0 && deposit.status === "DETECTED") {
        newStatus = "PENDING";
      }

      await prisma.deposit.update({
        where: { id: deposit.id },
        data: { confirmations, status: newStatus },
      });
    } catch (error) {
      console.error(`Error processing TX ${deposit.txHash}:`, error);
    }
  }
}

// Run every 30 seconds
setInterval(checkConfirmations, 30000);
console.log("Confirmation Worker started.");
