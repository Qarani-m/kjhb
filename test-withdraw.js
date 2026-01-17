import dotenv from "dotenv";
dotenv.config();

const API_URL = "http://localhost:3010";
const LOGIN_PAYLOAD = {
  email: "test@example.com",
  password: "password123",
};

async function testWithdrawal() {
  try {
    console.log("1. Logging in...");
    const loginRes = await fetch(`${API_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(LOGIN_PAYLOAD),
    });

    if (!loginRes.ok) {
      throw new Error(
        `Login failed: ${loginRes.status} ${await loginRes.text()}`
      );
    }

    const { token } = await loginRes.data();
    console.log("   Login successful!");

    console.log("2. Initiating withdrawal...");
    const withdrawRes = await fetch(`${API_URL}/withdraw`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        coin: "ETH",
        network: "ETH",
        amount: 0.01,
        address: "0x000000000000000000000000000000000000dEaD",
      }),
    });

    const result = await withdrawRes.json();
    if (!withdrawRes.ok) {
      console.error("   Error:", withdrawRes.status, result);
    } else {
      console.log("   Withdrawal Initiated:", result);
    }
    console.log("3. Verification complete.");
  } catch (error) {
    console.error("   Error:", error.message);
  }
}

testWithdrawal();
