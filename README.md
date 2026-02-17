# M4 Max Training Monitor & Metrics Server

A high-performance metrics bridge and real-time dashboard for macOS (specifically optimized for Apple Silicon M4 Max). It provides insights into GPU residency, power consumption, memory pressure, and die temperatures which are often difficult to access on newer hardware.

## Features

- **GPU Performance**: Real-time frequency (MHz), active residency (%), idle residency (%), and power consumption (mW/W).
- **Memory Stats**: System memory pressure levels and swap usage (GB).
- **Advanced Thermals**:
    - Thermal pressure monitoring (Nominal, Moderate, Heavy, Critical).
    - Speed limits for both CPU and GPU (throttling detection).
    - **M4 Max Temperature Support**: Custom Swift-based sensor integration for PMU die temperatures (`tdie1-10`) that are missing from standard `powermetrics` on M4 models.
- **Web Dashboard**: A sleek, dark-mode single-page HTML dashboard for monitoring metrics at a glance.
- **JSON API**: Clean `/metrics` and `/raw` endpoints for easy integration with other tools.

## Project Structure

- `metrics-server.ts`: A Bun-based server that orchestrates system commands (`powermetrics`, `memory_pressure`, `pmset`) and provides the API.
- `M4Temp.swift`: A specialized Swift tool that uses `IOHIDEventSystem` to retrieve raw temperature data from M4 PMU sensors.
- `m4max-monitor.html`: The frontend dashboard served by the metrics server.

## Prerequisites

- **Bun**: This project uses [Bun](https://bun.sh/) as the runtime for the metrics server.
- **macOS (Apple Silicon)**: Optimized for M4 Max, but compatible with other Apple Silicon models (temperature sensors may fall back to `powermetrics smc` on older models).
- **Swift**: Required to compile/run the temperature sensor tool.

## Usage

### 1. Run the Server

Because `powermetrics` and HID sensor access require elevated permissions, the server must be run with `sudo`:

```bash
sudo bun run metrics-server.ts
```

### 2. Access the Dashboard

Once the server is running, open your browser to:
[http://localhost:8787/](http://localhost:8787/)

### 3. API Endpoints

- `GET /metrics`: Returns a structured JSON object with all current metrics.
- `GET /raw`: Returns the raw string output from all underlying system commands for debugging.
- `GET /health`: Simple health check endpoint.

## Configuration

The server respects the following environment variables:
- `PORT`: The port to listen on (default: `8787`).
- `HOST`: The host to bind to (default: `127.0.0.1`).

Example:
```bash
PORT=9000 sudo bun run metrics-server.ts
```

## Troubleshooting

- **"GPU stats missing" or "Temperature sensors missing"**: Ensure you are running the server with `sudo`.
- **M4 Max Temperatures**: On M4 Max (macOS 15+), the `smc` sampler in `powermetrics` is often unsupported. This project automatically switches to using the `M4Temp.swift` tool to provide these metrics.
- **Dashboard not loading**: Ensure `m4max-monitor.html` is in the same directory as `metrics-server.ts`.

## License
MIT
