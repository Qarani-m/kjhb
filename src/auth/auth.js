import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import multer from "multer";
import path from "path";
import fs from "fs";
import { query, queryOne, execute, transaction } from "../lib/db.js";
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

    // Insert user
    const userResult = await execute(
      'INSERT INTO "User" ("email", "passwordHash", "createdAt", "kycStatus") VALUES ($1, $2, NOW(), $3) RETURNING *',
      [email, passwordHash, 'UNVERIFIED']
    );
    const user = userResult.rows?.[0] || { id: userResult.insertId };

    // Create initial ETH balance
    await execute(
      'INSERT INTO "Balance" ("userId", "coin", "available", "locked") VALUES ($1, $2, $3, $4)',
      [user.id, 'ETH', 0, 0]
    );

    // Generate 6-digit OTP
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    // Save OTP to DB
    await execute(
      'INSERT INTO "Otp" ("email", "otp", "expiresAt", "createdAt") VALUES ($1, $2, $3, NOW())',
      [email, otpCode, expiresAt]
    );

    try {
      await sendOtpEmail(email, otpCode);
      res.json({ message: "OTP_SENT", email });
    } catch (err) {
      console.error("Failed to send verification email:", err);
      res.status(500).json({ error: "Failed to send verification email" });
    }
  } catch (error) {
    console.error("Registration error:", error);
    res.status(400).json({ error: "Email already exists or invalid data" });
  }
});

// Login (Step 1: Password Check -> Send OTP)
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await queryOne('SELECT * FROM "User" WHERE "email" = $1', [email]);

  if (user && (await bcrypt.compare(password, user.passwordHash))) {
    // Generate 6-digit OTP
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await execute(
      'INSERT INTO "Otp" ("email", "otp", "expiresAt", "createdAt") VALUES ($1, $2, $3, NOW())',
      [email, otpCode, expiresAt]
    );

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

// Admin: Get all users
router.get("/admin/users", async (req, res) => {
  try {
    const users = await query(`
      SELECT
        u.*,
        json_agg(DISTINCT jsonb_build_object('id', b.id, 'coin', b.coin, 'available', b.available, 'locked', b.locked)) FILTER (WHERE b.id IS NOT NULL) as balances,
        json_agg(DISTINCT jsonb_build_object('id', k.id, 'firstName', k.firstName, 'lastName', k.lastName, 'dob', k.dob, 'nationality', k.nationality, 'idType', k.idType)) FILTER (WHERE k.id IS NOT NULL) as "kycRecords"
      FROM "User" u
      LEFT JOIN "Balance" b ON u.id = b."userId"
      LEFT JOIN "KycRecord" k ON u.id = k."userId"
      GROUP BY u.id
    `);

    // Format the response
    const formattedUsers = users.map(user => ({
      ...user,
      balances: user.balances || [],
      kycRecord: user.kycRecords?.[0] || null,
    }));

    res.json(formattedUsers);
  } catch (error) {
    console.error("Failed to fetch users:", error);
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
    await execute(
      'UPDATE "User" SET "kycStatus" = $1 WHERE "id" = $2',
      [status, parseInt(userId)]
    );
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
    const userIdInt = parseInt(userId);
    const coinUpper = coin.toUpperCase();
    const amountFloat = parseFloat(amount);

    // Check if balance exists
    const existing = await queryOne(
      'SELECT * FROM "Balance" WHERE "userId" = $1 AND "coin" = $2',
      [userIdInt, coinUpper]
    );

    if (existing) {
      // Update existing balance
      await execute(
        'UPDATE "Balance" SET "available" = "available" + $1 WHERE "userId" = $2 AND "coin" = $3',
        [amountFloat, userIdInt, coinUpper]
      );
    } else {
      // Create new balance
      await execute(
        'INSERT INTO "Balance" ("userId", "coin", "available", "locked") VALUES ($1, $2, $3, 0)',
        [userIdInt, coinUpper, amountFloat]
      );
    }

    const balance = await queryOne(
      'SELECT * FROM "Balance" WHERE "userId" = $1 AND "coin" = $2',
      [userIdInt, coinUpper]
    );

    res.json({ message: "Balance updated successfully", balance });
  } catch (error) {
    console.error("Balance update error:", error);
    res.status(500).json({ error: "Failed to update balance" });
  }
});

// Verify OTP (Step 2: Check Code -> Issue JWT)
router.post("/verify-otp", async (req, res) => {
  const { email, otp } = req.body;

  const validOtp = await queryOne(
    'SELECT * FROM "Otp" WHERE "email" = $1 AND "otp" = $2 AND "expiresAt" > $3 ORDER BY "createdAt" DESC LIMIT 1',
    [email, otp, new Date()]
  );

  if (!validOtp) {
    return res.status(401).json({ error: "Invalid or expired code" });
  }

  // Find user
  const user = await queryOne('SELECT * FROM "User" WHERE "email" = $1', [email]);

  // Delete OTP after verification
  await execute('DELETE FROM "Otp" WHERE "id" = $1', [validOtp.id]);

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
      await transaction(async (client) => {
        // Check if KYC record exists
        const existing = await queryOne(
          'SELECT * FROM "KycRecord" WHERE "userId" = $1',
          [req.userId]
        );

        if (existing) {
          // Update existing KYC record
          await execute(
            'UPDATE "KycRecord" SET "firstName" = $1, "lastName" = $2, "dob" = $3, "nationality" = $4, "idType" = $5, "idFrontPath" = $6, "idBackPath" = $7, "selfiePath" = $8, "updatedAt" = NOW() WHERE "userId" = $9',
            [
              firstName,
              lastName,
              dob,
              nationality,
              idType,
              files.idFront[0].path,
              files.idBack[0].path,
              files.selfie[0].path,
              req.userId,
            ]
          );
        } else {
          // Create new KYC record
          await execute(
            'INSERT INTO "KycRecord" ("userId", "firstName", "lastName", "dob", "nationality", "idType", "idFrontPath", "idBackPath", "selfiePath", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())',
            [
              req.userId,
              firstName,
              lastName,
              dob,
              nationality,
              idType,
              files.idFront[0].path,
              files.idBack[0].path,
              files.selfie[0].path,
            ]
          );
        }

        // Update user KYC status
        await execute(
          'UPDATE "User" SET "kycStatus" = $1 WHERE "id" = $2',
          ['PENDING', req.userId]
        );
      });

      res.json({ message: "KYC submission successful, verification pending" });
    } catch (error) {
      console.error("KYC Error:", error);
      res.status(500).json({ error: "Failed to process KYC submission" });
    }
  }
);

export default router;
