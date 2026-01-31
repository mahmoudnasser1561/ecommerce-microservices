const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const client = require("prom-client");

const app = express();
app.use(bodyParser.json());
app.use(cors());

const secretKey = "secret-key";

// -------------------- Prometheus metrics --------------------
client.collectDefaultMetrics();

const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total HTTP requests",
  labelNames: ["method", "route", "status_code"],
});

const httpRequestDurationSeconds = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
});

function getRouteLabel(req) {
  if (req.route && req.route.path) return req.route.path; 
  return req.path || "unknown";
}

app.use((req, res, next) => {
  const end = httpRequestDurationSeconds.startTimer();

  res.on("finish", () => {
    const route = getRouteLabel(req);
    const labels = {
      method: req.method,
      route,
      status_code: String(res.statusCode),
    };

    httpRequestsTotal.inc(labels);
    end(labels);
  });

  next();
});

app.get("/metrics", async (req, res) => {
  try {
    res.set("Content-Type", client.register.contentType);
    res.end(await client.register.metrics());
  } catch (err) {
    res.status(500).json({ error: "metrics_error" });
  }
});

app.get("/healthz", (req, res) => {
  res.json({ status: "ok" });
});

// In-memory storage for users
const users = [];

const authenticateToken = (req, res, next) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "No token provided" });

  jwt.verify(token, secretKey, (err, decoded) => {
    if (err) return res.status(401).json({ error: "Invalid token" });
    req.userId = decoded.userId;
    next();
  });
};

// Sign up
app.post("/api/signup", (req, res) => {
  const { firstName, lastName, address, postalCode, email, password } = req.body;

  const existingUser = users.find((user) => user.email === email);
  if (existingUser) return res.status(409).json({ error: "Email already exists" });

  const newUser = {
    id: users.length + 1,
    firstName,
    lastName,
    address,
    postalCode,
    email,
    password,
  };

  users.push(newUser);
  res.status(201).json({ message: "User registered successfully" });
});

// Sign in
app.post("/api/signin", (req, res) => {
  const { email, password } = req.body;
  const user = users.find((user) => user.email === email);

  if (!user || user.password !== password) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = jwt.sign({ userId: user.id }, secretKey);
  res.json({ message: "Login successful", token, user });
});

// Sign out
app.post("/api/signout", authenticateToken, (req, res) => {
  res.json({ message: "Logout successful" });
});

// Protected route example
app.get("/api/protected", authenticateToken, (req, res) => {
  const user = users.find((user) => user.id === req.userId);
  res.json({ message: "Protected route accessed successfully", user });
});

// Update user
app.put("/api/update", authenticateToken, (req, res) => {
  const { firstName, lastName, address, postalCode } = req.body;

  const userIndex = users.findIndex((user) => user.id === req.userId);
  if (userIndex === -1) return res.status(404).json({ error: "User not found" });

  users[userIndex] = {
    ...users[userIndex],
    firstName: firstName || users[userIndex].firstName,
    lastName: lastName || users[userIndex].lastName,
    address: address || users[userIndex].address,
    postalCode: postalCode || users[userIndex].postalCode,
  };

  res.json({ message: "User updated successfully", user: users[userIndex] });
});

const port = process.env.PORT || 3003;
app.listen(port, () => console.log(`Authentication API is running on port ${port}`));
