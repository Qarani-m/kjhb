import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import multer from "multer";
import path from "path";
import fs from "fs";
import { prisma } from "../lib/prisma.js";
import { sendOtpEmail } from "../lib/emailService.js";

const router = express.Router();
const SECRET = process.env.JWT_SECRET || "your-very-secure-secret";

// Middleware for protected routes
export const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "No token provided" });

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    res.status(401).json({ error: "Invalid token" });
  }
};

// Multer Configuration for KYC
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = "uploads/kyc";
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(
      null,
      file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname)
    );
  },
});

const upload = multer({ storage });

// Register
router.post("/register", async (req, res) => {
  const { email, password } = req.body;
  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        balances: {
          create: { coin: "ETH", available: 0, locked: 0 },
        },
      },
    });

    // Generate 6-digit OTP
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    // Save to DB
    await prisma.otp.create({
      data: { email, otp: otpCode, expiresAt },
    });

    try {
      await sendOtpEmail(email, otpCode);
      res.json({ message: "OTP_SENT", email });
    } catch (err) {
      console.error("Failed to send verification email:", err);
      res.status(500).json({ error: "Failed to send verification email" });
    }
  } catch (error) {
    res.status(400).json({ error: "Email already exists or invalid data" });
  }
});

// Login (Step 1: Password Check -> Send OTP)
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await prisma.user.findUnique({ where: { email } });

  if (user && (await bcrypt.compare(password, user.passwordHash))) {
    // Generate 6-digit OTP
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await prisma.otp.create({
      data: { email, otp: otpCode, expiresAt },
    });

    try {
      await sendOtpEmail(email, otpCode, "Login");
      res.json({ message: "OTP_SENT", email });
    } catch (err) {
      res.status(500).json({ error: "Failed to send verification email" });
    }
  } else {
    res.status(401).json({ error: "Invalid credentials" });
  }
});

// ... verify-otp and verify-identity routes ...

// Admin: Get all users
router.get("/admin/users", async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      include: {
        kycRecord: true,
        balances: true,
      },
    });
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// Admin KYC Verification
router.post("/admin/verify-kyc", async (req, res) => {
  const { userId, status } = req.body; // status: VERIFIED or REJECTED

  if (!["VERIFIED", "REJECTED"].includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }

  try {
    await prisma.user.update({
      where: { id: parseInt(userId) },
      data: { kycStatus: status },
    });
    res.json({ message: `User KYC status updated to ${status}` });
  } catch (error) {
    res.status(500).json({ error: "Failed to update KYC status" });
  }
});

// Admin: Update user balance
router.post("/admin/update-balance", async (req, res) => {
  const { userId, coin, amount } = req.body;

  if (!userId || !coin || amount === undefined) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const balance = await prisma.balance.upsert({
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

    res.json({ message: "Balance updated successfully", balance });
  } catch (error) {
    console.error("Balance update error:", error);
    res.status(500).json({ error: "Failed to update balance" });
  }
});

// Verify OTP (Step 2: Check Code -> Issue JWT)
router.post("/verify-otp", async (req, res) => {
  const { email, otp } = req.body;

  const validOtp = await prisma.otp.findFirst({
    where: {
      email,
      otp,
      expiresAt: { gt: new Date() },
    },
  });

  if (!validOtp) {
    return res.status(401).json({ error: "Invalid or expired code" });
  }

  // Find user
  const user = await prisma.user.findUnique({ where: { email } });

  // Delete OTP after verification
  await prisma.otp.delete({ where: { id: validOtp.id } });

  const token = jwt.sign({ userId: user.id }, SECRET, { expiresIn: "24h" });
  res.json({ token, userId: user.id });
});

// Identity Verification (KYC)
router.post(
  "/verify-identity",
  authMiddleware,
  upload.fields([
    { name: "idFront", maxCount: 1 },
    { name: "idBack", maxCount: 1 },
    { name: "selfie", maxCount: 1 },
  ]),
  async (req, res) => {
    const { firstName, lastName, dob, nationality, idType } = req.body;
    const files = req.files;

    if (
      !firstName ||
      !lastName ||
      !dob ||
      !nationality ||
      !idType ||
      !files.idFront ||
      !files.idBack ||
      !files.selfie
    ) {
      return res
        .status(400)
        .json({ error: "Missing required KYC fields or files" });
    }

    try {
      await prisma.$transaction([
        prisma.kycRecord.upsert({
          where: { userId: req.userId },
          update: {
            firstName,
            lastName,
            dob,
            nationality,
            idType,
            idFrontPath: files.idFront[0].path,
            idBackPath: files.idBack[0].path,
            selfiePath: files.selfie[0].path,
          },
          create: {
            userId: req.userId,
            firstName,
            lastName,
            dob,
            nationality,
            idType,
            idFrontPath: files.idFront[0].path,
            idBackPath: files.idBack[0].path,
            selfiePath: files.selfie[0].path,
          },
        }),
        prisma.user.update({
          where: { id: req.userId },
          data: { kycStatus: "PENDING" },
        }),
      ]);

      res.json({ message: "KYC submission successful, verification pending" });
    } catch (error) {
      console.error("KYC Error:", error);
      res.status(500).json({ error: "Failed to process KYC submission" });
    }
  }
);

export default router;
