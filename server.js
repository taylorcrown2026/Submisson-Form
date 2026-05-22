const express = require("express");
const XLSX = require("xlsx");
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
    await pool.query(
      `INSERT INTO responses 
       (full_name, work_email, answer, user_agent)
       VALUES ($1, $2, $3, $4)`,
      [
        req.body.fullName,
        req.body.workEmail,
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
app.post("/api/login", (req, res) => {
  if (req.body.username === "admin" && req.body.password === "password") {
    req.session.auth = true;
    return res.json({ success: true });
  }
  res.status(401).json({ error: "Invalid credentials" });
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
