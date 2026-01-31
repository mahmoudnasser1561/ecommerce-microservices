const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const client = require("prom-client");

const app = express();
app.use(bodyParser.json());
app.use(cors());

const register = new client.Registry();

client.collectDefaultMetrics({ register });

const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status_code"],
});
register.registerMetric(httpRequestsTotal);

const httpRequestDurationSeconds = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});
register.registerMetric(httpRequestDurationSeconds);

app.use((req, res, next) => {
  const start = process.hrtime();

  res.on("finish", () => {
    const diff = process.hrtime(start);
    const durationSec = diff[0] + diff[1] / 1e9;

    const route =
      (req.route && req.route.path) ||
      (req.baseUrl ? req.baseUrl : "") ||
      req.path ||
      "unknown";

    const labels = {
      method: req.method,
      route,
      status_code: String(res.statusCode),
    };

    httpRequestsTotal.inc(labels);
    httpRequestDurationSeconds.observe(labels, durationSec);
  });

  next();
});

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

let products = [
  { id: 1, name: "Wireless Bluetooth Headphones", description: "High-quality sound and comfortable fit", price: 59.99, category: "Electronics" },
  { id: 2, name: "Vintage Leather Backpack", description: "Stylish and durable backpack for everyday use", price: 89.99, category: "Accessories" },
  { id: 3, name: "Stainless Steel Water Bottle", description: "Eco-friendly and leak-proof water bottle", price: 19.99, category: "Home & Kitchen" },
  { id: 4, name: "Organic Green Tea", description: "A refreshing and healthy organic green tea", price: 15.99, category: "Groceries" },
  { id: 5, name: "Smartwatch Fitness Tracker", description: "Track your fitness and stay connected on the go", price: 199.99, category: "Electronics" },
  { id: 6, name: "Professional Studio Microphone", description: "Record high-quality audio with this studio microphone", price: 129.99, category: "Electronics" },
  { id: 7, name: "Ergonomic Office Chair", description: "Stay comfortable while working with this ergonomic chair", price: 249.99, category: "Office Supplies" },
  { id: 8, name: "LED Desk Lamp", description: "Brighten your workspace with this energy-efficient LED lamp", price: 39.99, category: "Home & Kitchen" },
  { id: 9, name: "Gourmet Chocolate Box", description: "Indulge in a variety of gourmet chocolates", price: 29.99, category: "Groceries" },
  { id: 10, name: "Yoga Mat with Carrying Strap", description: "A non-slip yoga mat perfect for all types of yoga", price: 49.99, category: "Fitness" },
  { id: 11, name: "Insulated Camping Tent", description: "A durable and insulated tent for your outdoor adventures", price: 349.99, category: "Outdoor" },
  { id: 12, name: "Bluetooth Speaker", description: "Portable speaker with exceptional sound quality", price: 99.99, category: "Electronics" },
];

app.get("/api/products", (req, res) => res.json(products));

app.get("/api/products/:id", (req, res) => {
  const productId = parseInt(req.params.id, 10);
  const product = products.find((p) => p.id === productId);
  if (!product) return res.status(404).json({ error: "Product not found" });
  res.json(product);
});

const port = process.env.PORT || 3001;
app.listen(port, "0.0.0.0", () => {
  console.log(`Product Catalog microservice is running on port ${port}`);
});
