import json
import os
import threading
import time

from flask import Flask, jsonify, request, Response
from flask_cors import CORS
from prometheus_client import (
    Counter,
    Histogram,
    Gauge,
    generate_latest,
    CONTENT_TYPE_LATEST,
)

app = Flask(__name__)
CORS(app)

# -------------------- Persistence --------------------
DATA_FILE = os.environ.get("INVENTORY_DATA_FILE", "/data/inventory.json")
_lock = threading.Lock()

DEFAULT_INVENTORY = [
    {"id": 1, "quantity": 100},
    {"id": 2, "quantity": 50},
    {"id": 3, "quantity": 75},
    {"id": 4, "quantity": 120},
    {"id": 5, "quantity": 30},
    {"id": 6, "quantity": 60},
    {"id": 7, "quantity": 40},
    {"id": 8, "quantity": 90},
    {"id": 9, "quantity": 80},
    {"id": 10, "quantity": 70},
    {"id": 11, "quantity": 20},
    {"id": 12, "quantity": 55},
]


def _ensure_dir(path: str) -> None:
    d = os.path.dirname(path)
    if d:
        os.makedirs(d, exist_ok=True)


def _atomic_write(path: str, data) -> None:
    _ensure_dir(path)
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f)
    os.replace(tmp, path)


def load_inventory():
    with _lock:
        try:
            with open(DATA_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, list):
                return data
        except FileNotFoundError:
            pass
        except Exception:
            pass

        _atomic_write(DATA_FILE, DEFAULT_INVENTORY)
        return list(DEFAULT_INVENTORY)


def save_inventory(data):
    with _lock:
        _atomic_write(DATA_FILE, data)


inventory = load_inventory()

# -------------------- Prometheus metrics --------------------
SERVICE = "product-inventory"
LOW_STOCK_THRESHOLD = int(os.environ.get("LOW_STOCK_THRESHOLD", "10"))

# HTTP (RED + saturation + throughput)
HTTP_REQUESTS_TOTAL = Counter(
    "product_inventory_http_requests_total",
    "Total number of HTTP requests",
    ["service", "method", "route", "status_code"],
)

HTTP_REQUEST_DURATION_SECONDS = Histogram(
    "product_inventory_http_request_duration_seconds",
    "HTTP request duration in seconds",
    ["service", "method", "route", "status_code"],
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10),
)

HTTP_REQUESTS_IN_FLIGHT = Gauge(
    "product_inventory_http_requests_in_flight",
    "Number of HTTP requests currently being handled",
    ["service"],
)

HTTP_RESPONSE_SIZE_BYTES = Histogram(
    "product_inventory_http_response_size_bytes",
    "HTTP response size in bytes",
    ["service", "method", "route", "status_code"],
    buckets=(200, 500, 1000, 5000, 10000, 50000, 100000, 500000, 1000000),
)

HTTP_EXCEPTIONS_TOTAL = Counter(
    "product_inventory_http_exceptions_total",
    "Total unhandled exceptions during request processing",
    ["service", "route"],
)

# Business metrics
INVENTORY_QTY = Gauge(
    "product_inventory_quantity",
    "Current inventory quantity per product",
    ["service", "product_id"],
)

ORDERS_TOTAL = Counter(
    "product_inventory_orders_total",
    "Total order attempts by result",
    ["service", "product_id", "result"], 
)

STOCK_DECREMENTS_TOTAL = Counter(
    "product_inventory_stock_decrements_total",
    "Total number of times stock was decremented",
    ["service", "product_id"],
)

# Aggregate health gauges
INVENTORY_TOTAL_ITEMS = Gauge(
    "product_inventory_total_items",
    "Total number of products in inventory",
    ["service"],
)

INVENTORY_TOTAL_QUANTITY = Gauge(
    "product_inventory_total_quantity",
    "Total quantity across all products",
    ["service"],
)

INVENTORY_OUT_OF_STOCK_ITEMS = Gauge(
    "product_inventory_out_of_stock_items",
    "Number of products with quantity == 0",
    ["service"],
)

INVENTORY_LOW_STOCK_ITEMS = Gauge(
    "product_inventory_low_stock_items",
    f"Number of products with quantity <= LOW_STOCK_THRESHOLD ({LOW_STOCK_THRESHOLD})",
    ["service"],
)


def _update_aggregate_gauges():
    total_items = len(inventory)
    total_qty = sum(int(p.get("quantity", 0)) for p in inventory)
    out_of_stock = sum(1 for p in inventory if int(p.get("quantity", 0)) == 0)
    low_stock = sum(1 for p in inventory if int(p.get("quantity", 0)) <= LOW_STOCK_THRESHOLD)

    INVENTORY_TOTAL_ITEMS.labels(service=SERVICE).set(total_items)
    INVENTORY_TOTAL_QUANTITY.labels(service=SERVICE).set(total_qty)
    INVENTORY_OUT_OF_STOCK_ITEMS.labels(service=SERVICE).set(out_of_stock)
    INVENTORY_LOW_STOCK_ITEMS.labels(service=SERVICE).set(low_stock)


def refresh_gauges():
    for item in inventory:
        INVENTORY_QTY.labels(service=SERVICE, product_id=str(item["id"])).set(item["quantity"])
    _update_aggregate_gauges()


refresh_gauges()

# -------------------- Request instrumentation --------------------
@app.before_request
def _before():
    request._start_time = time.time()
    request._inflight_inc = False

    # Skip /metrics to reduce noise
    if request.path == "/metrics":
        return

    HTTP_REQUESTS_IN_FLIGHT.labels(service=SERVICE).inc()
    request._inflight_inc = True


@app.after_request
def _after(response):
    # Skip /metrics to reduce noise
    if request.path == "/metrics":
        return response

    route = request.url_rule.rule if request.url_rule else request.path
    elapsed = time.time() - getattr(request, "_start_time", time.time())

    status_code = str(getattr(response, "status_code", 500))

    labels = dict(
        service=SERVICE,
        method=request.method,
        route=route,
        status_code=status_code,
    )

    HTTP_REQUESTS_TOTAL.labels(**labels).inc()
    HTTP_REQUEST_DURATION_SECONDS.labels(**labels).observe(elapsed)

    # Response size
    size = 0
    try:
        cl = response.calculate_content_length()
        if cl is not None:
            size = int(cl)
        else:
            if not getattr(response, "direct_passthrough", False):
                data = response.get_data()
                if data is not None:
                    size = len(data)
    except Exception:
        size = 0

    HTTP_RESPONSE_SIZE_BYTES.labels(**labels).observe(float(size))

    if getattr(request, "_inflight_inc", False):
        HTTP_REQUESTS_IN_FLIGHT.labels(service=SERVICE).dec()
        request._inflight_inc = False

    return response


@app.teardown_request
def _teardown(exc):
    # If an exception occurred and after_request didn’t run properly,
    # ensure in-flight is decremented and count exceptions.
    if request.path != "/metrics":
        if exc is not None:
            route = request.url_rule.rule if request.url_rule else request.path
            HTTP_EXCEPTIONS_TOTAL.labels(service=SERVICE, route=route).inc()

        if getattr(request, "_inflight_inc", False):
            HTTP_REQUESTS_IN_FLIGHT.labels(service=SERVICE).dec()
            request._inflight_inc = False


# -------------------- Endpoints --------------------
@app.get("/metrics")
def metrics():
    return Response(generate_latest(), mimetype=CONTENT_TYPE_LATEST)


@app.get("/healthz")
def healthz():
    return jsonify({"status": "ok"}), 200


@app.route("/api/inventory", methods=["GET"])
def get_inventory():
    return jsonify(inventory)


@app.route("/api/inventory/<int:product_id>", methods=["GET"])
def get_product_inventory(product_id):
    product = next((p for p in inventory if p["id"] == product_id), None)
    if product:
        return jsonify(product)

    ORDERS_TOTAL.labels(service=SERVICE, product_id=str(product_id), result="not_found").inc()
    return jsonify({"error": "Product not found"}), 404


@app.route("/api/order/<int:product_id>", methods=["POST"])
def order_product(product_id):
    product = next((p for p in inventory if p["id"] == product_id), None)

    if product and int(product["quantity"]) > 0:
        product["quantity"] -= 1
        save_inventory(inventory)

        INVENTORY_QTY.labels(service=SERVICE, product_id=str(product_id)).set(product["quantity"])
        _update_aggregate_gauges()

        ORDERS_TOTAL.labels(service=SERVICE, product_id=str(product_id), result="success").inc()
        STOCK_DECREMENTS_TOTAL.labels(service=SERVICE, product_id=str(product_id)).inc()

        return jsonify(product)

    if product and int(product["quantity"]) <= 0:
        ORDERS_TOTAL.labels(service=SERVICE, product_id=str(product_id), result="out_of_stock").inc()
        return jsonify({"error": "Product is out of stock"}), 400

    ORDERS_TOTAL.labels(service=SERVICE, product_id=str(product_id), result="not_found").inc()
    return jsonify({"error": "Product not found"}), 404


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=3002)
