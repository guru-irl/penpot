// Verify which renderer the user's launcher actually gets, and whether the VF
// renders, WITHOUT forcing ?wasm=true (i.e. exactly like pencilpot.mjs does).
//
// Renders the user's REAL vftest project cold (no interaction) in two modes:
//   default : URL has NO &wasm=true (what `pencilpot open` produces)
//   wasm    : URL forces &wasm=true (what the old harness/shoot.mjs used)
// For each, reports: renderer features active, canvas vs svg-text presence,
// whether the VF binary was fetched, and a screenshot.

import { chromium } from "../../node_modules/playwright/index.mjs";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME = path.resolve(HERE, "../../runtime/server.mjs");
const TEAM_ID = "0398e5fc-95c9-80d6-8008-29071f0fdaed";
const PROJECT = "/mnt/data/src/pencilpot-vftest";
const FID = "67e207c3-ec3b-80d7-8008-252de1d3a44e";
const CHROME_ARGS = ["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"];

function waitForServer(url, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try { const r = await fetch(url); if (r.ok) return resolve(); } catch {}
      if (Date.now() > deadline) return reject(new Error("server down"));
      setTimeout(tick, 250);
    };
    tick();
  });
}

async function run(mode) {
  const port = 10000 + Math.floor(Math.random() * 40000);
  const srv = spawn(process.execPath, [RUNTIME], {
    env: { ...process.env, PENCILPOT_PROJECT: PROJECT, PENCILPOT_PORT: String(port) },
    stdio: ["ignore", "ignore", "ignore"],
  });
  try {
    await waitForServer(`http://localhost:${port}/`);
    const browser = await chromium.launch({ headless: true, args: CHROME_ARGS });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const fontAssets = [];
    const consoleErrors = [];
    page.on("request", (r) => { const u = r.url(); if (u.includes("/assets/by-id/")) fontAssets.push(u.split("/assets/by-id/")[1]); });
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
    page.on("pageerror", (e) => consoleErrors.push(String(e)));
    const wasmParam = mode === "wasm" ? "&wasm=true" : "";
    const url = `http://localhost:${port}/#/workspace?team-id=${TEAM_ID}&file-id=${FID}${wasmParam}`;
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(8000);
    const info = await page.evaluate(() => {
      const feats = (globalThis.app?.main?.store?.state) ? null : null; // can't easily read cljs; use DOM
      const canvas = document.querySelectorAll("canvas").length;
      // SVG text nodes used by the SVG renderer for the workspace viewport
      const svgText = document.querySelectorAll("foreignObject, .text-node, svg text").length;
      const crash = !!document.querySelector(".exception-layout, .render-error") || /Internal Error|Something went wrong/i.test(document.body.innerText);
      return { canvas, svgText, crash };
    });
    const vfFetched = fontAssets.some((a) => a.startsWith("custom-google-sans-flex"));
    await browser.close();
    return { mode, canvas: info.canvas, svgText: info.svgText, crash: info.crash, vfFetched, errCount: consoleErrors.length, errs: consoleErrors.slice(0, 4) };
  } finally { try { process.kill(srv.pid); } catch {} }
}

const def = await run("default");
const wasm = await run("wasm");
console.log("MODE default (launcher, no wasm param):", JSON.stringify(def));
console.log("MODE wasm    (forced ?wasm=true)       :", JSON.stringify(wasm));
