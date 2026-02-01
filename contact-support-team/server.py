import os
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

# -------------------- Prometheus metrics --------------------
SERVICE_NAME = "contact-support-team"

SERVICE_INFO = Gauge(
    "app_service_info",
    "Service identity info",
    ["service", "version"],
)
SERVICE_INFO.labels(
    service=SERVICE_NAME,
    version=os.getenv("APP_VERSION", "dev"),
).set(1)

# Golden metrics: Rate + Errors + Duration
REQUESTS_TOTAL = Counter(
    "http_requests_total",
    "Total HTTP requests",
    ["service", "method", "route", "status_code"],
)

ERRORS_TOTAL = Counter(
    "http_requests_errors_total",
    "Total HTTP error responses (4xx/5xx)",
    ["service", "method", "route", "status_code"],
)

REQUEST_LATENCY = Histogram(
    "http_request_duration_seconds",
    "HTTP request latency in seconds",
    ["service", "method", "route"],
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5),
)

# Saturation signal: concurrent in-flight requests
IN_FLIGHT = Gauge(
    "http_in_flight_requests",
    "Number of in-flight HTTP requests",
    ["service", "route"],
)

# Payload size distributions (best-effort using Content-Length)
REQUEST_SIZE_BYTES = Histogram(
    "http_request_size_bytes",
    "HTTP request size in bytes (Content-Length)",
    ["service", "method", "route"],
    buckets=(0, 100, 300, 1_000, 5_000, 10_000, 50_000, 200_000, 1_000_000),
)

RESPONSE_SIZE_BYTES = Histogram(
    "http_response_size_bytes",
    "HTTP response size in bytes (Content-Length)",
    ["service", "method", "route", "status_code"],
    buckets=(0, 100, 300, 1_000, 5_000, 10_000, 50_000, 200_000, 1_000_000),
)

# Simple SLO-style counters (fast request counts)
FAST_REQUESTS_TOTAL = Counter(
    "http_fast_requests_total",
    "Requests completed under a latency threshold",
    ["service", "route", "le_ms"],  # le_ms: "50", "200"
)

# Business metrics
CONTACT_MESSAGE_TOTAL = Counter(
    "contact_message_requests_total",
    "Requests to get the contact message",
    ["service"],
)

CONTACT_SUBMISSIONS_TOTAL = Counter(
    "contact_submissions_total",
    "Total contact form submissions by result",
    ["service", "result"],  
)

CONTACT_SUBMISSION_FIELDS = Histogram(
    "contact_submission_fields_count",
    "Number of fields in contact submission payload",
    ["service"],
    buckets=(0, 1, 2, 3, 5, 8, 13, 21),
)

CONTACT_SUBMISSION_PROCESSING_SECONDS = Histogram(
    "contact_submission_processing_seconds",
    "Time spent processing a contact submission",
    ["service"],
    buckets=(0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1),
)

APP_PROCESS_RSS_BYTES = Gauge(
    "app_process_rss_bytes",
    "Resident memory size in bytes (best effort; custom name)",
    ["service"],
)


def _label_route() -> str:
    return request.path


@app.before_request
def _start_timer():
    request._start_time = time.time()
    request._route = _label_route()

    # in-flight
    IN_FLIGHT.labels(service=SERVICE_NAME, route=request._route).inc()

    # request size (if known)
    cl = request.headers.get("Content-Length")
    if cl and cl.isdigit():
        REQUEST_SIZE_BYTES.labels(
            service=SERVICE_NAME, method=request.method, route=request._route
        ).observe(int(cl))

    try:
        # Linux: ru_maxrss is typically KB
        import resource  # local import to avoid edge cases

        rss_kb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        APP_PROCESS_RSS_BYTES.labels(service=SERVICE_NAME).set(rss_kb * 1024)
    except Exception:
        pass


@app.after_request
def _record_metrics(response):
    route = getattr(request, "_route", request.path)
    start = getattr(request, "_start_time", time.time())
    elapsed = time.time() - start
    status_code = str(response.status_code)

    # total requests
    REQUESTS_TOTAL.labels(
        service=SERVICE_NAME,
        method=request.method,
        route=route,
        status_code=status_code,
    ).inc()

    # latency
    REQUEST_LATENCY.labels(
        service=SERVICE_NAME,
        method=request.method,
        route=route,
    ).observe(elapsed)

    # errors
    if response.status_code >= 400:
        ERRORS_TOTAL.labels(
            service=SERVICE_NAME,
            method=request.method,
            route=route,
            status_code=status_code,
        ).inc()

    resp_len = response.headers.get("Content-Length")
    if resp_len and resp_len.isdigit():
        RESPONSE_SIZE_BYTES.labels(
            service=SERVICE_NAME,
            method=request.method,
            route=route,
            status_code=status_code,
        ).observe(int(resp_len))

    ms = elapsed * 1000.0
    if ms <= 50:
        FAST_REQUESTS_TOTAL.labels(service=SERVICE_NAME, route=route, le_ms="50").inc()
    if ms <= 200:
        FAST_REQUESTS_TOTAL.labels(service=SERVICE_NAME, route=route, le_ms="200").inc()

    try:
        IN_FLIGHT.labels(service=SERVICE_NAME, route=route).dec()
    except Exception:
        pass

    return response


@app.get("/metrics")
def metrics():
    return Response(generate_latest(), mimetype=CONTENT_TYPE_LATEST)


@app.get("/healthz")
def healthz():
    return jsonify({"status": "ok"}), 200


@app.route("/api/contact-message", methods=["GET"])
def get_contact_message():
    CONTACT_MESSAGE_TOTAL.labels(service=SERVICE_NAME).inc()
    response = {
        "message": (
            "We're here to help! If you have any questions, concerns, or feedback, "
            "please don't hesitate to reach out to us. Our dedicated support team "
            "is ready to assist you."
        )
    }
    return jsonify(response)


@app.route("/api/contact-submit", methods=["POST"])
def submit_contact_form():
    with CONTACT_SUBMISSION_PROCESSING_SECONDS.labels(service=SERVICE_NAME).time():
        post_data = request.get_json(silent=True)

        if not isinstance(post_data, dict):
            CONTACT_SUBMISSIONS_TOTAL.labels(
                service=SERVICE_NAME, result="invalid_json"
            ).inc()
            return jsonify({"status": "error", "message": "Invalid JSON"}), 400

        CONTACT_SUBMISSIONS_TOTAL.labels(service=SERVICE_NAME, result="success").inc()
        CONTACT_SUBMISSION_FIELDS.labels(service=SERVICE_NAME).observe(len(post_data.keys()))

        print("Received submission:", post_data)
        return jsonify(
            {
                "status": "success",
                "message": "Your message has been successfully submitted.",
            }
        )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=False, use_reloader=False)
