import json
import os
import threading
import time
from typing import List, Dict

from flask import Flask, jsonify, request, Response
from flask_cors import CORS
from prometheus_client import (
    Counter,
    Gauge,
    Histogram,
    generate_latest,
    CONTENT_TYPE_LATEST,
)

app = Flask(__name__)
CORS(app)

DATA_FILE = os.environ.get("INVENTORY_DATA_FILE", "/data/inventory.json")
_lock = threading.Lock()

DEFAULT_INVENTORY: List[Dict] = [
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

def _ensure_parent_dir(path: str) -> None:
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)

def _atomic_write_json(path: str, data) -> None:
    _ensure_parent_dir(path)
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f)
    os.replace(tmp, path)

def load_inventory() -> List[Dict]:
    with _lock:
        try:
            with open(DATA_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, list) and all("id" in x and "quantity" in x for x in data):
                return data
        except FileNotFoundError:
            pass
        except Exception:
            pass

        _atomic_write_json(DATA_FILE, DEFAULT_INVENTORY)
        return list(DEFAULT_INVENTORY)

def save_inventory(data: List[Dict]) -> None:
    with _lock:
        _atomic_write_json(DATA_FILE, data)

inventory = load_inventory()


# Prometheus metrics
REQUESTS_TOTAL = Counter(
    "http_requests_total",
    "Total HTTP requests",
    ["method", "route", "status_code"],
)

REQUEST_LATENCY = Histogram(
    "http_request_duration_seconds",
    "HTTP request latency in seconds",
    ["method", "route"],
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5),
)

INVENTORY_QTY = Gauge(
    "product_inventory_quantity",
    "Current inventory quantity per product",
    ["product_id"],
)

def _update_inventory_gauges() -> None:
    for item in inventory:
        INVENTORY_QTY.labels(product_id=str(item["id"])).set(item["quantity"])

_update_inventory_gauges()

@app.before_request
def _metrics_start_timer():
    request._start_time = time.time()

@app.after_request
def _metrics_after_request(response):
    route = request.url_rule.rule if request.url_rule else request.path
    elapsed = time.time() - getattr(request, "_start_time", time.time())

    REQUESTS_TOTAL.labels(
        method=request.method,
        route=route,
        status_code=str(response.status_code),
    ).inc()

    REQUEST_LATENCY.labels(
        method=request.method,
        route=route,
    ).observe(elapsed)

    return response

@app.get("/metrics")
def metrics():
    return Response(generate_latest(), mimetype=CONTENT_TYPE_LATEST)

@app.get("/healthz")
def healthz():
    return jsonify({"status": "ok"}), 200


# API
@app.route("/api/inventory", methods=["GET"])
def get_inventory():
    return jsonify(inventory)

@app.route("/api/inventory/<int:product_id>", methods=["GET"])
def get_product_inventory(product_id):
    product = next((p for p in inventory if p["id"] == product_id), None)
    if product:
        return jsonify(product)
    return jsonify({"error": "Product not found"}), 404

@app.route("/api/order/<int:product_id>", methods=["POST"])
def order_product(product_id):
    product = next((p for p in inventory if p["id"] == product_id), None)
    if product and product["quantity"] > 0:
        product["quantity"] -= 1
        save_inventory(inventory)
        INVENTORY_QTY.labels(product_id=str(product_id)).set(product["quantity"])
        return jsonify(product)
    elif product and product["quantity"] <= 0:
        return jsonify({"error": "Product is out of stock"}), 400
    return jsonify({"error": "Product not found"}), 404

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=3002)
