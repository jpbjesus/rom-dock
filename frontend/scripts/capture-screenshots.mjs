/** Reproducible screenshots using synthetic data; no console or credentials required. */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const output = fileURLToPath(
  new URL("../../docs/screenshots/", import.meta.url),
);
await mkdir(output, { recursive: true });
const baseURL = process.env.ROMDOCK_SCREENSHOT_URL || "http://127.0.0.1:8765";
const folder = (name) => ({
  name,
  directory: true,
  symlink: false,
  size: 0,
  modified: 1760000000,
});
const file = (name, size = 4194304) => ({
  ...folder(name),
  directory: false,
  size,
});
const systems = [
  "snes",
  "gba",
  "gb",
  "gbc",
  "nes",
  "n64",
  "nds",
  "megadrive",
  "mastersystem",
  "gamegear",
  "psx",
  "psp",
  "arcade",
  "neogeo",
  "dreamcast",
  "saturn",
  "pcengine",
  "atari2600",
  "ports",
  "virtualboy",
  "wonderswan",
];
const names = [
  "Aurora Circuit",
  "Orbital Expedition",
  "Crystal Valley",
  "Nebula Drift",
  "Silent Horizon",
  "Lunar Archive",
  "Pixel Rally",
  "Echoes of Dawn",
  "Copper Castle",
  "Solar Passage",
  "Violet Summit",
  "Winter Signal",
];
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 980 },
  deviceScaleFactor: 1,
  reducedMotion: "reduce",
});
const page = await context.newPage();
let connected = true;
await page.addInitScript(() => {
  if (!localStorage.getItem("romdock-demo-ready")) {
    localStorage.setItem(
      "romdock-favorites",
      JSON.stringify(["snes", "gba", "psx"]),
    );
    localStorage.setItem("romdock-demo-ready", "true");
  }
});
await page.route("**/api/**", async (route) => {
  const u = new URL(route.request().url());
  const path = u.searchParams.get("path") || "";
  let json = { ok: true };
  if (u.pathname === "/api/status")
    json = {
      connected,
      host: "console.local",
      generation: "demo",
      storage: { total: 128e9, used: 487e8, free: 793e8 },
    };
  if (u.pathname === "/api/files")
    json = {
      entries: path
        ? names.map((name, i) => file(name + ".sfc", 2097152 + i * 524288))
        : systems.map(folder),
    };
  if (u.pathname === "/api/systems")
    json = { systems: Object.fromEntries(systems.map((s, i) => [s, i < 16])) };
  if (u.pathname === "/api/folder-info")
    json = { files: 12, folders: 0, bytes: 78000000, modified: 1760000000 };
  if (u.pathname === "/api/covers")
    json = {
      covers: Object.fromEntries(
        names.map((n, i) => [
          n + ".sfc",
          { image: `snes/images/demo-${i}.png`, version: "1" },
        ]),
      ),
    };
  if (u.pathname === "/api/cover")
    json = {
      rom: u.searchParams.get("rom"),
      revision: "demo",
      cover: null,
      images: [],
    };
  if (u.pathname === "/api/image") {
    const i = Number(path.match(/demo-(\d+)/)?.[1] || 0);
    const hue = (i * 37 + 205) % 360;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><defs><linearGradient id="b" x2="1" y2="1"><stop stop-color="hsl(${hue} 55% 30%)"/><stop offset="1" stop-color="#111b30"/></linearGradient></defs><rect width="300" height="400" rx="8" fill="url(#b)"/><circle cx="150" cy="155" r="80" fill="none" stroke="hsl(${hue} 80% 75%)" stroke-width="2"/><path d="M35 235 125 95 265 265 95 265Z" fill="hsl(${hue} 70% 70%)" fill-opacity=".3"/><text x="24" y="330" font-family="sans-serif" font-size="23" fill="white">${names[i].split(" ")[0].toUpperCase()}</text><text x="24" y="357" font-family="sans-serif" font-size="16" fill="#cdddee">${names[i].split(" ").slice(1).join(" ").toUpperCase()}</text><text x="24" y="385" font-family="sans-serif" font-size="9" fill="#b4c2d4">ROM DOCK · DEMONSTRATION</text></svg>`;
    return route.fulfill({ contentType: "image/svg+xml", body: svg });
  }
  return route.fulfill({ json });
});
async function capture(name) {
  await page.waitForTimeout(120);
  await page.screenshot({ path: output + name + ".png", fullPage: true });
}
try {
  await page.goto(baseURL);
  await page
    .getByRole("heading", { name: "Biblioteca de ROMs", exact: true })
    .waitFor();
  await capture("desktop-dark");
  await page
    .getByRole("button", { name: "Abrir Super Nintendo", exact: true })
    .click();
  await page.locator(".rom-cover").first().waitFor();
  await capture("covers-dark");
  await page.getByRole("button", { name: "Claro", exact: true }).click();
  await page
    .getByRole("button", { name: "Vista em lista", exact: true })
    .click();
  await capture("list-light");
  await page
    .getByRole("button", { name: "Encolher barra lateral", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Encolher informação", exact: true })
    .click();
  await capture("panels-collapsed");
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Vista em grelha", exact: true })
    .click();
  await capture("mobile-light");
  connected = false;
  await page.reload();
  await page
    .getByRole("heading", { name: "Ligar a consola", exact: true })
    .waitFor();
  await capture("connection-mobile");
  console.log(`Screenshots saved to ${output}`);
} finally {
  await browser.close();
}
