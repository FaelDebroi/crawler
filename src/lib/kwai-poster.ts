import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Page, Frame, ElementHandle } from "puppeteer";
import path from "path";
import fs from "fs";
import os from "os";

puppeteerExtra.use(StealthPlugin());

const COOKIES_PATH = path.join(process.cwd(), ".kwai-session.json");
const SCREENSHOTS_DIR = path.join(process.cwd(), "screenshots", "kwai");
const BASE_URL = "https://cp.kwai.com";
const LOGIN_URL = `${BASE_URL}/login`;
const CHROME_DEBUG_PORT = parseInt(process.env.CHROME_DEBUG_PORT ?? "9222", 10);

const g = globalThis as typeof globalThis & {
  __kwaiLoginPromise?: Promise<void>;
  __kwaiSessionValid?: boolean;
};

export type KwaiPostParams = {
  filePath: string;
  title: string;
  comment?: string;
  hashtags: string[];
  headless?: boolean;
  log?: (msg: string) => void;
};

async function shot(page: Page, label: string, log: (m: string) => void): Promise<void> {
  try {
    if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    const file = path.join(SCREENSHOTS_DIR, `${Date.now()}-${label}.png`);
    await page.screenshot({ path: file, fullPage: true });
    log(`📸 ${file}`);
  } catch { /* não bloqueia */ }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function postToKwai(params: KwaiPostParams): Promise<void> {
  const log = params.log ?? (() => {});
  const headless = params.headless ?? (process.env.PUPPETEER_HEADLESS !== "false");

  await ensureSession(log);

  log("Conectando ao Chrome para upload...");
  const handle = await connectOrLaunch(headless);
  const page = await handle.browser.newPage();

  try {
    await loadCookies(page);

    log("Abrindo Kwai Creator Platform...");
    await page.goto(BASE_URL, { waitUntil: "networkidle2", timeout: 60_000 });
    await humanDelay(1_500, 3_000);
    await shot(page, "01-home-page", log);

    if (onLoginPage(page)) {
      g.__kwaiSessionValid = false;
      throw new Error("Sessão inválida. Clique em 'Fazer Login' na página do Kwai antes de postar.");
    }

    await dismissPopups(page, log);

    log("Procurando botão de upload...");
    await navigateToUpload(page, log);
    await shot(page, "02-upload-page", log);
    await humanDelay(1_000, 2_000);

    log("Enviando arquivo de vídeo...");
    await uploadFile(page, params.filePath, log);
    await humanDelay(1_000, 2_000);

    log("Aguardando processamento do vídeo...");
    await waitForProcessing(page, log);
    await dismissPopups(page, log);
    await shot(page, "03-after-processing", log);
    await humanDelay(1_000, 2_000);

    log("Preenchendo título...");
    await fillTitle(page, params.title, log);
    await humanDelay(600, 1_200);

    if (params.hashtags.length) {
      log("Adicionando hashtags...");
      await fillHashtags(page, params.hashtags, log);
      await humanDelay(600, 1_200);
    }

    if (params.comment?.trim()) {
      log("Preenchendo comentário...");
      await fillComment(page, params.comment.trim(), log);
      await humanDelay(600, 1_200);
    }

    await dismissPopups(page, log);
    await shot(page, "03-before-submit", log);

    log("Clicando em Publicar...");
    await humanDelay(600, 1_200);
    await submitPost(page, log);
    log("Publicado com sucesso!");

    await persistCookies(page);
  } finally {
    await releaseBrowser(handle, page);
    try { fs.unlinkSync(params.filePath); } catch { /* ignore */ }
  }
}

// ─── Session ──────────────────────────────────────────────────────────────────

function onLoginPage(page: Page): boolean {
  const url = page.url();
  return (
    url.includes("login") ||
    url.includes("passport") ||
    url.includes("signin") ||
    url.includes("register") ||
    // Kwai redirects unauthenticated users to /user/login
    url.includes("/user/login")
  );
}

async function navigateToUpload(page: Page, log: (m: string) => void): Promise<void> {
  // Try known Kwai upload paths first
  const uploadPaths = [
    "/work/publish/video",
    "/creator/video/publish",
    "/creator/publish",
    "/publish/video",
    "/upload",
  ];

  for (const p of uploadPaths) {
    try {
      const url = `${BASE_URL}${p}`;
      log(`Tentando ${url}...`);
      await page.goto(url, { waitUntil: "networkidle2", timeout: 15_000 });
      await humanDelay(800, 1_500);
      if (!onLoginPage(page)) {
        const hasInput = await page.$('input[type="file"]');
        const hasUploadArea = await page.$('[class*="upload"], [class*="Upload"]');
        if (hasInput || hasUploadArea) {
          log(`Página de upload encontrada em: ${url}`);
          return;
        }
      }
    } catch { /* try next */ }
  }

  // Fallback: look for an upload/publish button on the home page
  await page.goto(BASE_URL, { waitUntil: "networkidle2", timeout: 30_000 });
  await humanDelay(1_000, 2_000);

  const clicked = await page.evaluate(() => {
    const keywords = /upload|publish|post|publicar|postar|发布|créer|créer/i;
    const btns = Array.from(document.querySelectorAll<HTMLElement>("a, button, [role='button']"));
    const btn = btns.find((el) => keywords.test(el.textContent ?? "") || keywords.test(el.getAttribute("href") ?? ""));
    if (btn) { (btn as HTMLElement).click(); return true; }
    return false;
  });

  if (clicked) {
    await humanDelay(1_500, 2_500);
    log("Botão de upload clicado na home.");
  } else {
    await shot(page, "warn-no-upload-btn", log);
    log("Botão de upload não encontrado — tentando continuar mesmo assim.");
  }
}

// Public: called by the /api/kwai/login route to force a QR login
export async function startKwaiLogin(log: (m: string) => void): Promise<void> {
  // Clear cached state so ensureSession runs the full login flow
  g.__kwaiSessionValid = false;
  if (fs.existsSync(COOKIES_PATH)) fs.unlinkSync(COOKIES_PATH);
  await ensureSession(log);
}

async function ensureSession(log: (m: string) => void): Promise<void> {
  if (g.__kwaiSessionValid) { log("Sessão Kwai ativa."); return; }

  if (g.__kwaiLoginPromise) {
    log("Aguardando login de outro job...");
    await g.__kwaiLoginPromise;
    return;
  }

  if (hasValidCookies()) {
    log("Cookies Kwai válidos.");
    g.__kwaiSessionValid = true;
    return;
  }

  log("Sessão expirada. Abrindo navegador — escaneie o QR Code do Kwai com o celular...");
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  g.__kwaiLoginPromise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });

  try {
    const handle = await connectOrLaunch(false);
    const loginPage = await handle.browser.newPage();
    try {
      await loadCookies(loginPage);
      await loginPage.goto(BASE_URL, { waitUntil: "networkidle2", timeout: 60_000 });
      await humanDelay(1_500, 3_000);

      if (onLoginPage(loginPage)) {
        await doQRLogin(loginPage, log);
      } else {
        log("Cookies ainda válidos.");
      }

      await persistCookies(loginPage);
      g.__kwaiSessionValid = true;
    } finally {
      await releaseBrowser(handle, loginPage);
    }
    log("Sessão Kwai salva.");
    resolve();
  } catch (e) {
    g.__kwaiSessionValid = false;
    reject(e);
    throw e;
  } finally {
    g.__kwaiLoginPromise = undefined;
  }
}

async function doQRLogin(page: Page, log: (m: string) => void): Promise<void> {
  log("Abrindo página de login Kwai...");
  await page.goto(LOGIN_URL, { waitUntil: "networkidle2", timeout: 60_000 });
  await humanDelay(1_000, 2_000);

  // Try to click QR code tab if available
  try {
    const qrTab = await page.$(
      '[data-testid="qrcode-tab"], [class*="qrcode"], [class*="qr-code"], ' +
      'a[href*="qrcode"], button[class*="qr"]'
    );
    if (qrTab) { await qrTab.click(); await humanDelay(800, 1_500); }
  } catch { /* ignore */ }

  await shot(page, "login-qr", log);
  log("QR Code visível no navegador — escaneie com o app do Kwai no celular.");
  log("Aguardando confirmação do login (até 3 minutos)...");

  await page.waitForFunction(
    () =>
      !location.href.includes("login") &&
      !location.href.includes("passport") &&
      !location.href.includes("signin"),
    { timeout: 180_000, polling: 1_000 }
  );

  log("Login Kwai realizado com sucesso!");
  await humanDelay(1_000, 2_000);
}

function hasValidCookies(): boolean {
  if (!fs.existsSync(COOKIES_PATH)) return false;
  try {
    const cookies: Array<{ name: string; expires?: number; domain?: string }> =
      JSON.parse(fs.readFileSync(COOKIES_PATH, "utf-8"));
    const session = cookies.find(
      (c) =>
        (c.name === "sid" || c.name === "sessionid" || c.name === "kpf_access_token" || c.name === "userId") &&
        c.domain?.includes("kwai.com")
    );
    if (!session) return false;
    if (!session.expires || session.expires === -1) return true;
    return session.expires * 1000 > Date.now() + 5 * 60 * 1000;
  } catch { return false; }
}

// ─── Upload ───────────────────────────────────────────────────────────────────

async function uploadFile(page: Page, filePath: string, log: (m: string) => void): Promise<void> {
  const selectors = [
    'input[type="file"]',
    '[data-testid="upload-input"]',
    '[class*="upload"] input',
  ];

  let input: ElementHandle<HTMLInputElement> | null = null;
  for (const sel of selectors) {
    try {
      input = await page.waitForSelector(sel, { timeout: 8_000 }) as ElementHandle<HTMLInputElement>;
      if (input) break;
    } catch { /* try next */ }
  }

  if (!input) {
    await shot(page, "error-no-file-input", log);
    throw new Error("Input de arquivo não encontrado na página de upload do Kwai");
  }

  await humanDelay(300, 700);
  await input.uploadFile(filePath);
}

async function waitForProcessing(page: Page, log: (m: string) => void): Promise<void> {
  log("Aguardando Kwai processar o vídeo (pode levar 1-2 min)...");
  await page.waitForFunction(
    () => {
      const busy =
        document.querySelector('[class*="uploading"]') ||
        document.querySelector('[class*="processing"]') ||
        document.querySelector('[class*="loading"]');
      const ready =
        document.querySelector('input[placeholder*="ítulo"], input[placeholder*="itle"]') ||
        document.querySelector('textarea[placeholder*="ítulo"], textarea[placeholder*="itle"]') ||
        document.querySelector('[contenteditable="true"]') ||
        document.querySelector('[data-testid="title-input"]') ||
        document.querySelector('[class*="title-input"]');
      return !busy && !!ready;
    },
    { timeout: 120_000, polling: 2_000 }
  );
}

// ─── Metadata ─────────────────────────────────────────────────────────────────

async function fillTitle(page: Page, title: string, log: (m: string) => void): Promise<void> {
  const selectors = [
    '[data-testid="title-input"]',
    '[class*="title-input"]',
    'input[placeholder*="ítulo"]',
    'input[placeholder*="itle"]',
    'textarea[placeholder*="ítulo"]',
    'textarea[placeholder*="itle"]',
  ];

  for (const sel of selectors) {
    const el = await page.$(sel);
    if (el) {
      await el.click({ clickCount: 3 });
      await humanDelay(200, 400);
      await el.type(title, { delay: 40 + Math.random() * 40 });
      log(`Título preenchido.`);
      return;
    }
  }
  log("Campo de título não encontrado — verifique screenshot 03-before-submit.");
}

async function fillHashtags(page: Page, hashtags: string[], log: (m: string) => void): Promise<void> {
  const selectors = [
    '[data-testid="hashtag-input"]',
    '[class*="hashtag"] input',
    '[class*="tag"] input',
    'input[placeholder*="hashtag"], input[placeholder*="tag"], input[placeholder*="#"]',
  ];

  for (const sel of selectors) {
    const el = await page.$(sel);
    if (el) {
      for (const tag of hashtags) {
        await el.click();
        await humanDelay(200, 400);
        await el.type(`#${tag.replace(/^#+/, "")} `, { delay: 40 + Math.random() * 30 });
        await humanDelay(300, 600);
      }
      log(`Hashtags adicionadas.`);
      return;
    }
  }

  // Fallback: type hashtags into caption/description field
  const captionSel = [
    '[data-testid="caption-input"]',
    '[class*="caption"] [contenteditable="true"]',
    '[class*="description"] textarea',
    'textarea[placeholder*="escrição"], textarea[placeholder*="escription"]',
  ];
  for (const sel of captionSel) {
    const el = await page.$(sel);
    if (el) {
      await el.click();
      await humanDelay(200, 400);
      const tagStr = hashtags.map((t) => `#${t.replace(/^#+/, "")}`).join(" ");
      await el.type(` ${tagStr}`, { delay: 40 + Math.random() * 30 });
      log("Hashtags adicionadas na legenda.");
      return;
    }
  }

  log("Campo de hashtag não encontrado — verifique screenshot 03-before-submit.");
}

async function fillComment(page: Page, comment: string, log: (m: string) => void): Promise<void> {
  const selectors = [
    '[data-testid="comment-input"]',
    '[data-testid="first-comment-input"]',
    '[class*="comment"] textarea',
    '[class*="comment"] [contenteditable="true"]',
    '[class*="first-comment"]',
    'textarea[placeholder*="omentário"], textarea[placeholder*="omment"]',
  ];

  for (const sel of selectors) {
    const el = await page.$(sel);
    if (el) {
      await el.click();
      await humanDelay(300, 600);
      await el.type(comment, { delay: 40 + Math.random() * 40 });
      log("Comentário preenchido.");
      return;
    }
  }
  log("Campo de comentário não encontrado — verifique screenshot 03-before-submit.");
}

// ─── Popups ───────────────────────────────────────────────────────────────────

async function dismissPopups(page: Page, log: (m: string) => void): Promise<void> {
  const dismissed = await page.evaluate(() => {
    const found: string[] = [];
    const DISMISS = ["cancel", "got it", "later", "not now", "skip", "fechar", "close", "ok", "entendido", "confirm"];

    const containers = Array.from(document.querySelectorAll<HTMLElement>(
      '[role="dialog"], [class*="modal"], [class*="Modal"], [class*="overlay"], [class*="Overlay"], [class*="popup"], [class*="Popup"], [class*="dialog"]'
    ));

    for (const container of containers) {
      for (const btn of Array.from(container.querySelectorAll<HTMLButtonElement>("button"))) {
        const txt = (btn.textContent ?? "").trim().toLowerCase();
        if (DISMISS.includes(txt) && (btn as HTMLElement).offsetParent !== null) {
          btn.click();
          found.push(txt);
        }
      }
      for (const btn of Array.from(container.querySelectorAll<HTMLButtonElement>(
        'button[aria-label*="lose"], button[aria-label*="echar"], button[class*="close"], button[class*="Close"]'
      ))) {
        if ((btn as HTMLElement).offsetParent !== null) {
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

async function findPublishButton(page: Page): Promise<ElementHandle<HTMLButtonElement> | null> {
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    for (const sel of [
      '[data-testid="publish-button"]',
      '[data-testid="post-button"]',
      '[data-testid="submit-button"]',
      'button[class*="publish"]',
      'button[class*="post-btn"]',
      'button[class*="submit"]',
    ]) {
      const el = await page.$(sel) as ElementHandle<HTMLButtonElement> | null;
      if (el) {
        const disabled = await el.evaluate((b) => (b as HTMLButtonElement).disabled);
        if (!disabled) return el;
      }
    }

    const textBtn = await page.evaluateHandle(() => {
      const all = Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
      return (
        all.find(
          (b) =>
            !b.disabled &&
            /^(post|publicar|postar|publish|enviar|发布|확인)$/i.test((b.textContent ?? "").trim())
        ) ?? null
      );
    }) as ElementHandle<HTMLButtonElement> | null;
    if (textBtn) return textBtn;

    await new Promise((r) => setTimeout(r, 1_000));
  }
  return null;
}

async function submitPost(page: Page, log: (m: string) => void): Promise<void> {
  await dismissPopups(page, log);
  await humanDelay(300, 600);

  const btn = await findPublishButton(page);
  if (!btn) {
    await shot(page, "error-no-publish-btn", log);
    throw new Error("Botão de publicar não encontrado na página de upload do Kwai");
  }

  await humanDelay(400, 800);
  await btn.click();
  await humanDelay(1_000, 1_800);
  await dismissPopups(page, log);
  await humanDelay(500, 1_000);
  await shot(page, "04-after-click-publish", log);

  // Wait for redirect away from upload page
  await page.waitForFunction(
    () => !location.href.includes("/upload"),
    { timeout: 90_000, polling: 2_000 }
  );

  await shot(page, "05-success", log);
}

// ─── Browser ──────────────────────────────────────────────────────────────────

type BrowserHandle = {
  browser: Awaited<ReturnType<typeof puppeteerExtra.launch>>;
  owned: boolean;
};

async function connectOrLaunch(headless: boolean): Promise<BrowserHandle> {
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
  } catch { /* fall through */ }

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

// ─── Cookies ──────────────────────────────────────────────────────────────────

async function loadCookies(page: Page): Promise<void> {
  if (!fs.existsSync(COOKIES_PATH)) return;
  const saved = JSON.parse(fs.readFileSync(COOKIES_PATH, "utf-8"));
  await page.setCookie(...saved);
}

async function persistCookies(page: Page): Promise<void> {
  const cookies = await page.cookies();
  fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function humanDelay(min: number, max: number): Promise<void> {
  return new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));
}
