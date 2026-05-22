const express = require("express");
const XLSX = require("xlsx");
const bcrypt = require("bcrypt");
const rateLimit = require("express-rate-limit");
const session = require("express-session");

const app = express();

const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
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

    // ✅ Ensure column exists (safe migration)
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

app.set("trust proxy", true);
app.use(express.json());
app.use(express.static("."));

app.get("/api/admin/export", async (req, res) => {
  if (!req.session.auth) {
    return res.sendStatus(401);
  }

  try {
    const result = await pool.query(
      "SELECT * FROM responses ORDER BY timestamp DESC"
    );

    // Convert DB rows → clean format for Excel
const data = result.rows.map((row) => ({
  "Full Name": row.full_name,
  "Work Email": row.work_email,
  "Answer": row.answer,
  "User Agent": row.user_agent,
  "Submitted": new Date(row.timestamp).toLocaleString(),
}));

    // Create worksheet
    const worksheet = XLSX.utils.json_to_sheet(data);

    // Create workbook
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Responses");

    // Generate file buffer
    const buffer = XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
    });

    // Send file to browser
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
   SUBMIT FORM
===================== */

app.post("/api/submit", async (req, res) => {
  try {
    const email = String(req.body.workEmail || "").trim().toLowerCase();

    // ✅ Enforce company domain
    if (!email.endsWith("@concentra.com")) {
      return res.status(400).json({
        error: "Please use your @concentra.com email"
      });
    }

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
        req.headers["user-agent"],
      ]
    );

    res.json({ success: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});


/* =====================
   LOGIN
===================== */

const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS_HASH = process.env.ADMIN_PASS_HASH;

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

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // only 10 attempts
  message: {
    error: "Too many login attempts. Try again later."
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.set('trust proxy', 1);

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
   GET RESPONSES (ADMIN)
===================== */
app.get("/api/admin/responses", async (req, res) => {
  if (!req.session.auth) {
    return res.sendStatus(401);
  }

  try {
    const result = await pool.query(
      "SELECT * FROM responses ORDER BY timestamp DESC"
    );

const formatted = result.rows.map((row) => ({
  fullName: row.full_name,
  workEmail: row.work_email,
  answer: row.answer,
  userAgent: row.user_agent,
  timestamp: row.timestamp,
}));

    res.json({ responses: formatted });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
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

app.set('trust proxy', 1);

/* =====================
   START SERVER
===================== */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
