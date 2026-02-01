const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const client = require("prom-client");

const app = express();
app.use(bodyParser.json());
app.use(cors());

// -------------------- Prometheus metrics --------------------
const register = new client.Registry();
register.setDefaultLabels({ service: "product-catalog" });

client.collectDefaultMetrics({
  register,
  prefix: "product_catalog_",
});

// RED metrics (Rate, Errors, Duration)
const httpRequestsTotal = new client.Counter({
  name: "product_catalog_http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status_code"],
});
register.registerMetric(httpRequestsTotal);

const httpRequestDurationSeconds = new client.Histogram({
  name: "product_catalog_http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});
register.registerMetric(httpRequestDurationSeconds);

// Saturation / concurrency
const httpRequestsInFlight = new client.Gauge({
  name: "product_catalog_http_requests_in_flight",
  help: "Number of HTTP requests currently being handled",
});
register.registerMetric(httpRequestsInFlight);

// Throughput 
const httpResponseSizeBytes = new client.Histogram({
  name: "product_catalog_http_response_size_bytes",
  help: "HTTP response size in bytes",
  labelNames: ["method", "route", "status_code"],
  buckets: [200, 500, 1000, 5000, 10000, 50000, 100000, 500000, 1000000],
});
register.registerMetric(httpResponseSizeBytes);

// Business metrics 
const productsServedTotal = new client.Counter({
  name: "product_catalog_products_served_total",
  help: "Total number of product items served",
  labelNames: ["endpoint"],
});
register.registerMetric(productsServedTotal);

const productNotFoundTotal = new client.Counter({
  name: "product_catalog_product_not_found_total",
  help: "Number of times a product lookup returned 404",
});
register.registerMetric(productNotFoundTotal);

// Middleware: capture duration + count + in-flight + response size
app.use((req, res, next) => {
  if (req.path === "/metrics") return next();

  httpRequestsInFlight.inc();

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
    // client disconnected early
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
    res.status(500).json({ error: "metrics_error" });
  }
});

app.get("/healthz", (req, res) => {
  res.json({ status: "ok" });
});
// ------------------------------------------------------------

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

app.get("/api/products", (req, res) => {
  productsServedTotal.inc({ endpoint: "/api/products" }, products.length);
  res.json(products);
});

app.get("/api/products/:id", (req, res) => {
  const productId = parseInt(req.params.id, 10);
  const product = products.find((p) => p.id === productId);

  if (!product) {
    productNotFoundTotal.inc();
    return res.status(404).json({ error: "Product not found" });
  }

  productsServedTotal.inc({ endpoint: "/api/products/:id" }, 1);
  res.json(product);
});

const port = process.env.PORT || 3001;
app.listen(port, "0.0.0.0", () => {
  console.log(`Product Catalog microservice is running on port ${port}`);
});
