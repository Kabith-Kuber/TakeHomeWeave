import puppeteer from "puppeteer";

const url = process.argv[2] || "http://localhost:4173/";
const out = process.argv[3] || "shot.png";

const browser = await puppeteer.launch({ headless: "new" });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: "networkidle0", timeout: 30000 });
await new Promise((r) => setTimeout(r, 1200));
await page.screenshot({ path: out, fullPage: process.argv[4] === "full" });
console.log("saved", out);
if (errors.length) console.log("CONSOLE ERRORS:\n" + errors.join("\n"));
else console.log("no console errors");
await browser.close();
