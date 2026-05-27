const express = require("express");
const XLSX = require("xlsx");
const bcrypt = require("bcrypt");
const rateLimit = require("express-rate-limit");
const session = require("express-session");
const { Pool } = require("pg");
const multer = require("multer");
const path = require("path");
const nodemailer = require("nodemailer");
const cron = require("node-cron");


const fs = require("fs");
if (!fs.existsSync("uploads")) {
  fs.mkdirSync("uploads");
}

const transporter = nodemailer.createTransport({
  host: "smtp.office365.com",
  port: 587,
  secure: false,
  auth: {
    user: "tcrownover@concentra.com",
    pass: process.env.EMAIL_PASSWORD
  }
});

const app = express();

app.set("trust proxy", 1);

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
  try {
    console.log("🔧 Fixing database schema...");

    // ✅ Step 1: Rename broken table if it exists
    await pool.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'responses') THEN
          IF NOT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_name = 'responses'
            AND column_name = 'department'
          ) THEN
            ALTER TABLE responses RENAME TO responses_old;
          END IF;
        END IF;
      END $$;
    `);

    // ✅ Step 2: Create correct table
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

    console.log("✅ Database ready (schema guaranteed)");

  } catch (err) {
    console.error("❌ DB init error:", err);
  }
};

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

const DEPARTMENT_EMAILS = {
  "Executive Leadership": "tcrownover@concentra.com",
  "President Clinical, Operations, Sales, Marketing, Onsites, Corporate Development, Real Estate": "tcrownover@concentra.com",
  "Real Estate, Procurement, Strategic Pricing, and Treasury": "tcrownover@concentra.com",
  "Onsite Health Billing": "tcrownover@concentra.com",
  "Onsite Health Medical": "tcrownover@concentra.com",
  "Onsite Health Operations": "tcrownover@concentra.com",
  "Onsite Health Sales, Customer Success, and Strategy": "tcrownover@concentra.com",
  "Marketing Innovation": "tcrownover@concentra.com",
  "Marketing-Customer Success Group": "tcrownover@concentra.com",
  "Marketing-Telemedicine": "tcrownover@concentra.com",
  "Medical Clinician Leadership": "tcrownover@concentra.com",
  "Clinical Content Committee": "tcrownover@concentra.com",
  "Medical Expert Panel": "tcrownover@concentra.com",
  "Medical Clinical Analytics Quality": "tcrownover@concentra.com",
  "Clinical Services Leadership": "tcrownover@concentra.com",
  "Operations East Group Leadership": "tcrownover@concentra.com",
  "Operations West Group Leadership": "tcrownover@concentra.com",
  "National Field Support Implementation": "tcrownover@concentra.com",
  "Sales, Enterprise Accounts, Payor Relations, Revenue Operations": "tcrownover@concentra.com",
  "Sales Customer Engagement Enterprise Accounts": "tcrownover@concentra.com",
  "Sales Payor Relations": "tcrownover@concentra.com",
  "Revenue Operations": "tcrownover@concentra.com",
  "Sales Field Sales LDR Special Projects": "tcrownover@concentra.com",
  "Sales Field Sales East": "tcrownover@concentra.com",
  "Sales Field Sales Central": "tcrownover@concentra.com",
  "Sales Field Sales West": "tcrownover@concentra.com",
  "Reimbursement Government Relations Leadership": "tcrownover@concentra.com",
  "Reimbursement Government Relations Reimbursement": "tcrownover@concentra.com",
  "Reimbursement Government Relations Coding Compliance": "tcrownover@concentra.com",
  "Reimbursement Government Relations Group Health Managed Care Contracting": "tcrownover@concentra.com",
  "Accounting and Finance": "tcrownover@concentra.com",
  "IS Leadership Concentra": "tcrownover@concentra.com",
  "HR Leadership": "tcrownover@concentra.com",
  "HR Services": "tcrownover@concentra.com",
  "Talent Acquisition": "tcrownover@concentra.com",
  "Learning Department": "tcrownover@concentra.com",
  "Legal Department Leadership": "tcrownover@concentra.com",
  "St Mary's Managed Pharmacy Program": "tcrownover@concentra.com",
  "HR Total Rewards": "tcrownover@concentra.com"
};

const DEPARTMENTS = Object.keys(DEPARTMENT_EMAILS);

app.get("/api/departments", (req, res) => {
  res.json({ departments: DEPARTMENTS });
});

const sendReminders = async () => {
  const now = new Date();
  const currentMonth = now.toLocaleString('default', { month: 'long' });

  try {
    const result = await pool.query(
      "SELECT department FROM responses WHERE month = $1",
      [currentMonth]
    );

    const submitted = result.rows.map(r => r.department.trim().toLowerCase());
    const missing = DEPARTMENTS.filter(
  d => !submitted.includes(d.trim().toLowerCase()));

    console.log("Missing departments:", missing);

    for (const dept of missing) {
      const email = DEPARTMENT_EMAILS[dept];
      if (!email) continue;

      await transporter.sendMail({
        from: "tcrownover@concentra.com",
        to: email,
        subject: `Reminder: Org Chart Submission - ${currentMonth}`,
        text: `
Hello,

This is an automated reminder that your department has not yet submitted the required org chart for ${currentMonth}.

Please submit it as soon as possible.

Thank you.
        `
      });

      console.log("✅ Email sent to:", dept);
    }

  } catch (err) {
    console.error("❌ Reminder error:", err);
  }
};

cron.schedule("0 9 20,24,28 * *", () => {
  console.log("⏰ Scheduled reminder run");
  sendReminders();
});

cron.schedule("0 9 * * *", () => {
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);

  // If tomorrow is next month = today is last day
  if (tomorrow.getMonth() !== today.getMonth()) {
    console.log("📅 Last day of month reminder");
    sendReminders();
  }
});

app.get("/api/reset-db", async (req, res) => {
  try {
    await pool.query("TRUNCATE TABLE responses RESTART IDENTITY");
    res.send("✅ Database fully reset");
  } catch (err) {
    console.error(err);
    res.status(500).send("❌ Reset failed");
  }
});

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

    console.log("Saved file:", req.file.path);

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

app.get("/api/download/:filename", (req, res) => {
  const filePath = path.join(__dirname, "uploads", req.params.filename);

  res.download(filePath, err => {
    if (err) {
      console.error("Download error:", err);
      res.status(404).send("File not found");
    }
  });
});

app.get("/api/test-reminders", async (req, res) => {
  try {
    await sendReminders();
    res.send("✅ Reminder test executed — check logs and email");
  } catch (err) {
    console.error(err);
    res.status(500).send("Test failed");
  }
});

/* =====================
   START
===================== */
const startServer = async () => {
  await initDB();   // ✅ wait for DB fix FIRST

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log("✅ Running on", PORT));
};

startServer();
