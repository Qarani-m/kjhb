import { WebSocketServer } from "ws";
import url from "url";
import { activeConnections, pendingTimeouts } from "./chatState.js";
import { saveMessage, getGeminiReply } from "./chatService.js";

const TIMEOUT_DURATION = 5000;

export function setupUserWebSocket(httpServer, io) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (request, socket, head) => {
    const parsedUrl = url.parse(request.url, true);
    const pathname = parsedUrl.pathname;

    if (pathname === "/ws/chat") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    }
  });

  wss.on("connection", (ws, req) => {
    const parsedUrl = url.parse(req.url, true);
    // Support ?userId=guest_123 or just default logic
    const userId = parsedUrl.query.userId || `valid_user_${Date.now()}`;

    // Store connection
    activeConnections.set(userId, ws);
    console.log(`User ${userId} connected via Raw WebSocket`);

    // Send Welcome Message
    const welcomeMsg = {
      type: "system",
      text: "Hi! Welcome to Binance Support. How can I help?",
      options: [
        { label: "Deposit Issue", value: "deposit" },
        { label: "Talk to Agent", value: "agent" },
      ],
    };
    ws.send(JSON.stringify(welcomeMsg));

    ws.on("message", async (message) => {
      try {
        const parsedMsg = JSON.parse(message);
        // Expect format: { type: "message", content: "..." }

        const content = parsedMsg.content || parsedMsg.text; // fallback
        if (!content) return;

        // 1. Save User Message
        await saveMessage(userId, "USER", content);

        // 2. Broadcast to Admin (Socket.io)
        io.to("admin_room").emit("new_user_message", { userId, content });

        // 3. Bot Logic / Timeouts
        handleBotLogic(userId, content, ws, io);
      } catch (err) {
        console.error("Error processing message:", err);
      }
    });

    ws.on("close", () => {
      activeConnections.delete(userId);
      console.log(`User ${userId} disconnected`);
    });
  });
}

async function handleBotLogic(userId, content, ws, io) {
  // Clear existing timeout
  if (pendingTimeouts.has(userId)) {
    clearTimeout(pendingTimeouts.get(userId));
  }

  // 4. Start 5-second Timer
  const timeoutId = setTimeout(async () => {
    console.log(`Timeout: Asking AI for user ${userId}...`);

    const aiResponse = await getGeminiReply(content, userId);

    // Save AI Message
    await saveMessage(userId, "AI", aiResponse);

    // Notify User (Raw WS)
    if (ws.readyState === 1) {
      // OPEN
      ws.send(
        JSON.stringify({
          type: "message",
          sender: "AI",
          content: aiResponse,
        })
      );
    }

    // Notify Admin (Socket.io)
    io.to("admin_room").emit("ai_reply", { userId, content: aiResponse });

    pendingTimeouts.delete(userId);
  }, TIMEOUT_DURATION);

  pendingTimeouts.set(userId, timeoutId);
}
