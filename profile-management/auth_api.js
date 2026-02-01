const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const client = require("prom-client");

const app = express();
app.use(bodyParser.json());
app.use(cors());

const secretKey = process.env.JWT_SECRET || "secret-key";
const SERVICE = "profile-management";

// -------------------- Prometheus metrics  --------------------
const register = new client.Registry();
register.setDefaultLabels({ service: SERVICE });

client.collectDefaultMetrics({
  register,
  prefix: "profile_management_",
});

const httpRequestsTotal = new client.Counter({
  name: "profile_management_http_requests_total",
  help: "Total HTTP requests",
  labelNames: ["service", "method", "route", "status_code"],
});

const httpRequestDurationSeconds = new client.Histogram({
  name: "profile_management_http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["service", "method", "route", "status_code"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

const httpRequestsInFlight = new client.Gauge({
  name: "profile_management_http_requests_in_flight",
  help: "Number of HTTP requests currently being handled",
  labelNames: ["service"],
});

const httpResponseSizeBytes = new client.Histogram({
  name: "profile_management_http_response_size_bytes",
  help: "HTTP response size in bytes",
  labelNames: ["service", "method", "route", "status_code"],
  buckets: [200, 500, 1000, 5000, 10000, 50000, 100000, 500000, 1000000],
});

const httpExceptionsTotal = new client.Counter({
  name: "profile_management_http_exceptions_total",
  help: "Total unhandled exceptions during request processing",
  labelNames: ["service", "route"],
});

const signupsTotal = new client.Counter({
  name: "profile_management_signups_total",
  help: "Total sign-up attempts by result",
  labelNames: ["service", "result"], // success | email_exists | invalid_payload
});

const signinsTotal = new client.Counter({
  name: "profile_management_signins_total",
  help: "Total sign-in attempts by result",
  labelNames: ["service", "result"], // success | invalid_credentials | invalid_payload
});

const jwtIssuedTotal = new client.Counter({
  name: "profile_management_jwt_issued_total",
  help: "Total number of JWTs issued",
  labelNames: ["service"],
});

const authFailuresTotal = new client.Counter({
  name: "profile_management_auth_failures_total",
  help: "Total auth failures by reason",
  labelNames: ["service", "reason"], // no_token | invalid_token
});

const profileReadsTotal = new client.Counter({
  name: "profile_management_profile_reads_total",
  help: "Total protected profile reads by result",
  labelNames: ["service", "result"], // success | not_found
});

const profileUpdatesTotal = new client.Counter({
  name: "profile_management_profile_updates_total",
  help: "Total profile update attempts by result",
  labelNames: ["service", "result"], // success | not_found
});

const usersCount = new client.Gauge({
  name: "profile_management_users_count",
  help: "Current number of registered users (in-memory)",
  labelNames: ["service"],
});

// Register all metrics
[
  httpRequestsTotal,
  httpRequestDurationSeconds,
  httpRequestsInFlight,
  httpResponseSizeBytes,
  httpExceptionsTotal,
  signupsTotal,
  signinsTotal,
  jwtIssuedTotal,
  authFailuresTotal,
  profileReadsTotal,
  profileUpdatesTotal,
  usersCount,
].forEach((m) => register.registerMetric(m));

function getRouteLabel(req) {
  if (req.route && req.route.path) return req.route.path;
  return req.path || "unknown";
}

app.use((req, res, next) => {
  if (req.path === "/metrics") return next();

  httpRequestsInFlight.labels(SERVICE).inc();

  const stopTimer = httpRequestDurationSeconds.startTimer({
    service: SERVICE,
    method: req.method,
    route: "unknown",
    status_code: "0",
  });

  res.on("finish", () => {
    const route = getRouteLabel(req);
    const statusCode = String(res.statusCode);

    const labels = {
      service: SERVICE,
      method: req.method,
      route,
      status_code: statusCode,
    };

    httpRequestsTotal.labels(labels.service, labels.method, labels.route, labels.status_code).inc();

    // record duration
    stopTimer({
      service: SERVICE,
      method: req.method,
      route,
      status_code: statusCode,
    });

    const clHeader = res.getHeader("content-length");
    let size = 0;
    if (clHeader) size = Number(clHeader) || 0;

    httpResponseSizeBytes
      .labels(labels.service, labels.method, labels.route, labels.status_code)
      .observe(size);

    httpRequestsInFlight.labels(SERVICE).dec();
  });

  next();
});

app.use((err, req, res, next) => {
  const route = getRouteLabel(req);
  httpExceptionsTotal.labels(SERVICE, route).inc();
  res.status(500).json({ error: "internal_error" });
});

// Metrics endpoint
app.get("/metrics", async (req, res) => {
  try {
    res.set("Content-Type", register.contentType);
    res.end(await register.metrics());
  } catch (err) {
    res.status(500).json({ error: "metrics_error" });
  }
});

app.get("/healthz", (req, res) => {
  res.json({ status: "ok" });
});

// -------------------- In-memory storage for users --------------------
const users = [];
usersCount.labels(SERVICE).set(users.length);

const authenticateToken = (req, res, next) => {
  const token = req.headers.authorization;

  if (!token) {
    authFailuresTotal.labels(SERVICE, "no_token").inc();
    return res.status(401).json({ error: "No token provided" });
  }

  jwt.verify(token, secretKey, (err, decoded) => {
    if (err) {
      authFailuresTotal.labels(SERVICE, "invalid_token").inc();
      return res.status(401).json({ error: "Invalid token" });
    }
    req.userId = decoded.userId;
    next();
  });
};

// -------------------- API endpoints --------------------

// Sign up
app.post("/api/signup", (req, res) => {
  const { firstName, lastName, address, postalCode, email, password } = req.body || {};

  if (!email || !password) {
    signupsTotal.labels(SERVICE, "invalid_payload").inc();
    return res.status(400).json({ error: "Missing email or password" });
  }

  const existingUser = users.find((u) => u.email === email);
  if (existingUser) {
    signupsTotal.labels(SERVICE, "email_exists").inc();
    return res.status(409).json({ error: "Email already exists" });
  }

  const newUser = {
    id: users.length + 1,
    firstName: firstName || "",
    lastName: lastName || "",
    address: address || "",
    postalCode: postalCode || "",
    email,
    password,
  };

  users.push(newUser);
  usersCount.labels(SERVICE).set(users.length);
  signupsTotal.labels(SERVICE, "success").inc();

  res.status(201).json({ message: "User registered successfully" });
});

// Sign in
app.post("/api/signin", (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    signinsTotal.labels(SERVICE, "invalid_payload").inc();
    return res.status(400).json({ error: "Missing email or password" });
  }

  const user = users.find((u) => u.email === email);

  if (!user || user.password !== password) {
    signinsTotal.labels(SERVICE, "invalid_credentials").inc();
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = jwt.sign({ userId: user.id }, secretKey);
  jwtIssuedTotal.labels(SERVICE).inc();
  signinsTotal.labels(SERVICE, "success").inc();

  res.json({ message: "Login successful", token, user });
});

app.post("/api/signout", authenticateToken, (req, res) => {
  res.json({ message: "Logout successful" });
});

app.get("/api/protected", authenticateToken, (req, res) => {
  const user = users.find((u) => u.id === req.userId);
  if (!user) {
    profileReadsTotal.labels(SERVICE, "not_found").inc();
    return res.status(404).json({ error: "User not found" });
  }
  profileReadsTotal.labels(SERVICE, "success").inc();
  res.json({ message: "Protected route accessed successfully", user });
});

// Update user profile
app.put("/api/update", authenticateToken, (req, res) => {
  const { firstName, lastName, address, postalCode } = req.body || {};

  const idx = users.findIndex((u) => u.id === req.userId);
  if (idx === -1) {
    profileUpdatesTotal.labels(SERVICE, "not_found").inc();
    return res.status(404).json({ error: "User not found" });
  }

  users[idx] = {
    ...users[idx],
    firstName: firstName ?? users[idx].firstName,
    lastName: lastName ?? users[idx].lastName,
    address: address ?? users[idx].address,
    postalCode: postalCode ?? users[idx].postalCode,
  };

  profileUpdatesTotal.labels(SERVICE, "success").inc();
  res.json({ message: "User updated successfully", user: users[idx] });
});

const port = process.env.PORT || 3003;
app.listen(port, "0.0.0.0", () => console.log(`Profile Management API running on port ${port}`));
