import { saveMessage } from "./chatService.js";
import { activeConnections, pendingTimeouts } from "./chatState.js";

export function setupChatSocket(io) {
  io.on("connection", (socket) => {
    // Admin joining the designated room
    socket.on("join_admin", () => {
      socket.join("admin_room");
      console.log("Admin joined chat dashboard via Socket.io");
    });

    // Admin replying manually
    socket.on("admin_reply", async (data) => {
      const { userId, content } = data;

      // 1. Cancel AI Timer
      if (pendingTimeouts.has(userId)) {
        clearTimeout(pendingTimeouts.get(userId));
        pendingTimeouts.delete(userId);
      }

      // 2. Save Admin Message
      await saveMessage(userId, "ADMIN", content);

      // 3. Send to User (Raw WebSocket)
      const userWs = activeConnections.get(userId);
      if (userWs && userWs.readyState === 1) {
        userWs.send(
          JSON.stringify({
            type: "message",
            sender: "ADMIN",
            content,
          })
        );
      } else {
        console.warn(
          `User ${userId} not connected via WS, cannot deliver admin reply.`
        );
      }

      // Also echo back to admin for consistency (handled by frontend usually, but good for sync)
      // io.to("admin_room").emit("server_message", ...);
    });
  });
}
