// bun.ts
// #!/usr/bin/env bun
/**
 * Bun metrics bridge for macOS (Apple Silicon)
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
 * Endpoints:
 *   GET /metrics -> { gpu: {...}, memory: {...}, thermal: {...}, perf: {...} }
 *   GET /raw     -> raw powermetrics/memory/thermal outputs
 *   GET /        -> serves ./dashboard.html if present
 *
 * Run:
 *   sudo bun run bun.ts
 *
 * Dashboard:
 *   http://localhost:8787/
 */

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "127.0.0.1";

type GPUStats = {
  freq_mhz: number | null;
  active_pct: number | null;
  idle_pct: number | null;
  power_mw: number | null;
};

type MemoryStats = {
  pressure: "green" | "yellow" | "red" | "unknown";
  swap_gb: number | null;
};

type PerfStats = {
  ms_per_step: number | null;
  tokens_per_s: number | null;
};

type ThermalStats = {
  cpu_speed_limit_pct: number | null;
  gpu_speed_limit_pct: number | null;
  thermal_pressure: "nominal" | "moderate" | "heavy" | "critical" | "unknown";

  cpu_temp_c: number | null;
  gpu_temp_c: number | null;
  soc_temp_c: number | null;

  source: {
    pmset_ok: boolean;
    powermetrics_smc_ok: boolean;
    m4_temp_ok: boolean;
  };
};

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "content-type",
      "cache-control": "no-store",
    },
  });
}

function text(data: string, status = 200) {
  return new Response(data, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
    },
  });
}

async function run(cmd: string[], timeoutMs = 5000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });

  const timeout = setTimeout(() => {
    try { p.kill("SIGKILL"); } catch {}
  }, timeoutMs);

  const [stdout, stderr] = await Promise.all([
    new Response(p.stdout).text().catch(() => ""),
    new Response(p.stderr).text().catch(() => ""),
  ]);

  clearTimeout(timeout);

  const code = await p.exited;
  return { ok: code === 0, stdout, stderr };
}

function matchNumber(hay: string, re: RegExp): number | null {
  const m = hay.match(re);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function parsePowermetricsGPU(out: string): GPUStats {
  return {
    freq_mhz: matchNumber(out, /GPU HW active frequency:\s*([0-9.]+)\s*MHz/i),
    active_pct: matchNumber(out, /GPU HW active residency:\s*([0-9.]+)\s*%/i),
    idle_pct: matchNumber(out, /GPU idle residency:\s*([0-9.]+)\s*%/i),
    power_mw: matchNumber(out, /GPU Power:\s*([0-9.]+)\s*mW/i),
  };
}

function parseMemoryPressure(out: string): MemoryStats["pressure"] {
  const lower = out.toLowerCase();
  if (lower.includes("critical") || lower.includes("red")) return "red";
  if (lower.includes("warn") || lower.includes("warning") || lower.includes("yellow")) return "yellow";
  if (lower.includes("normal") || lower.includes("green") || lower.includes("77%")) return "green"; // Fallback: 77% is nominal/green
  if (lower.includes("memory free percentage")) return "green";
  return "unknown";
}

function parseSwapUsage(sysctlOut: string): number | null {
  const used = sysctlOut.match(/used\s*=\s*([0-9.]+)([MG])\b/i);
  if (!used) return null;
  const val = Number(used[1]);
  const unit = used[2].toUpperCase();
  if (!Number.isFinite(val)) return null;
  return unit === "G" ? val : val / 1024;
}

function parsePmsetTherm(out: string) {
  const cpuLim = matchNumber(out, /CPU_Speed_Limit\s*=\s*([0-9.]+)/i);
  const gpuLim = matchNumber(out, /GPU_Speed_Limit\s*=\s*([0-9.]+)/i);

  let pressure: ThermalStats["thermal_pressure"] = "unknown";
  const m =
      out.match(/ThermalPressure\s*=\s*([A-Za-z]+)/i) ||
      out.match(/Thermal Pressure:\s*([A-Za-z]+)/i) ||
      out.match(/Current pressure level:\s*([A-Za-z]+)/i);

  if (m) {
    const v = m[1].toLowerCase();
    if (v.includes("nominal")) pressure = "nominal";
    else if (v.includes("moderate")) pressure = "moderate";
    else if (v.includes("heavy")) pressure = "heavy";
    else if (v.includes("critical")) pressure = "critical";
  }

  if (pressure === "unknown" && (out.includes("No thermal warning level has been recorded") || out.includes("Nominal"))) {
    pressure = "nominal";
  }

  // If no limits found, and no warning recorded, default to 100%
  const finalCpuLim = cpuLim ?? (out.includes("No CPU power status has been recorded") ? 100 : null);
  const finalGpuLim = gpuLim ?? 100; // Usually 100 if not mentioned

  return { cpuLim: finalCpuLim, gpuLim: finalGpuLim, pressure };
}

function parsePowermetricsSMCTemps(out: string) {
  const cpu =
      matchNumber(out, /CPU die temperature:\s*([0-9.]+)\s*C/i) ??
      matchNumber(out, /CPU temperature:\s*([0-9.]+)\s*C/i);

  const gpu =
      matchNumber(out, /GPU die temperature:\s*([0-9.]+)\s*C/i) ??
      matchNumber(out, /GPU temperature:\s*([0-9.]+)\s*C/i);

  const soc =
      matchNumber(out, /SoC die temperature:\s*([0-9.]+)\s*C/i) ??
      matchNumber(out, /SOC die temperature:\s*([0-9.]+)\s*C/i) ??
      matchNumber(out, /PMU die temperature:\s*([0-9.]+)\s*C/i);

  return { cpu, gpu, soc };
}

async function getGPU(): Promise<{ stats: GPUStats; raw: string; ok: boolean }> {
  const cmd = ["powermetrics", "--samplers", "gpu_power", "-n", "1", "-i", "1000"];
  const r = await run(cmd, 8000);
  const raw = (r.stdout || "") + (r.stderr || "");
  const stats = parsePowermetricsGPU(raw);
  return { stats, raw, ok: r.ok };
}

async function getMemory(): Promise<{ stats: MemoryStats; raw: string; ok: boolean }> {
  const [mp, swap] = await Promise.all([
    run(["memory_pressure", "-Q"], 4000),
    run(["sysctl", "vm.swapusage"], 3000),
  ]);

  const mpRaw = (mp.stdout || "") + (mp.stderr || "");
  const swapRaw = (swap.stdout || "") + (swap.stderr || "");

  return {
    stats: {
      pressure: parseMemoryPressure(mpRaw),
      swap_gb: parseSwapUsage(swapRaw),
    },
    raw: `=== memory_pressure -Q ===\n${mpRaw}\n\n=== sysctl vm.swapusage ===\n${swapRaw}\n`,
    ok: mp.ok && swap.ok,
  };
}

async function getThermals(): Promise<{ stats: ThermalStats; raw: string; ok: boolean }> {
  const [pmset, smc, m4temp] = await Promise.all([
    run(["pmset", "-g", "therm"], 3000),
    run(["powermetrics", "--samplers", "smc,thermal", "-n", "1", "-i", "1000"], 8000),
    run(["swift", "./M4Temp.swift"], 4000),
  ]);

  const pmsetRaw = (pmset.stdout || "") + (pmset.stderr || "");
  const smcRaw = (smc.stdout || "") + (smc.stderr || "");
  const m4Raw = (m4temp.stdout || "") + (m4temp.stderr || "");

  const p = parsePmsetTherm(pmsetRaw + "\n" + smcRaw);
  let t = parsePowermetricsSMCTemps(smcRaw);

  // Fallback to M4Temp.swift if powermetrics SMC failed
  if (t.cpu == null && t.gpu == null && t.soc == null && m4temp.ok) {
    try {
      const data = JSON.parse(m4Raw);
      const temps = Object.values(data) as number[];
      if (temps.length > 0) {
        // M4 Max has 10 tdie sensors. We'll use the max for CPU/SoC.
        const maxTemp = Math.max(...temps);
        t.cpu = maxTemp;
        t.soc = maxTemp;
        t.gpu = maxTemp;
      }
    } catch (e) {
      // JSON parse might fail if script prints debug info or nothing
    }
  }

  const stats: ThermalStats = {
    cpu_speed_limit_pct: p.cpuLim,
    gpu_speed_limit_pct: p.gpuLim,
    thermal_pressure: p.pressure,

    cpu_temp_c: t.cpu ?? null,
    gpu_temp_c: t.gpu ?? null,
    soc_temp_c: t.soc ?? null,

    source: {
      pmset_ok: pmset.ok,
      powermetrics_smc_ok: smc.ok,
      m4_temp_ok: m4temp.ok,
    },
  };

  const raw =
      `=== pmset -g therm ===\n${pmsetRaw}\n\n` +
      `=== powermetrics (smc) ===\n${smcRaw}\n\n` +
      `=== M4Temp (HID) ===\n${m4Raw}\n`;

  return { stats, raw, ok: pmset.ok || smc.ok || m4temp.ok };
}

async function getPerf(): Promise<PerfStats> {
  return { ms_per_step: null, tokens_per_s: null };
}

const server = Bun.serve({
  hostname: HOST,
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") return json({ ok: true });
    if (url.pathname === "/health") return json({ ok: true });

    if (url.pathname === "/metrics") {
      const [gpu, mem, therm, perf] = await Promise.all([getGPU(), getMemory(), getThermals(), getPerf()]);

      const active = gpu.stats.active_pct ?? null;
      const idle = gpu.stats.idle_pct ?? null;
      const pinned = active != null && idle != null && active >= 95 && idle <= 2;

      return json({
        ts: new Date().toISOString(),
        gpu: gpu.stats,
        memory: mem.stats,
        thermal: therm.stats,
        perf,
        derived: { gpu_pinned: pinned },
        warnings: [
          ...(gpu.stats.freq_mhz == null && gpu.stats.power_mw == null
              ? ["GPU stats missing: powermetrics likely needs sudo."]
              : []),
          ...(therm.stats.source.pmset_ok === false
              ? ["Thermal stats missing: pmset -g therm failed."]
              : []),
          ...(therm.stats.source.powermetrics_smc_ok === false && therm.stats.source.m4_temp_ok === false
              ? ["Temperature sensors (CPU/GPU) are not available via standard powermetrics on M4 Max / macOS 15+."]
              : []),
        ],
      });
    }

    if (url.pathname === "/raw") {
      const [gpu, mem, therm] = await Promise.all([getGPU(), getMemory(), getThermals()]);
      return text(
          `=== powermetrics (gpu_power) ===\n${gpu.raw}\n\n` +
          `${mem.raw}\n\n` +
          `${therm.raw}\n`
      );
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      const file = Bun.file("./dashboard.html");
      if (await file.exists()) {
        return new Response(file, { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      return text("Place dashboard.html next to bun.ts\n", 404);
    }

    return text("Not found\n", 404);
  },
});

console.log(`Metrics server running on http://${HOST}:${PORT}`);
console.log(`- Dashboard: http://${HOST}:${PORT}/`);
console.log(`- Metrics:   http://${HOST}:${PORT}/metrics`);
console.log(`- Raw:       http://${HOST}:${PORT}/raw`);
console.log(`Note: powermetrics needs sudo. Run: sudo bun run bun.ts`);
