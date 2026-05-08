import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Page, Frame } from "puppeteer";
import path from "path";
import fs from "fs";

puppeteerExtra.use(StealthPlugin());

const COOKIES_PATH = path.join(process.cwd(), ".tiktok-session.json");
const UPLOAD_URL = "https://www.tiktok.com/creator-center/upload";
const LOGIN_URL = "https://www.tiktok.com/login/phone-or-email/email";
const CHROME_DEBUG_PORT = parseInt(process.env.CHROME_DEBUG_PORT ?? "9222", 10);

// Persists across hot-reloads
const g = globalThis as typeof globalThis & {
  __tiktokLoginPromise?: Promise<void>;
  __tiktokSessionValid?: boolean;
};

export type PostParams = {
  filePath: string;
  title: string;
  hashtags: string[];
  scheduledDate?: string; // datetime-local format: "YYYY-MM-DDTHH:mm"
  email: string;
  password: string;
  headless?: boolean;
  log?: (msg: string) => void;
};

export async function postToTikTok(params: PostParams): Promise<void> {
  const log = params.log ?? (() => {});
  const uploadHeadless = params.headless ?? (process.env.PUPPETEER_HEADLESS !== "false");

  // Phase 1: guarantee a valid session.
  // Login browser is ALWAYS visible so the user can handle CAPTCHAs / 2FA.
  // Only one job runs this at a time; the rest wait and reuse the saved cookies.
  await ensureValidSession(params.email, params.password, log);

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

    log("Aguardando iframe de upload...");
    const frame = await getUploadFrame(page);
    await humanDelay(800, 1_800);

    log("Enviando arquivo de vídeo...");
    await uploadFile(frame, params.filePath);
    await humanDelay(1_000, 2_000);

    log("Aguardando processamento do vídeo...");
    await waitForProcessing(frame);
    log("Vídeo processado com sucesso.");
    await humanDelay(1_200, 2_500);

    log("Preenchendo legenda...");
    await fillCaption(frame, buildCaption(params.title, params.hashtags));
    log("Legenda preenchida.");
    await humanDelay(800, 1_600);

    if (params.scheduledDate) {
      log(`Configurando agendamento para ${params.scheduledDate}...`);
      await setSchedule(frame, params.scheduledDate);
      log("Agendamento configurado.");
      await humanDelay(800, 1_500);
    } else {
      log("Sem data de agendamento — publicará imediatamente.");
    }

    log("Clicando em Publicar...");
    await humanDelay(600, 1_200);
    await submitPost(frame);
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

async function ensureValidSession(
  email: string,
  password: string,
  log: (m: string) => void
): Promise<void> {
  // Session already confirmed valid this server lifecycle
  if (g.__tiktokSessionValid) {
    log("Sessão ativa.");
    return;
  }

  // Another job is logging in — wait and reuse its cookies
  if (g.__tiktokLoginPromise) {
    log("Aguardando login de outro vídeo...");
    await g.__tiktokLoginPromise;
    return;
  }

  // Check saved cookies before opening any browser
  if (hasValidSessionCookies()) {
    log("Cookies de sessão válidos.");
    g.__tiktokSessionValid = true;
    return;
  }

  // Need to login — acquire lock, open a VISIBLE Chrome tab (user may need to solve CAPTCHA)
  log("Sessão expirada. Abrindo aba de login no Chrome...");
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
        await doLogin(loginPage, email, password, log);
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

// ─── Login ────────────────────────────────────────────────────────────────────

async function doLogin(
  page: Page,
  email: string,
  password: string,
  log: (msg: string) => void
): Promise<void> {
  log("Acessando página de login...");
  await page.goto(LOGIN_URL, { waitUntil: "networkidle2", timeout: 60_000 });
  await humanDelay(1_200, 2_500);

  await page.waitForSelector('input[name="username"]', { timeout: 20_000 });
  await humanDelay(400, 900);

  log("Digitando e-mail...");
  await humanType(page, 'input[name="username"]', email);
  await humanDelay(600, 1_400);

  log("Digitando senha...");
  await humanType(page, 'input[type="password"]', password);
  await humanDelay(700, 1_500);

  log("Clicando em entrar...");
  await page.click('button[type="submit"], [data-e2e="login-button"]');
  await humanDelay(500, 1_000);

  log("Aguardando redirecionamento pós-login...");
  await page.waitForFunction(
    () => !location.href.includes("login") && !location.href.includes("passport"),
    { timeout: 60_000, polling: 500 }
  );
  log("Login realizado com sucesso.");
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

// ─── Submit ───────────────────────────────────────────────────────────────────

async function submitPost(frame: Frame): Promise<void> {
  const btn = await frame.waitForSelector(
    '[data-e2e="post-button"]:not([disabled]), ' +
    'button[class*="post-btn"]:not([disabled]), ' +
    'button[class*="submit"]:not([disabled])',
    { timeout: 15_000 }
  );
  if (!btn) throw new Error("Post button not found");

  await humanDelay(400, 800);
  await btn.click();

  await frame.waitForFunction(
    () =>
      document.querySelector('[class*="success"]') !== null ||
      document.querySelector('[data-e2e="upload-success"]') !== null,
    { timeout: 60_000, polling: 1_500 }
  );
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
