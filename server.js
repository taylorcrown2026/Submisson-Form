const express = require("express");
const session = require("express-session");

const app = express();

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

let responses = [];

/* =====================
   SUBMIT FORM
===================== */
app.post("/api/submit", (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  responses.push({
    fullName: req.body.fullName,
    location: req.body.location,
    answer: req.body.answer,
    ipAddress: ip,
    timestamp: new Date().toISOString(),
    userAgent: req.headers["user-agent"]
  });

  res.json({ success: true });
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
app.get("/api/admin/responses", (req, res) => {
  if (!req.session.auth) {
    return res.sendStatus(401);
  }

  res.json({ responses });
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