const express = require("express");
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
        location TEXT,
        answer TEXT,
        ip_address TEXT,
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
   SUBMIT FORM
===================== */
app.post("/api/submit", async (req, res) => {
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;

  try {
    await pool.query(
      `INSERT INTO responses 
       (full_name, location, answer, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        req.body.fullName,
        req.body.location,
        req.body.answer,
        ip,
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
    res.json({ responses: result.rows });
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
   START SERVER
===================== */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});