#!/usr/bin/env bun

/**
 * metserve CLI
 *
 * Copyright (C) 2026 github.com/geoffsee
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * Runs the local Bun metrics server (metserve.ts) and serves the dashboard.
 *
 * Usage:
 *   metserve
 *   metserve --port 8787 --host 127.0.0.1
 *   PORT=9000 HOST=0.0.0.0 metserve
 *
 * Notes:
 * - For best results (powermetrics + HID temps), run with sudo:
 *     sudo metserve
 */

function printHelp() {
    console.log(`
metserve

Run a Monitor & Metrics Server.

Options:
  -p, --port <n>     Port to listen on (default: 8787 or $PORT)
  -h, --host <addr>  Hostname to bind (default: 127.0.0.1 or $HOST)
  --help             Show this help

Examples:
  sudo metserve
  metserve --port 9000 --host 0.0.0.0
  PORT=9000 HOST=127.0.0.1 metserve
`.trim());
}

function takeArgValue(args: string[], i: number, flag: string): { value?: string; nextIndex: number } {
    const a = args[i];
    const eq = a?.indexOf("=");
    if (eq !== -1) return { value: a?.slice(eq! + 1), nextIndex: i };
    const v = args[i + 1];
    if (!v || v.startsWith("-")) {
        console.error(`Missing value for ${flag}`);
        process.exit(2);
    }
    return { value: v, nextIndex: i + 1 };
}

const argv = process.argv.slice(2);

for (let i = 0; i < argv.length; i++) {
    const a = argv[i];

    if (a === "--help" || a === "-?" || a === "-help") {
        printHelp();
        process.exit(0);
    }

    if (a === "--port" || a?.startsWith("--port=") || a === "-p") {
        const { value, nextIndex } = takeArgValue(argv, i, "--port");
        i = nextIndex;
        const n = Number(value);
        if (!Number.isFinite(n) || n <= 0 || n > 65535) {
            console.error(`Invalid port: ${value}`);
            process.exit(2);
        }
        process.env.PORT = String(n);
        continue;
    }

    if (a === "--host" || a?.startsWith("--host=") || a === "-h") {
        const { value, nextIndex } = takeArgValue(argv, i, "--host");
        i = nextIndex;
        process.env.HOST = String(value);
        continue;
    }

    console.error(`Unknown arg: ${a}\n`);
    printHelp();
    process.exit(2);
}

// Basic heads-up: running without sudo will often yield partial metrics.
if (typeof process.getuid === "function" && process.getuid() !== 0) {
    console.error(
        "[metserve] Note: not running as root. If GPU/temps are missing, re-run with:\n" +
        "  sudo metserve\n"
    );
}

// Start the server.
await import("./metrics-server.ts");
