const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const promClient = require('prom-client');

const app = express();
app.use(bodyParser.json());
app.use(cors());

// Metrics setup
const register = new promClient.Registry();
promClient.collectDefaultMetrics({ register });

const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.05, 0.1, 0.3, 0.5, 1, 2, 5]
});
register.registerMetric(httpRequestDuration);

app.use((req, res, next) => {
  const end = httpRequestDuration.startTimer();
  res.on('finish', () => {
    end({ method: req.method, route: req.route ? req.route.path : req.path, status_code: res.statusCode });
  });
  next();
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// In-memory storage for products
let products = [
    {
    id: 1,
    name: 'Wireless Bluetooth Headphones',
    description: 'High-quality sound and comfortable fit',
    price: 59.99,
    category: 'Electronics',
  },
  {
    id: 2,
    name: 'Vintage Leather Backpack',
    description: 'Stylish and durable backpack for everyday use',
    price: 89.99,
    category: 'Accessories',
  },
  {
    id: 3,
    name: 'Stainless Steel Water Bottle',
    description: 'Eco-friendly and leak-proof water bottle',
    price: 19.99,
    category: 'Home & Kitchen',
  },
  {
    id: 4,
    name: 'Organic Green Tea',
    description: 'A refreshing and healthy organic green tea',
    price: 15.99,
    category: 'Groceries',
  },
  {
    id: 5,
    name: 'Smartwatch Fitness Tracker',
    description: 'Track your fitness and stay connected on the go',
    price: 199.99,
    category: 'Electronics',
  },
  {
    id: 6,
    name: 'Professional Studio Microphone',
    description: 'Record high-quality audio with this studio microphone',
    price: 129.99,
    category: 'Electronics',
  },
  {
    id: 7,
    name: 'Ergonomic Office Chair',
    description: 'Stay comfortable while working with this ergonomic chair',
    price: 249.99,
    category: 'Office Supplies',
  },
  {
    id: 8,
    name: 'LED Desk Lamp',
    description: 'Brighten your workspace with this energy-efficient LED lamp',
    price: 39.99,
    category: 'Home & Kitchen',
  },
  {
    id: 9,
    name: 'Gourmet Chocolate Box',
    description: 'Indulge in a variety of gourmet chocolates',
    price: 29.99,
    category: 'Groceries',
  },
  {
    id: 10,
    name: 'Yoga Mat with Carrying Strap',
    description: 'A non-slip yoga mat perfect for all types of yoga',
    price: 49.99,
    category: 'Fitness',
  },
  {
    id: 11,
    name: 'Insulated Camping Tent',
    description: 'A durable and insulated tent for your outdoor adventures',
    price: 349.99,
    category: 'Outdoor',
  },
  {
    id: 12,
    name: 'Bluetooth Speaker',
    description: 'Portable speaker with exceptional sound quality',
    price: 99.99,
    category: 'Electronics',
  }
];
// Get all products
app.get('/api/products', (req, res) => {
  res.json(products);
});

// Get a single product by ID
app.get('/api/products/:id', (req, res) => {
  const productId = parseInt(req.params.id);
  const product = products.find((p) => p.id === productId);

  if (product) {
    res.json(product);
  } else {
    res.status(404).json({ error: 'Product not found' });
  }
});

// Start the server
const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`Product Catalog microservice is running on port ${port}`);
});