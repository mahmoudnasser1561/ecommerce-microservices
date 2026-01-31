import time
from flask import Flask, jsonify, request, Response
from flask_cors import CORS
from prometheus_client import (
    Counter,
    Histogram,
    generate_latest,
    CONTENT_TYPE_LATEST,
)

app = Flask(__name__)
CORS(app)

# ---- Prometheus metrics ----
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

@app.before_request
def _start_timer():
    request._start_time = time.time()

@app.after_request
def _record_metrics(response):
    route = request.path
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
# ----------------------------

@app.route('/api/contact-message', methods=['GET'])
def get_contact_message():
    response = {
        'message': "We're here to help! If you have any questions, concerns, or feedback, please don't hesitate to reach out to us. Our dedicated support team is ready to assist you."
    }
    return jsonify(response)

@app.route('/api/contact-submit', methods=['POST'])
def submit_contact_form():
    post_data = request.get_json()
    print("Received submission:", post_data)
    response = {'status': 'success', 'message': 'Your message has been successfully submitted.'}
    return jsonify(response)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8000)