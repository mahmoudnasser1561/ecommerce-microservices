import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import client from "prom-client";

import authRoutes from "./routes/auth.js";
import productRoutes from "./routes/products.js";
import inventoryRoutes from "./routes/inventory.js";
import orderRoutes from "./routes/orders.js";
import shippingRoutes from "./routes/shipping.js";
import contactRoutes from "./routes/contact.js";

const app = express();

// -------------------- Middlewares --------------------
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// -------------------- Prometheus metrics --------------------
const register = new client.Registry();
register.setDefaultLabels({ service: "ecommerce-ui" });

client.collectDefaultMetrics({
  register,
  prefix: "ecommerce_ui_",
});

// RPS + error rate
const httpRequestsTotal = new client.Counter({
  name: "ecommerce_ui_http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status_code"],
});
register.registerMetric(httpRequestsTotal);

// Latency 
const httpRequestDurationSeconds = new client.Histogram({
  name: "ecommerce_ui_http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});
register.registerMetric(httpRequestDurationSeconds);

// Concurrency
const httpRequestsInFlight = new client.Gauge({
  name: "ecommerce_ui_http_requests_in_flight",
  help: "Number of HTTP requests currently being handled",
});
register.registerMetric(httpRequestsInFlight);

// response size
const httpResponseSizeBytes = new client.Histogram({
  name: "ecommerce_ui_http_response_size_bytes",
  help: "HTTP response size in bytes",
  labelNames: ["method", "route", "status_code"],
  buckets: [200, 500, 1000, 5000, 10000, 50000, 100000, 500000, 1000000],
});
register.registerMetric(httpResponseSizeBytes);

// record metrics 
app.use((req, res, next) => {
  if (req.path === "/metrics") return next();

  httpRequestsInFlight.inc();

  // capture response bytes
  let responseBytes = 0;
  const originalWrite = res.write.bind(res);
  const originalEnd = res.end.bind(res);

  res.write = (chunk, encoding, cb) => {
    if (chunk) {
      responseBytes += Buffer.isBuffer(chunk)
        ? chunk.length
        : Buffer.byteLength(chunk, encoding);
    }
    return originalWrite(chunk, encoding, cb);
  };

  res.end = (chunk, encoding, cb) => {
    if (chunk) {
      responseBytes += Buffer.isBuffer(chunk)
        ? chunk.length
        : Buffer.byteLength(chunk, encoding);
    }
    return originalEnd(chunk, encoding, cb);
  };

  const stopTimer = httpRequestDurationSeconds.startTimer({
    method: req.method,
    route: "unknown",
    status_code: "0",
  });

  res.on("finish", () => {
    const route =
      (req.route && req.route.path) ||
      (req.baseUrl ? `${req.baseUrl}${req.path}` : req.path) ||
      "unknown";

    const labels = {
      method: req.method,
      route,
      status_code: String(res.statusCode),
    };

    httpRequestsTotal.inc(labels);
    httpResponseSizeBytes.observe(labels, responseBytes);
    stopTimer(labels);
    httpRequestsInFlight.dec();
  });

  res.on("close", () => {
    try {
      httpRequestsInFlight.dec();
    } catch (_) {}
  });

  next();
});

app.get("/metrics", async (req, res) => {
  try {
    res.set("Content-Type", register.contentType);
    res.end(await register.metrics());
  } catch (err) {
    res.status(500).send("Could not generate metrics");
  }
});
// ------------------------------------------------------------

// Get the directory name of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve the static files from the React app build
app.use(express.static(path.join(__dirname, "../client/build")));

// -------------------- API routes --------------------
app.use("/api", authRoutes);
app.use("/api", productRoutes);
app.use("/api", inventoryRoutes);
app.use("/api", orderRoutes);
app.use("/api", shippingRoutes);
app.use("/api", contactRoutes);

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// Handle requests for the root URL
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../client/build", "index.html"));
});

// Catch-all: send back React's index.html for SPA routes
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../client/build", "index.html"));
});

// Start server
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`ecommerce-ui server running on port ${PORT}`);
});
