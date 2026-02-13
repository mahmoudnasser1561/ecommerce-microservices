# Ecommerce Microservices Observability Platform

End-to-end portfolio project showing how I design, containerize, orchestrate, and observe a multi-service ecommerce system.

## Why This Project
I built this project as a practical way to work through a full microservices setup end to end.
The focus was to:
- containerize each service
- connect everything through Docker Compose
- add Prometheus metrics to each service
- build Grafana dashboards that are useful for both business and system monitoring

## Impact
- Built 14 Grafana dashboards across 4 service areas.
- Added 20+ business and operational metrics (conversion, auth quality, stock risk, fulfillment outcomes, latency, and errors).
- Ran 7 application services with Prometheus and Grafana in one Docker Compose setup.
- Expanded visibility from basic health checks to marketing, business, and system-level monitoring.

## Architecture
### Runtime Stack
- `ecommerce-ui` (React)
- `profile-management` (Node.js/Express)
- `product-catalog`
- `product-inventory` (Python/Flask)
- `shipping-and-handling` (Go)
- `contact-support-team` (Python/Flask)
- `order-management`
- `prometheus`
- `grafana`

### Service Ports
| Service | Port |
|---|---:|
| `ecommerce-ui` | `4000` |
| `profile-management` | `3003` |
| `product-catalog` | `3001` |
| `product-inventory` | `3002` |
| `shipping-and-handling` | `8080` |
| `contact-support-team` | `8000` |
| `order-management` | `9092 -> 9090` |
| `prometheus` | `9091 -> 9090` |
| `grafana` | `3000` |

## Observability Implementation
- Prometheus scrape config: `observability/prometheus/prometheus.yml`
- Dashboard JSON definitions:
  - `observability/grafana/dashboards/profile_management/`
  - `observability/grafana/dashboards/product_inventory/`
  - `observability/grafana/dashboards/shipping_and_handling/`
  - `observability/grafana/dashboards/contact_support_team/`

Dashboards are built to cover three layers:
- **Marketing**: user demand, intent, and funnel conversion signals
- **Business**: domain KPIs and outcome quality
- **System**: latency, error rates, throughput, saturation, and runtime health

## Dashboard Evidence

### Contact Support Team
![Contact Support Business Funnel](screenshots/contact-support-team/business_conversion_funnel.png)
![Contact Support Experience Capacity](screenshots/contact-support-team/business_experience_capacity.png)

### Shipping and Handling
![Shipping Business Value](screenshots/shipping_and_handling/business_shipping_value.png)
![Shipping Marketing Engagement](screenshots/shipping_and_handling/marketing_enagegement.png)
![Shipping System Performance](screenshots/shipping_and_handling/system_performance.png)

### Product Inventory
![Product Inventory Marketing Demand and Intent](screenshots/product-inventory/Product%20Inventory%20Marketing%20Demand%20%26%20Intent%20-%20Dashboards%20-%20Grafana.png)
![Product Inventory Business Order Outcomes](screenshots/product-inventory/2Product-Inventory-Business-Order-Outcomes%20-%20Dashboards%20-%20Grafana.png)
![Product Inventory Stock Health](screenshots/product-inventory/Product%20Inventory%20Stock%20Health%20-%20Dashboards%20-%20Grafana.png)
![Product Inventory System Performance](screenshots/product-inventory/Product-Inventory-System-Performance%20-%20Dashboards%20-%20Grafana.png)

### Profile Management
![Profile Management Marketing Acquisition](screenshots/profile_management/Profile_Management_Marketing_Acquisition%20-%20Dashboards%20-%20Grafana.png)
![Profile Management Business Account Health](screenshots/profile_management/Profile_Management_Business_Account%20Health%20-%20Dashboards%20-%20Grafana.png)
![Profile Management Auth Security Quality](screenshots/profile_management/Profile_Management_Auth_Security_Quality%20-%20Dashboards%20-%20Grafana.png)
![Profile Management API Customer Experience](screenshots/profile_management/Profile_Management_API_Customer_Experience-Dashboards%20-%20Grafana.png)
![Profile Management System Reliability](screenshots/profile_management/Profile_Management_System_Reliability%20-%20Dashboards%20-%20Grafana.png)

## Run Locally
```bash
docker compose up -d
```

Open:
- UI: `http://localhost:4000`
- Grafana: `http://localhost:3000`
- Prometheus: `http://localhost:9091`

## Skills Demonstrated
- Distributed system thinking in a local microservices setup
- Dashboard design for technical and business stakeholders
- Containerized deployment workflows and operational troubleshooting
