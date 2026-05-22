const express = require("express");
const XLSX = require("xlsx");
const bcrypt = require("bcrypt");
const rateLimit = require("express-rate-limit");
const session = require("express-session");
const { Pool } = require("pg");

const app = express();

/* =====================
   ENV CONFIG
===================== */
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS_HASH = process.env.ADMIN_PASS_HASH;

/* =====================
   RATE LIMITER
===================== */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    error: "Too many login attempts. Try again later."
  }
});

/* =====================
   DATABASE
===================== */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const initDB = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS responses (
        id SERIAL PRIMARY KEY,
        full_name TEXT,
        work_email TEXT,
        answer TEXT,
        user_agent TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // ensure column exists
    await pool.query(`
      ALTER TABLE responses
      ADD COLUMN IF NOT EXISTS work_email TEXT;
    `);

    console.log("✅ Database ready");
  } catch (err) {
    console.error("❌ DB init error:", err);
  }
};

initDB();

/* =====================
   MIDDLEWARE
===================== */
app.set("trust proxy", 1);

app.use(express.json());
app.use(express.static("."));

app.use(session({
  secret: process.env.SESSION_SECRET || "dev-secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true,
    sameSite: "none"
  }
}));

/* =====================
   LOGIN
===================== */
app.post("/api/login", loginLimiter, async (req, res) => {
  const { username, password } = req.body;

  try {
    if (username !== ADMIN_USER) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const match = await bcrypt.compare(password, ADMIN_PASS_HASH);

    if (!match) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    req.session.auth = true;
    res.json({ success: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Login error" });
  }
});

/* =====================
   SUBMIT FORM
===================== */
app.post("/api/submit", async (req, res) => {
  try {
    const email = String(req.body.workEmail || "").trim().toLowerCase();

    // ✅ enforce company email
    if (!email.endsWith("@concentra.com")) {
      return res.status(400).json({
        error: "Please use your @concentra.com email"
      });
    }

    // ✅ prevent duplicates
    const existing = await pool.query(
      "SELECT 1 FROM responses WHERE work_email = $1",
      [email]
    );

    if (existing.rowCount > 0) {
      return res.status(400).json({
        error: "This email has already submitted a response"
      });
    }

    await pool.query(
      `INSERT INTO responses 
       (full_name, work_email, answer, user_agent)
       VALUES ($1, $2, $3, $4)`,
      [
        req.body.fullName,
        email,
        req.body.answer,
        req.headers["user-agent"]
      ]
    );

    res.json({ success: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

/* =====================
   ADMIN: GET RESPONSES
===================== */
app.get("/api/admin/responses", async (req, res) => {
  if (!req.session.auth) {
    return res.sendStatus(401);
  }

  try {
    const result = await pool.query(
      "SELECT * FROM responses ORDER BY timestamp DESC"
    );

    const formatted = result.rows.map(r => ({
      fullName: r.full_name,
      workEmail: r.work_email,
      answer: r.answer,
      userAgent: r.user_agent,
      timestamp: r.timestamp
    }));

    res.json({ responses: formatted });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

/* =====================
   ADMIN: EXPORT EXCEL
===================== */
app.get("/api/admin/export", async (req, res) => {
  if (!req.session.auth) {
    return res.sendStatus(401);
  }

  try {
    const result = await pool.query(
      "SELECT * FROM responses ORDER BY timestamp DESC"
    );

    const data = result.rows.map(row => ({
      "Full Name": row.full_name,
      "Work Email": row.work_email,
      "Answer": row.answer,
      "User Agent": row.user_agent,
      "Submitted": new Date(row.timestamp).toLocaleString()
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Responses");

    const buffer = XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx"
    });

    res.setHeader(
      "Content-Disposition",
      "attachment; filename=responses.xlsx"
    );
    res.type(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    res.send(buffer);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Export failed" });
  }
});

/* =====================
   LOGOUT
===================== */
app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

/* =====================
   START SERVER
===================== */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("✅ Server running on port", PORT);
});
