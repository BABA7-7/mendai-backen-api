
import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import axios from "axios";
import { GoogleGenerativeAI } from "@google/generative-ai";
import bcrypt from "bcrypt";
import { db } from "./db.js";
import jwt from "jsonwebtoken";


dotenv.config();

const app = express();
// At the top, replace your current cors() with this
app.use(
  cors({
    origin: "https://meek-syrniki-969853.netlify.app",
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"],
    exposedHeaders: ["Authorization"], // ← important for token responses
    methods: ["GET", "POST", "OPTIONS", "PUT", "DELETE"],
    preflightContinue: false,
    optionsSuccessStatus: 204
  })
);


app.use(express.json());
const auth = (req, res, next) => {
  const header = req.headers.authorization;
  console.log("AUTH HEADER:", header); // <-- see if header arrives
  if (!header) return res.status(401).json({ success: false, message: "No auth header" });

  try {
    const token = header.split(" ")[1];
    console.log("TOKEN:", token); // <-- log token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log("JWT DECODED:", decoded); // <-- log decoded token
    req.user = decoded;
    next();
  } catch (err) {
    console.error("JWT ERROR:", err.message);
    res.status(401).json({ success: false, message: "Invalid token" });
  }
};


/* =========================
   GEMINI SETUP
========================= */
const upload = multer({ dest: "uploads/" });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function generateWithRetry(model, contentParts, maxRetries = 3) {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      const result = await model.generateContent(contentParts);
      return result.response.text();
    } catch (err) {
      if (err.message?.includes("429")) {
        attempt++;
        await sleep(Math.pow(2, attempt) * 2000);
      } else {
        throw err;
      }
    }
  }
  throw new Error("Gemini retry failed");
}
app.post("/login", async (req, res) => {
  const { mobile, password } = req.body;

  if (!mobile || !password) {
    return res
      .status(400)
      .json({ success: false, message: "Mobile and password required" });
  }

  try {
    // 1️⃣ Find user
    const [rows] = await db.query(
      "SELECT * FROM users WHERE mobile = ?",
      [mobile]
    );

    if (rows.length === 0) {
      return res
        .status(401)
        .json({ success: false, message: "User not found" });
    }

    const user = rows[0];

    // 2️⃣ Compare password
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid password" });
    }

    // 3️⃣ Generate JWT
    const token = jwt.sign(
      { id: user.id, mobile: user.mobile },
      process.env.JWT_SECRET,
      { expiresIn: "10y" }
    );

    // 4️⃣ Send response
    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        mobile: user.mobile,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});
/* =========================
   CREATE ACCOUNT
========================= */
app.post("/create-account", async (req, res) => {
  const { name, mobile, password } = req.body;

  if (!name || !mobile || !password) {
    return res.status(400).json({
      success: false,
      message: "All fields are required",
    });
  }

  try {
    // Check existing user
    const [existing] = await db.query(
      "SELECT id FROM users WHERE mobile = ?",
      [mobile]
    );

    if (existing.length > 0) {
      return res.status(409).json({
        success: false,
        message: "User already exists",
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user
    const [result] = await db.query(
      "INSERT INTO users (name, mobile, password) VALUES (?, ?, ?)",
      [name, mobile, hashedPassword]
    );

    // Generate JWT
    const token = jwt.sign(
      { id: result.insertId, mobile },
      process.env.JWT_SECRET,
      { expiresIn: "10y" }
    );

    res.status(201).json({
      success: true,
      message: "User registered successfully",
      token,
      user: {
        id: result.insertId,
        name,
        mobile,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});


app.post("/ai-diagnose", upload.array("files"), async (req, res) => {
  try {
    const prompt =
      (req.body.prompt || "Analyze the issue") +
      "\nRespond in bullet points.";

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const parts = [{ text: prompt }];

    if (req.files?.length) {
      for (const file of req.files) {
        const img = fs.readFileSync(file.path).toString("base64");
        parts.push({
          inlineData: { data: img, mimeType: file.mimetype },
        });
        fs.unlinkSync(file.path);
      }
    }

    const response = await generateWithRetry(model, parts);
    res.json({ diagnosis: response });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   OTP CONFIG
========================= */
const OTP_API_KEY = process.env.TWO_FACTOR_API_KEY;

/* =========================
   SEND OTP
========================= */
// app.post("/send-otp", async (req, res) => {
//   const { mobile, channel } = req.body;

//   if (!mobile || mobile.length !== 10) {
//     return res.status(400).json({ success: false, message: "Invalid mobile" });
//   }

//   try {
//     const url =
//       channel === "whatsapp"
//         ? `https://2factor.in/API/V1/${OTP_API_KEY}/WHATSAPP/91${mobile}`
//         : `https://2factor.in/API/V1/${OTP_API_KEY}/SMS/91${mobile}/AUTOGEN`;

//     const response = await axios.get(url);

//     res.json({
//       success: true,
//       sessionId: response.data.Details,
//     });
//   } catch (err) {
//     res.status(500).json({ success: false, error: "OTP send failed" });
//   }
// });

/* =========================
   VERIFY OTP
========================= */
// app.post("/verify-otp", async (req, res) => {
//   const { otp, sessionId } = req.body;

//   if (!otp || !sessionId) {
//     return res.status(400).json({ success: false });
//   }

//   try {
//     const url = `https://2factor.in/API/V1/${OTP_API_KEY}/SMS/VERIFY/${sessionId}/${otp}`;
//     const response = await axios.get(url);

//     if (response.data.Details === "OTP Matched") {
//       return res.json({ success: true });
//     }

//     res.status(400).json({ success: false, message: "Invalid OTP" });
//   } catch (err) {
//     res.status(500).json({ success: false, error: "OTP verification failed" });
//   }
// });
app.post("/send-otp", async (req, res) => {
  const { mobile, channel } = req.body;

  if (!mobile || mobile.length !== 10) {
    return res.status(400).json({
      success: false,
      message: "Invalid mobile number",
    });
  }

  try {
    // 🔍 CHECK MOBILE IN MYSQL
    const [rows] = await db.execute(
      "SELECT id FROM users WHERE mobile = ? LIMIT 1",
      [mobile]
    );

    if (rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: "Mobile number already registered",
      });
    }

    // 📲 SEND OTP
    const url =
      channel === "whatsapp"
        ? `https://2factor.in/API/V1/${OTP_API_KEY}/WHATSAPP/91${mobile}`
        : `https://2factor.in/API/V1/${OTP_API_KEY}/SMS/91${mobile}/AUTOGEN`;

    const response = await axios.get(url);

    return res.json({
      success: true,
      sessionId: response.data.Details,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "OTP send failed",
    });
  }
});
app.post("/chat/start", auth, async (req, res) => {
  const userId = req.user.id;

  try {
    const [result] = await db.query(
      "INSERT INTO chat_sessions (user_id, session_name) VALUES (?, ?)",
      [userId, "New chat"]
    );

    res.json({
      success: true,
      sessionId: result.insertId,
      session_name: "New chat",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});


app.post(
  "/chat/message",
  auth,
  upload.array("files"),
  async (req, res) => {
    const { sessionId, role } = req.body;
    const text = req.body.text || "";
    const userId = req.user.id;

    if (!sessionId || !role) {
      return res.status(400).json({ success: false, message: "Missing fields" });
    }

    try {
      // ✅ CHECK SESSION OWNERSHIP
      const [[session]] = await db.query(
        "SELECT id FROM chat_sessions WHERE id = ? AND user_id = ?",
        [sessionId, userId]
      );

      if (!session) {
        return res.status(403).json({ success: false, message: "Forbidden" });
      }

      // Save image paths
      let images = [];
      if (req.files?.length) {
        images = req.files.map(f => `/uploads/${f.filename}`);
      }

      // Save message
      // const [result] = await db.query(
      //   "INSERT INTO chat_messages (session_id, role, text, images) VALUES (?, ?, ?, ?)",
      //   [sessionId, role, text, JSON.stringify(images)]
      // );
// Save user message
const [result] = await db.query(
  "INSERT INTO chat_messages (session_id, user_id, role, text, images) VALUES (?, ?, ?, ?, ?)",
  [sessionId, userId, role, text, JSON.stringify(images)] // Added userId here
);
      let aiResponse = null;

      // AI reply only for user messages
      if (role === "user" && text.trim()) {
        // Update session title (first message)
        await db.query(
          `UPDATE chat_sessions 
           SET session_name = ?
           WHERE id = ? AND (session_name IS NULL OR session_name = 'New chat')`,
          [text.slice(0, 60) + (text.length > 60 ? "..." : ""), sessionId]
        );

        const model = genAI.getGenerativeModel({
          model: "gemini-2.5-flash",
        });

        const parts = [{ text: text.trim() }];

        for (const file of req.files || []) {
          const img = fs.readFileSync(file.path).toString("base64");
          parts.push({
            inlineData: { data: img, mimeType: file.mimetype },
          });
          fs.unlinkSync(file.path); // cleanup
        }

        aiResponse = (await generateWithRetry(model, parts)).trim();

        // await db.query(
        //   "INSERT INTO chat_messages (session_id, role, text) VALUES (?, 'ai', ?)",
        //   [sessionId, aiResponse]
        // );
        // Save AI reply
await db.query(
  "INSERT INTO chat_messages (session_id, user_id, role, text) VALUES (?, ?, 'ai', ?)",
  [sessionId, userId, aiResponse] // Added userId here
);
      }

      res.json({
        success: true,
        messageId: result.insertId,
        aiResponse,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

app.get("/chat/sessions", auth, async (req, res) => {
  const userId = req.user.id;

  console.log("AUTH HEADER:", req.headers.authorization);
  console.log("USER ID FROM JWT:", userId);

  try {
    const [sessions] = await db.query(
      `SELECT 
         id,
         session_name AS title,
         created_at
       FROM chat_sessions
       WHERE user_id = ?
       ORDER BY created_at DESC`,
      [userId]
    );

    console.log("FOUND SESSIONS:", sessions);

    res.json({ 
      success: true, 
      sessions: sessions || [] 
    });
  } catch (err) {
    console.error("ERROR FETCHING SESSIONS:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});
app.get("/chat/:sessionId", auth, async (req, res) => {
  const { sessionId } = req.params;
  const userId = req.user.id;

  try {
    // ✅ Check session ownership
 const [[session]] = await db.query(
  "SELECT id FROM chat_sessions WHERE id = CAST(? AS UNSIGNED) AND user_id = ?",
  [sessionId, userId]
);


    if (!session) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized access",
      });
    }

    // ✅ Fetch messages
    const [messages] = await db.query(
      "SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC",
      [sessionId]
    );

    res.json({ success: true, messages });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});


app.post("/appointments", auth, async (req, res) => {
  const userId = req.user.id;
  const { name, address, lat, lng } = req.body;

  if (!name || !address) {
    return res.status(400).json({
      success: false,
      message: "Name and address are required",
    });
  }

  try {
    const [result] = await db.query(
      `INSERT INTO appointments (user_id, name, address, lat, lng)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, name, address, lat || null, lng || null]
    );

    res.status(201).json({
      success: true,
      appointmentId: result.insertId,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.get("/appointments", auth, async (req, res) => {
  try {
    const userId = req.user.id;

    const [rows] = await db.query(
      `SELECT id, name, address, status, created_at
       FROM appointments
       WHERE user_id = ?
       ORDER BY created_at DESC`,
      [userId]
    );

    res.json({ success: true, appointments: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/* =========================
   START SERVER
========================= */
/* =========================
   START SERVER
========================= */
const PORT = process.env.PORT || 5000;

// Adding '0.0.0.0' is crucial for Render to bind the host correctly
app.listen(PORT, '0.0.0.0', () =>
  console.log(`🚀 Server running on port ${PORT}`)
);
