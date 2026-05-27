const express = require("express");
const XLSX = require("xlsx");
const bcrypt = require("bcrypt");
const rateLimit = require("express-rate-limit");
const session = require("express-session");
const { Pool } = require("pg");
const multer = require("multer");
const path = require("path");

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
  max: 10
});

/* =====================
   DATABASE
===================== */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false
});

const initDB = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS responses (
      id SERIAL PRIMARY KEY,
      full_name TEXT,
      work_email TEXT,
      department TEXT,
      month TEXT,
      file_path TEXT,
      user_agent TEXT,
      timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  console.log("✅ Database ready");
};
initDB();

/* =====================
   MIDDLEWARE
===================== */
app.use(express.json());
app.use(express.static("."));

app.use(session({
  secret: process.env.SESSION_SECRET || "dev-secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // ✅ works locally
    sameSite: "lax"
  }
}));

/* =====================
   FILE UPLOAD
===================== */
const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype === "application/pdf" ||
      file.originalname.endsWith(".vsdx")
    ) cb(null, true);
    else cb(new Error("Only PDF or Visio"));
  }
});

app.use("/uploads", express.static("uploads"));

const DEPARTMENTS = ["HR","Finance","IT","Operations","Clinical","Legal"];

/* =====================
   LOGIN
===================== */
app.post("/api/login", loginLimiter, async (req, res) => {
  const { username, password } = req.body;

  if (username !== ADMIN_USER) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const match = await bcrypt.compare(password, ADMIN_PASS_HASH);

  if (!match) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  req.session.auth = true;
  res.json({ success: true });
});

/* =====================
   SUBMIT
===================== */
app.post("/api/submit", upload.single("file"), async (req, res) => {
  try {
    const email = String(req.body.workEmail || "").toLowerCase().trim();
    const department = req.body.department;
    const month = req.body.month;

    if (!email.endsWith("@concentra.com")) {
      return res.status(400).json({ error: "Use company email" });
    }

    if (!DEPARTMENTS.includes(department)) {
      return res.status(400).json({ error: "Invalid department" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "File required" });
    }

    const existing = await pool.query(
      `SELECT 1 FROM responses WHERE department=$1 AND month=$2`,
      [department, month]
    );

    if (existing.rowCount > 0) {
      return res.status(400).json({
        error: "Already submitted for that department/month"
      });
    }

    await pool.query(
      `INSERT INTO responses
      (full_name, work_email, department, month, file_path, user_agent)
      VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        req.body.fullName,
        email,
        department,
        month,
        req.file.filename,
        req.headers["user-agent"]
      ]
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Submission failed" });
  }
});

/* =====================
   ADMIN APIs
===================== */
app.get("/api/admin/responses", async (req, res) => {
  if (!req.session.auth) return res.sendStatus(401);

  const result = await pool.query("SELECT * FROM responses ORDER BY timestamp DESC");

  res.json({
    responses: result.rows.map(r => ({
      fullName: r.full_name,
      workEmail: r.work_email,
      department: r.department,
      month: r.month,
      fileUrl: `/uploads/${r.file_path}`,
      timestamp: r.timestamp
    }))
  });
});

app.get("/api/admin/export", async (req, res) => {
  if (!req.session.auth) return res.sendStatus(401);

  const result = await pool.query("SELECT * FROM responses");

  const data = result.rows.map(r => ({
    "Full Name": r.full_name,
    "Email": r.work_email,
    "Department": r.department,
    "Month": r.month,
    "Submitted": new Date(r.timestamp).toLocaleString()
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Responses");

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  res.setHeader("Content-Disposition", "attachment; filename=data.xlsx");
  res.send(buffer);
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

/* =====================
   START
===================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("✅ Running on", PORT));