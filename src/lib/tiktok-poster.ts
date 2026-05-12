import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Page, Frame, ElementHandle } from "puppeteer";
import path from "path";
import fs from "fs";
import os from "os";

puppeteerExtra.use(StealthPlugin());

const COOKIES_PATH = path.join(process.cwd(), ".tiktok-session.json");
const SCREENSHOTS_DIR = path.join(process.cwd(), "screenshots");
const UPLOAD_URL = "https://www.tiktok.com/creator-center/upload";
const QR_LOGIN_URL = "https://www.tiktok.com/login/qrcode";
const CHROME_DEBUG_PORT = parseInt(process.env.CHROME_DEBUG_PORT ?? "9222", 10);

async function screenshot(page: Page, label: string, log: (m: string) => void): Promise<void> {
  try {
    if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    const file = path.join(SCREENSHOTS_DIR, `${Date.now()}-${label}.png`);
    await page.screenshot({ path: file, fullPage: true });
    log(`📸 Screenshot: ${file}`);
  } catch { /* não bloqueia o fluxo */ }
}

// Persists across hot-reloads
const g = globalThis as typeof globalThis & {
  __tiktokLoginPromise?: Promise<void>;
  __tiktokSessionValid?: boolean;
};

export type PostParams = {
  filePath: string;
  title: string;
  description?: string;
  comment?: string;
  hashtags: string[];
  scheduledDate?: string; // datetime-local format: "YYYY-MM-DDTHH:mm"
  headless?: boolean;
  log?: (msg: string) => void;
};

export async function postToTikTok(params: PostParams): Promise<void> {
  const log = params.log ?? (() => {});
  const uploadHeadless = params.headless ?? (process.env.PUPPETEER_HEADLESS !== "false");

  // Phase 1: guarantee a valid session.
  // Login browser is ALWAYS visible so the user can scan the QR code.
  // Only one job runs this at a time; the rest wait and reuse the saved cookies.
  await ensureValidSession(log);

  // Phase 2: upload — connects to the running Chrome tab or launches a new one.
  log("Conectando ao Chrome para upload...");
  const handle = await connectOrLaunch(uploadHeadless);
  const page = await handle.browser.newPage();

  try {
    await loadCookies(page);

    log("Abrindo página de upload...");
    await page.goto(UPLOAD_URL, { waitUntil: "networkidle2", timeout: 60_000 });
    await humanDelay(1_500, 3_000);

    if (onLoginPage(page)) {
      // Session expired between Phase 1 and Phase 2 — force re-login on next run
      g.__tiktokSessionValid = false;
      throw new Error("Sessão inválida após login. Tente novamente.");
    }

    await screenshot(page, "01-upload-page", log);

    log("Aguardando iframe de upload...");
    const frame = await getUploadFrame(page);
    await humanDelay(800, 1_800);

    log("Enviando arquivo de vídeo...");
    await uploadFile(frame, params.filePath);
    await humanDelay(1_000, 2_000);

    log("Aguardando processamento do vídeo...");
    await waitForProcessing(frame);
    log("Vídeo processado com sucesso.");
    await dismissPopups(page, log);
    await screenshot(page, "02-after-processing", log);
    await humanDelay(1_200, 2_500);

    log("Preenchendo legenda...");
    await fillCaption(frame, buildCaption(params.description ?? params.title, params.hashtags));
    log("Legenda preenchida.");
    await humanDelay(800, 1_600);

    if (params.comment?.trim()) {
      log("Preenchendo primeiro comentário...");
      await fillFirstComment(frame, params.comment.trim(), log);
      await humanDelay(600, 1_200);
    }

    if (params.scheduledDate) {
      log(`Configurando agendamento para ${params.scheduledDate}...`);
      await setSchedule(frame, params.scheduledDate);
      log("Agendamento configurado.");
      await humanDelay(800, 1_500);
    } else {
      log("Sem data de agendamento — publicará imediatamente.");
    }

    await screenshot(page, "03-before-submit", log);
    log("Clicando em Publicar...");
    await humanDelay(600, 1_200);
    await submitPost(frame, page, log);
    log("Publicado com sucesso!");

    await persistCookies(page);
  } finally {
    await releaseBrowser(handle, page);
    try { fs.unlinkSync(params.filePath); } catch { /* ignore */ }
  }
}

// ─── Session management ───────────────────────────────────────────────────────

function onLoginPage(page: Page): boolean {
  return page.url().includes("login") || page.url().includes("passport");
}

async function ensureValidSession(log: (m: string) => void): Promise<void> {
  if (g.__tiktokSessionValid) {
    log("Sessão ativa.");
    return;
  }

  if (g.__tiktokLoginPromise) {
    log("Aguardando login de outro vídeo...");
    await g.__tiktokLoginPromise;
    return;
  }

  if (hasValidSessionCookies()) {
    log("Cookies de sessão válidos.");
    g.__tiktokSessionValid = true;
    return;
  }

  log("Sessão expirada. Abrindo navegador — escaneie o QR Code com seu celular...");
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  g.__tiktokLoginPromise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });

  try {
    const loginHandle = await connectOrLaunch(false); // always visible
    const loginPage = await loginHandle.browser.newPage();
    try {
      await loadCookies(loginPage);

      await loginPage.goto(UPLOAD_URL, { waitUntil: "networkidle2", timeout: 60_000 });
      await humanDelay(1_500, 3_000);

      if (onLoginPage(loginPage)) {
        await doQRLogin(loginPage, log);
      } else {
        log("Cookies ainda válidos.");
      }

      await persistCookies(loginPage);
      g.__tiktokSessionValid = true;
    } finally {
      await releaseBrowser(loginHandle, loginPage);
    }

    log("Sessão salva. Navegador de login fechado.");
    resolve();
  } catch (e) {
    g.__tiktokSessionValid = false;
    reject(e);
    throw e;
  } finally {
    g.__tiktokLoginPromise = undefined;
  }
}

function hasValidSessionCookies(): boolean {
  if (!fs.existsSync(COOKIES_PATH)) return false;
  try {
    const cookies: Array<{ name: string; expires?: number; domain?: string }> =
      JSON.parse(fs.readFileSync(COOKIES_PATH, "utf-8"));
    const session = cookies.find(
      (c) =>
        (c.name === "sessionid" || c.name === "sid_tt") &&
        c.domain?.includes("tiktok.com")
    );
    if (!session) return false;
    if (!session.expires || session.expires === -1) return true;
    return session.expires * 1000 > Date.now() + 5 * 60 * 1000; // 5 min buffer
  } catch {
    return false;
  }
}

// ─── Login via QR Code ────────────────────────────────────────────────────────

async function doQRLogin(page: Page, log: (msg: string) => void): Promise<void> {
  log("Abrindo página de QR Code...");
  await page.goto(QR_LOGIN_URL, { waitUntil: "networkidle2", timeout: 60_000 });
  await humanDelay(1_000, 2_000);

  log("QR Code visível no navegador — escaneie com o app do TikTok no celular.");
  log("Aguardando confirmação do login (até 3 minutos)...");

  await page.waitForFunction(
    () =>
      !location.href.includes("login") &&
      !location.href.includes("passport") &&
      !location.href.includes("qrcode"),
    { timeout: 180_000, polling: 1_000 }
  );

  log("Login via QR Code realizado com sucesso!");
  await humanDelay(1_000, 2_000);
}

// ─── Frame ────────────────────────────────────────────────────────────────────

async function getUploadFrame(page: Page): Promise<Frame> {
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
  await humanDelay(300, 700);
  await input.uploadFile(filePath);
}

async function waitForProcessing(frame: Frame): Promise<void> {
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

  await humanDelay(400, 800);
  await editor.click({ clickCount: 3 });
  await humanDelay(300, 600);
  await editor.type(caption, { delay: 40 + Math.random() * 40 });
}

// ─── Schedule ─────────────────────────────────────────────────────────────────

async function setSchedule(frame: Frame, isoDate: string): Promise<void> {
  const toggle = await frame.$(
    '[data-e2e="schedule-switch"], ' +
    '[class*="schedule"] input[type="checkbox"], ' +
    '[class*="schedule-toggle"]'
  );
  if (toggle) {
    await humanDelay(400, 900);
    await toggle.click();
    await humanDelay(800, 1_500);
  }

  const dt = new Date(isoDate);
  const dateStr = dt.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
  const dateInput = await frame.$('[data-e2e="schedule-date"] input, [class*="date-picker"] input:first-of-type');
  if (dateInput) {
    await humanDelay(300, 700);
    await dateInput.click({ clickCount: 3 });
    await humanDelay(200, 500);
    await dateInput.type(dateStr, { delay: 50 + Math.random() * 30 });
  }

  await humanDelay(500, 1_000);

  const timeStr = `${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
  const timeInput = await frame.$('[data-e2e="schedule-time"] input, [class*="time-picker"] input');
  if (timeInput) {
    await humanDelay(300, 700);
    await timeInput.click({ clickCount: 3 });
    await humanDelay(200, 500);
    await timeInput.type(timeStr, { delay: 50 + Math.random() * 30 });
  }
}

// ─── Popup dismissal ─────────────────────────────────────────────────────────

async function dismissPopups(page: Page, log: (m: string) => void): Promise<void> {
  const dismissed = await page.evaluate(() => {
    const found: string[] = [];
    const DISMISS = ["cancel", "got it", "later", "not now", "skip", "fechar", "close"];

    // Look inside modal/dialog containers first
    const containers = Array.from(document.querySelectorAll<HTMLElement>(
      '[role="dialog"], [class*="modal"], [class*="Modal"], [class*="overlay"], [class*="Overlay"], [class*="popup"], [class*="Popup"]'
    ));

    for (const container of containers) {
      for (const btn of Array.from(container.querySelectorAll<HTMLButtonElement>("button"))) {
        const txt = (btn.textContent ?? "").trim().toLowerCase();
        if (DISMISS.includes(txt) && (btn as HTMLElement).offsetParent !== null) {
          btn.click();
          found.push(txt);
        }
      }
      // ×  close icon buttons
      for (const btn of Array.from(container.querySelectorAll<HTMLButtonElement>(
        'button[aria-label*="lose"], button[aria-label*="echar"], button[class*="close"], button[class*="Close"]'
      ))) {
        if ((btn as HTMLElement).offsetParent !== null && !found.includes("×")) {
          btn.click();
          found.push("×");
        }
      }
    }
    return found;
  });

  if (dismissed.length) {
    log(`Popups dispensados: ${dismissed.join(", ")}`);
    await humanDelay(400, 700);
  }
}

// ─── Submit ───────────────────────────────────────────────────────────────────

async function findPostButton(frame: Frame) {
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    // 1. Try known data-e2e and class selectors (without :not([disabled]) to avoid missing it)
    for (const sel of [
      '[data-e2e="post-button"]',
      '[data-e2e="submit-button"]',
      'button[class*="post-btn"]',
      'button[class*="btn-post"]',
      'button[class*="submit-btn"]',
      'button[class*="publish"]',
    ]) {
      const el = await frame.$(sel);
      if (el) {
        const disabled = await el.evaluate((b) => (b as HTMLButtonElement).disabled);
        if (!disabled) return el;
      }
    }

    // 2. Fallback: any enabled button whose visible text matches "Post / Publicar / Postar"
    const textBtn = await frame.evaluateHandle(() => {
      const all = Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
      return (
        all.find(
          (b) =>
            !b.disabled &&
            /^(post|publicar|postar|publish|enviar)$/i.test((b.textContent ?? "").trim())
        ) ?? null
      );
    }) as ElementHandle<HTMLButtonElement> | null;
    if (textBtn) return textBtn;

    await new Promise((r) => setTimeout(r, 1_000));
  }

  return null;
}

async function submitPost(frame: Frame, page: Page, log: (m: string) => void): Promise<void> {
  // Dismiss any blocking popups before trying to click Post
  await dismissPopups(page, log);
  await humanDelay(300, 600);

  const btn = await findPostButton(frame);
  if (!btn) {
    await screenshot(page, "error-no-post-btn", log);
    throw new Error("Botão de publicar não encontrado na página de upload");
  }

  await humanDelay(400, 800);
  await btn.click();
  await humanDelay(1_000, 1_800);

  // Modal may appear again after clicking — dismiss it so Post can proceed
  await dismissPopups(page, log);
  await humanDelay(500, 1_000);
  await screenshot(page, "04-after-click-publish", log);

  // Wait for success: either redirect away from /upload, or a visible success toast.
  // If neither happens in 45 s, dismiss popups and retry the click once.
  const succeeded = await page.waitForFunction(
    () => {
      if (!location.href.includes("/upload")) return true;
      const toasts = Array.from(document.querySelectorAll<HTMLElement>(
        '[class*="toast"], [class*="Toast"], [class*="snack"], [class*="Snack"], [role="alert"]'
      ));
      return toasts.some(
        (el) => el.offsetParent !== null && /success|sucesso|publicad|posted|scheduled|agendad/i.test(el.textContent ?? "")
      );
    },
    { timeout: 45_000, polling: 2_000 }
  ).catch(() => null);

  if (!succeeded) {
    log("Sem resposta após 45 s — tentando dispensar popups e clicar novamente...");
    await dismissPopups(page, log);
    await humanDelay(500, 1_000);
    const btn2 = await findPostButton(frame);
    if (btn2) {
      await btn2.click();
      log("Segundo clique em Publicar.");
      await humanDelay(1_000, 1_800);
      await dismissPopups(page, log);
    }
    await screenshot(page, "04b-retry-publish", log);
    // Final wait with full timeout
    await page.waitForFunction(
      () => {
        if (!location.href.includes("/upload")) return true;
        const toasts = Array.from(document.querySelectorAll<HTMLElement>(
          '[class*="toast"], [class*="Toast"], [class*="snack"], [class*="Snack"], [role="alert"]'
        ));
        return toasts.some(
          (el) => el.offsetParent !== null && /success|sucesso|publicad|posted|scheduled|agendad/i.test(el.textContent ?? "")
        );
      },
      { timeout: 60_000, polling: 2_000 }
    );
  }

  await screenshot(page, "05-success", log);
}

// ─── First Comment (filled in the upload form before publishing) ──────────────

async function fillFirstComment(frame: Frame, comment: string, log: (msg: string) => void): Promise<void> {
  const selectors = [
    '[data-e2e="comment-text-input"]',
    '[data-e2e="first-comment-input"]',
    '[class*="comment"] [contenteditable="true"]',
    '[class*="first-comment"] textarea',
    '[class*="comment-input"]',
    'textarea[placeholder*="omment"]',
    'textarea[placeholder*="omentário"]',
    'textarea[placeholder*="primeiro"]',
  ];

  for (const sel of selectors) {
    const el = await frame.$(sel);
    if (el) {
      await el.click();
      await humanDelay(300, 600);
      await el.type(comment, { delay: 40 + Math.random() * 40 });
      log(`Primeiro comentário preenchido (seletor: ${sel}).`);
      return;
    }
  }

  log("Campo de primeiro comentário não encontrado no formulário — verifique o screenshot 03-before-submit.");
}

// ─── Utils ────────────────────────────────────────────────────────────────────

type BrowserHandle = {
  browser: Awaited<ReturnType<typeof puppeteerExtra.launch>>;
  owned: boolean; // false = connected to existing Chrome, do not close on release
};

async function connectOrLaunch(headless: boolean): Promise<BrowserHandle> {
  // Connect to the Chrome the user already has open (needs --remote-debugging-port=9222)
  try {
    const res = await fetch(`http://127.0.0.1:${CHROME_DEBUG_PORT}/json/version`, {
      signal: AbortSignal.timeout(1_500),
    });
    if (res.ok) {
      const browser = await puppeteerExtra.connect({
        browserURL: `http://127.0.0.1:${CHROME_DEBUG_PORT}`,
      });
      return { browser, owned: false };
    }
  } catch { /* Chrome not running with debug port — fall through */ }

  // Fallback: launch Chrome binary in a fresh temp dir (avoids conflicts with running Chrome).
  // TikTok session comes from .tiktok-session.json loaded by loadCookies() later.
  const executablePath = getChromeExecutablePath();
  const browser = await puppeteerExtra.launch({
    headless,
    executablePath,
    args: [
      `--remote-debugging-port=${CHROME_DEBUG_PORT}`,
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
    ],
    defaultViewport: { width: 1280, height: 900 },
  });
  return { browser, owned: true };
}

async function releaseBrowser(handle: BrowserHandle, page: Page): Promise<void> {
  try { await page.close(); } catch { /* ignore */ }
  if (handle.owned) {
    try { await handle.browser.close(); } catch { /* ignore */ }
  } else {
    handle.browser.disconnect();
  }
}

function getChromeExecutablePath(): string {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  const localAppData = process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error("Google Chrome não encontrado. Defina CHROME_PATH no .env.");
}


async function loadCookies(page: Page): Promise<void> {
  if (!fs.existsSync(COOKIES_PATH)) return;
  const saved = JSON.parse(fs.readFileSync(COOKIES_PATH, "utf-8"));
  await page.setCookie(...saved);
}

function humanDelay(min: number, max: number): Promise<void> {
  return new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));
}

async function humanType(page: Page, selector: string, text: string): Promise<void> {
  await page.focus(selector);
  await humanDelay(200, 500);
  await page.type(selector, text, { delay: 60 + Math.random() * 60 });
}

async function persistCookies(page: Page): Promise<void> {
  const cookies = await page.cookies();
  fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));
}
