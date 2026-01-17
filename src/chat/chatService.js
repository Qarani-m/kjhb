import { prisma } from "../lib/prisma.js";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Save a message to the database
 * @param {string|number} userIdOrGuestId
 * @param {string} sender
 * @param {string} content
 */
export async function saveMessage(userIdOrGuestId, sender, content) {
  try {
    const data = { sender, content };

    // Check if ID is a number (authenticated user) or has numeric format
    const parsedId = parseInt(userIdOrGuestId);
    if (!isNaN(parsedId) && String(parsedId) === String(userIdOrGuestId)) {
      data.userId = parsedId;
    } else {
      // It's a guest string
      data.guestId = String(userIdOrGuestId);
    }

    return await prisma.chatMessage.create({ data });
  } catch (error) {
    console.error("Error saving chat message:", error);
  }
}

/**
 * Get conversation history for a user
 * @param {string|number} userIdOrGuestId
 */
export async function getHistory(userIdOrGuestId) {
  try {
    const where = {};
    const parsedId = parseInt(userIdOrGuestId);

    if (!isNaN(parsedId) && String(parsedId) === String(userIdOrGuestId)) {
      where.userId = parsedId;
    } else {
      where.guestId = String(userIdOrGuestId);
    }

    return await prisma.chatMessage.findMany({
      where,
      orderBy: { createdAt: "asc" },
      take: 50,
    });
  } catch (error) {
    console.error("Error getting chat history:", error);
    return [];
  }
}

/**
 * Get AI response from OpenAI (ChatGPT)
 * @param {string} question
 * @param {number} userId
 */
export async function getGeminiReply(question, userId) {
  try {
    // Optional: Fetch previous context to provide better answers
    const history = await getHistory(userId);
    const messages = [
      {
        role: "system",
        content:
          "You are a helpful support agent for a crypto exchange called YESBCK. Keep answers concise.",
      },
      ...history.map((msg) => ({
        role: msg.sender === "USER" ? "user" : "assistant",
        content: msg.content,
      })),
      { role: "user", content: question },
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: messages,
    });

    return completion.choices[0].message.content;
  } catch (error) {
    console.error("OpenAI Error:", error);
    return "I'm having trouble connecting to my brain right now. Please try again later.";
  }
}
