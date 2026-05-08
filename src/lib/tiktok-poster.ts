import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Page, Frame } from "puppeteer";
import path from "path";
import fs from "fs";

puppeteerExtra.use(StealthPlugin());

const COOKIES_PATH = path.join(process.cwd(), ".tiktok-session.json");
const UPLOAD_URL = "https://www.tiktok.com/creator-center/upload";
const LOGIN_URL = "https://www.tiktok.com/login/phone-or-email/email";

export type PostParams = {
  filePath: string;
  title: string;
  hashtags: string[];
  scheduledDate?: string; // datetime-local format: "YYYY-MM-DDTHH:mm"
  email: string;
  password: string;
};

export async function postToTikTok(params: PostParams): Promise<void> {
  const headless = process.env.PUPPETEER_HEADLESS !== "false";

  const browser = await puppeteerExtra.launch({
    headless,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
    ],
    defaultViewport: { width: 1280, height: 900 },
  });

  try {
    const page = await browser.newPage();

    // Restore saved session cookies
    if (fs.existsSync(COOKIES_PATH)) {
      const saved = JSON.parse(fs.readFileSync(COOKIES_PATH, "utf-8"));
      await page.setCookie(...saved);
    }

    await page.goto(UPLOAD_URL, { waitUntil: "networkidle2", timeout: 60_000 });

    // Login if session expired / not found
    if (page.url().includes("login") || page.url().includes("passport")) {
      await doLogin(page, params.email, params.password);
      await persistCookies(page);
      await page.goto(UPLOAD_URL, { waitUntil: "networkidle2", timeout: 60_000 });
    }

    const frame = await getUploadFrame(page);

    await uploadFile(frame, params.filePath);
    await waitForProcessing(frame);
    await fillCaption(frame, buildCaption(params.title, params.hashtags));

    if (params.scheduledDate) {
      await setSchedule(frame, params.scheduledDate);
    }

    await submitPost(frame);
    await persistCookies(page);
  } finally {
    await browser.close();
    // Remove temp file after posting
    try { fs.unlinkSync(params.filePath); } catch { /* ignore */ }
  }
}

// ─── Login ────────────────────────────────────────────────────────────────────

async function doLogin(page: Page, email: string, password: string): Promise<void> {
  await page.goto(LOGIN_URL, { waitUntil: "networkidle2", timeout: 60_000 });

  await page.waitForSelector('input[name="username"]', { timeout: 20_000 });
  await humanType(page, 'input[name="username"]', email);
  await humanType(page, 'input[type="password"]', password);

  await page.click('button[type="submit"], [data-e2e="login-button"]');

  // Wait for redirect away from login pages
  await page.waitForFunction(
    () => !location.href.includes("login") && !location.href.includes("passport"),
    { timeout: 30_000, polling: 500 }
  );
}

// ─── Frame ────────────────────────────────────────────────────────────────────

async function getUploadFrame(page: Page): Promise<Frame> {
  // TikTok creator center renders the upload widget inside an iframe
  try {
    await page.waitForSelector("iframe", { timeout: 20_000 });
    const frames = page.frames();
    const upload = frames.find(
      (f) => f !== page.mainFrame() && f.url().includes("tiktok.com")
    );
    if (upload) return upload;
  } catch { /* fall through */ }
  return page.mainFrame();
}

// ─── Upload ───────────────────────────────────────────────────────────────────

async function uploadFile(frame: Frame, filePath: string): Promise<void> {
  const input = await frame.waitForSelector('input[type="file"]', { timeout: 20_000 });
  if (!input) throw new Error("File input not found on upload page");
  await input.uploadFile(filePath);
}

async function waitForProcessing(frame: Frame): Promise<void> {
  // Wait until the upload progress UI disappears and the caption editor is visible
  await frame.waitForFunction(
    () => {
      const busy =
        document.querySelector('[class*="upload-progress"]') ||
        document.querySelector('[class*="uploading"]') ||
        document.querySelector('[class*="processing"]');
      const ready =
        document.querySelector('[contenteditable="true"]') ||
        document.querySelector('[data-e2e="caption-input"]');
      return !busy && !!ready;
    },
    { timeout: 120_000, polling: 2_000 }
  );
}

// ─── Caption ──────────────────────────────────────────────────────────────────

function buildCaption(title: string, hashtags: string[]): string {
  const tags = hashtags.map((t) => `#${t.replace(/^#+/, "")}`).join(" ");
  return `${title} ${tags}`.trim();
}

async function fillCaption(frame: Frame, caption: string): Promise<void> {
  const sel =
    '[data-e2e="caption-input"], ' +
    '[contenteditable="true"][class*="caption"], ' +
    '[contenteditable="true"]';

  const editor = await frame.waitForSelector(sel, { timeout: 20_000 });
  if (!editor) throw new Error("Caption editor not found");

  await editor.click({ clickCount: 3 }); // select all existing text
  await editor.type(caption, { delay: 25 });
}

// ─── Schedule ─────────────────────────────────────────────────────────────────

async function setSchedule(frame: Frame, isoDate: string): Promise<void> {
  // Enable the schedule toggle
  const toggle = await frame.$(
    '[data-e2e="schedule-switch"], ' +
    '[class*="schedule"] input[type="checkbox"], ' +
    '[class*="schedule-toggle"]'
  );
  if (toggle) {
    await toggle.click();
    await delay(600);
  }

  const dt = new Date(isoDate);

  // Date field  — TikTok uses MM/DD/YYYY
  const dateStr = dt.toLocaleDateString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  });
  const dateInput = await frame.$(
    '[data-e2e="schedule-date"] input, [class*="date-picker"] input:first-of-type'
  );
  if (dateInput) {
    await dateInput.click({ clickCount: 3 });
    await dateInput.type(dateStr, { delay: 50 });
  }

  // Time field — HH:mm (24-hour)
  const timeStr = `${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
  const timeInput = await frame.$(
    '[data-e2e="schedule-time"] input, [class*="time-picker"] input'
  );
  if (timeInput) {
    await timeInput.click({ clickCount: 3 });
    await timeInput.type(timeStr, { delay: 50 });
  }
}

// ─── Submit ───────────────────────────────────────────────────────────────────

async function submitPost(frame: Frame): Promise<void> {
  const btn = await frame.waitForSelector(
    '[data-e2e="post-button"]:not([disabled]), ' +
    'button[class*="post-btn"]:not([disabled]), ' +
    'button[class*="submit"]:not([disabled])',
    { timeout: 15_000 }
  );
  if (!btn) throw new Error("Post button not found");
  await btn.click();

  // Wait for the success screen
  await frame.waitForFunction(
    () =>
      document.querySelector('[class*="success"]') !== null ||
      document.querySelector('[data-e2e="upload-success"]') !== null,
    { timeout: 60_000, polling: 1_500 }
  );
}

// ─── Utils ────────────────────────────────────────────────────────────────────

async function humanType(page: Page, selector: string, text: string): Promise<void> {
  await page.focus(selector);
  await page.type(selector, text, { delay: 60 + Math.random() * 40 });
}

async function persistCookies(page: Page): Promise<void> {
  const cookies = await page.cookies();
  fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
