// Automates the Kwai Android app via ADB (real device or emulator).
// Touch injection uses scrcpy-server to bypass Android 14+ INJECT_EVENTS restriction.

import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { scrcpyTap, scrcpyText, scrcpyStop } from "./scrcpy-control";

const execAsync = promisify(exec);

const ADB = (() => {
  const wingetPath =
    "C:\\Users\\Debroi\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe\\platform-tools\\adb.exe";
  if (fs.existsSync(wingetPath)) return `"${wingetPath}"`;
  return "adb";
})();

const KWAI_PACKAGE = "com.kwai.video";
const DEVICE_VIDEO_DIR = "/sdcard/DCIM/KwaiUpload";
const SCREENSHOTS_DIR = path.join(process.cwd(), "screenshots", "kwai");

export type KwaiAdbPostParams = {
  filePath: string;
  title: string;
  comment?: string;
  hashtags: string[];
  log?: (msg: string) => void;
};

// ─── Main export ──────────────────────────────────────────────────────────────

export async function postToKwaiAdb(params: KwaiAdbPostParams): Promise<void> {
  const log = params.log ?? (() => {});

  log("Verificando conexão ADB...");
  const device = await getConnectedDevice(log);
  log(`Dispositivo conectado: ${device}`);

  const { screenW, screenH } = await getScreenSize(device, log);
  log(`Resolução: ${screenW}x${screenH}`);

  const doTap = (cx: number, cy: number) => scrcpyTap(device, cx, cy, screenW, screenH, log);
  const doText = (text: string) => scrcpyText(device, text, screenW, screenH, log);

  // Attempt to grant media permissions (no-op on Android 15+ with locked-down builds)
  await grantMediaPermissions(device, log);

  try {
    // Push video file to device
    const remoteFile = `${DEVICE_VIDEO_DIR}/${path.basename(params.filePath)}`;
    log("Enviando vídeo para o dispositivo...");
    await adb(`-s ${device} shell mkdir -p ${DEVICE_VIDEO_DIR}`, log);
    await adb(`-s ${device} push "${params.filePath}" "${remoteFile}"`, log);
    await scanMedia(device, remoteFile, log);
    log("Vídeo enviado.");

    // Force-stop Kwai then relaunch clean
    log("Abrindo Kwai...");
    await adb(`-s ${device} shell am force-stop ${KWAI_PACKAGE}`, log);
    await delay(1_000);
    await adb(
      `-s ${device} shell am start -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -p ${KWAI_PACKAGE}`,
      log
    );
    await delay(3_000);
    await shot(device, "01-kwai-home", log);

    // Dismiss any startup dialogs
    await dismissAndroidPopups(device, doTap, log);
    await delay(500);

    // Tap the "+" / create button
    log("Procurando botão de criar...");
    await tapCreate(device, screenW, screenH, doTap, log);
    await delay(2_000);
    await shot(device, "02-after-create", log);

    // Select video from gallery
    log("Selecionando vídeo na galeria...");
    await selectVideo(device, path.basename(params.filePath), screenW, screenH, doTap, log);
    await delay(2_000);
    await shot(device, "03-video-selected", log);

    // Tap Next / Avançar
    log("Avançando...");
    await tapByTexts(device, ["Next", "Próximo", "Avançar", "下一步", "다음"], doTap, log);
    await delay(2_000);
    await shot(device, "04-edit-screen", log);

    // Fill caption: title + hashtags
    const caption = buildCaption(params.title, params.hashtags, params.comment);
    log("Preenchendo legenda...");
    await fillCaption(device, caption, doTap, doText, log);
    await delay(1_000);

    // Tap Publish
    log("Clicando em Publicar...");
    await tapByTexts(device, ["Publicar", "Post", "Publish", "发布", "게시", "Postar"], doTap, log);

    // Wait for publish confirmation — the app returns to home feed on success
    log("Aguardando confirmação de publicação...");
    const published = await waitForHomeScreen(device, log);
    await shot(device, "05-after-publish", log);

    if (!published) {
      throw new Error("Publicação não confirmada — verifique o screenshot 05-after-publish.");
    }

    log("Publicado com sucesso!");

    // Clean up remote file
    await adb(`-s ${device} shell rm "${remoteFile}"`, log).catch(() => {});
  } finally {
    scrcpyStop(device);
  }
}

// ─── Media permissions ────────────────────────────────────────────────────────

async function grantMediaPermissions(device: string, log: (m: string) => void): Promise<void> {
  const perms = [
    "android.permission.READ_MEDIA_VIDEO",
    "android.permission.READ_MEDIA_IMAGES",
    "android.permission.READ_EXTERNAL_STORAGE",
    "android.permission.WRITE_EXTERNAL_STORAGE",
  ];
  for (const perm of perms) {
    try {
      await adb(`-s ${device} shell pm grant ${KWAI_PACKAGE} ${perm}`, log);
    } catch { /* permission may not exist on this Android version — ignore */ }
  }
  // Override partial-access limitation (Android 14+)
  try {
    await adb(`-s ${device} shell appops set ${KWAI_PACKAGE} READ_MEDIA_VISUAL_USER_SELECTED deny`, log);
  } catch { /* ignore */ }
}

// ─── Success detection ────────────────────────────────────────────────────────

async function waitForHomeScreen(device: string, log: (m: string) => void): Promise<boolean> {
  const POSTING_KEYWORDS = ["upload", "create", "edit", "publish", "record", "post", "draft"];

  for (let i = 0; i < 20; i++) {
    await delay(3_000);
    try {
      // Avoid relying on `grep` — filter in JS instead (grep may be absent on some Android builds).
      const dump = await adb(`-s ${device} shell dumpsys activity activities`, log);
      const resumedLine = dump
        .split("\n")
        .find((l) => l.includes("mResumedActivity") || l.includes("ResumedActivity"));

      if (resumedLine) {
        log(`Activity atual: ${resumedLine.trim()}`);

        const inKwai = resumedLine.includes("kwai.video") || resumedLine.includes(KWAI_PACKAGE);
        const inPosting = POSTING_KEYWORDS.some((kw) => resumedLine.toLowerCase().includes(kw));

        // Explicitly in a home/feed activity
        if (
          resumedLine.includes("MainActivity") ||
          resumedLine.includes("HomeActivity") ||
          resumedLine.includes("FeedActivity") ||
          resumedLine.includes("/.main") ||
          resumedLine.includes("/main.")
        ) {
          return true;
        }

        // In Kwai but no longer in a posting flow — treat as success
        if (inKwai && !inPosting) return true;
      }

      // Fallback: check UI for post-success or home-screen elements
      try {
        const xml = await adb(`-s ${device} shell uiautomator dump /sdcard/ui_dump.xml && cat /sdcard/ui_dump.xml`, log);
        if (
          xml.includes("Seguindo") || xml.includes("Para você") ||
          xml.includes("Following") || xml.includes("For You") ||
          xml.includes("Descobrir") || xml.includes("Discover")
        ) {
          return true;
        }
      } catch { /* ignore UI dump errors */ }
    } catch { /* ignore */ }

    log(`Aguardando feed de início... (${i + 1}/20)`);
  }
  return false;
}

// ─── ADB helpers ──────────────────────────────────────────────────────────────

async function adb(args: string, log: (m: string) => void): Promise<string> {
  try {
    const { stdout } = await execAsync(`${ADB} ${args}`, { timeout: 60_000 });
    return stdout.trim();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`adb ${args.split(" ")[0]}: ${msg}`);
  }
}

async function getConnectedDevice(log: (m: string) => void): Promise<string> {
  const output = await adb("devices", log);
  const lines = output.split("\n").slice(1).filter((l) => l.includes("\tdevice"));
  if (!lines.length) {
    throw new Error(
      "Nenhum dispositivo conectado via ADB. " +
      "Conecte o celular via USB e ative 'Depuração USB' em Configurações > Opções do desenvolvedor."
    );
  }
  return lines[0].split("\t")[0].trim();
}

async function getScreenSize(device: string, log: (m: string) => void): Promise<{ screenW: number; screenH: number }> {
  try {
    const output = await adb(`-s ${device} shell wm size`, log);
    const m = output.match(/(\d+)x(\d+)/);
    if (m) return { screenW: parseInt(m[1]), screenH: parseInt(m[2]) };
  } catch { /* ignore */ }
  return { screenW: 1080, screenH: 1920 }; // fallback
}

async function scanMedia(device: string, remotePath: string, log: (m: string) => void): Promise<void> {
  // Legacy broadcast (Android < 10); may exit non-zero on newer versions — ignore failures.
  try {
    await adb(
      `-s ${device} shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE ` +
      `-d "file://${remotePath}"`,
      log
    );
  } catch {
    // Fallback for Android 10+: rescan the whole external volume.
    try {
      await adb(`-s ${device} shell content call --uri content://media --method scan_volume --arg external`, log);
    } catch { /* media scan is best-effort */ }
  }
  await delay(1_500);
}

async function shot(device: string, label: string, log: (m: string) => void): Promise<void> {
  try {
    if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    const remote = `/sdcard/screen_${Date.now()}.png`;
    await adb(`-s ${device} shell screencap -p ${remote}`, log);
    const local = path.join(SCREENSHOTS_DIR, `${Date.now()}-${label}.png`);
    await adb(`-s ${device} pull ${remote} "${local}"`, log);
    await adb(`-s ${device} shell rm ${remote}`, log);
    log(`📸 ${local}`);
  } catch { /* não bloqueia */ }
}

// ─── UI interaction ───────────────────────────────────────────────────────────

async function uiDump(device: string, log: (m: string) => void): Promise<string> {
  await adb(`-s ${device} shell uiautomator dump /sdcard/ui_dump.xml`, log);
  const xml = await adb(`-s ${device} shell cat /sdcard/ui_dump.xml`, log);
  return xml;
}

function parseBounds(boundsStr: string): { cx: number; cy: number } | null {
  const m = boundsStr.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!m) return null;
  return {
    cx: Math.round((parseInt(m[1]) + parseInt(m[3])) / 2),
    cy: Math.round((parseInt(m[2]) + parseInt(m[4])) / 2),
  };
}

function findElementByText(xml: string, texts: string[]): { cx: number; cy: number } | null {
  for (const text of texts) {
    const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`text="${escaped}"[^>]*bounds="([^"]+)"`, "i");
    const m = xml.match(re);
    if (m) return parseBounds(m[1]);
  }
  return null;
}

function findElementByDesc(xml: string, descs: string[]): { cx: number; cy: number } | null {
  for (const desc of descs) {
    const escaped = desc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`content-desc="${escaped}"[^>]*bounds="([^"]+)"`, "i");
    const m = xml.match(re);
    if (m) return parseBounds(m[1]);
  }
  return null;
}

async function tap(
  doTap: (cx: number, cy: number) => Promise<void>,
  cx: number,
  cy: number
): Promise<void> {
  await doTap(cx, cy);
  await delay(500);
}

async function tapByTexts(
  device: string,
  texts: string[],
  doTap: (cx: number, cy: number) => Promise<void>,
  log: (m: string) => void
): Promise<boolean> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const xml = await uiDump(device, log);
    const pos = findElementByText(xml, texts) ?? findElementByDesc(xml, texts);
    if (pos) {
      await tap(doTap, pos.cx, pos.cy);
      log(`Tapped: ${texts[0]}`);
      return true;
    }
    await delay(1_500);
  }
  log(`Elemento não encontrado: ${texts.join(" | ")}`);
  return false;
}

async function tapCreate(
  device: string,
  screenW: number,
  screenH: number,
  doTap: (cx: number, cy: number) => Promise<void>,
  log: (m: string) => void
): Promise<void> {
  const found = await tapByTexts(device, ["+", "Create", "Criar", "Add", "camera", "record"], doTap, log);
  if (found) return;

  // Fallback: center-bottom (common location for "+" in short video apps)
  await tap(doTap, Math.round(screenW / 2), Math.round(screenH * 0.93));
  log("Tapped center-bottom (create fallback).");
}

async function selectVideo(
  device: string,
  filename: string,
  screenW: number,
  screenH: number,
  doTap: (cx: number, cy: number) => Promise<void>,
  log: (m: string) => void
): Promise<void> {
  await delay(1_500);
  const xml = await uiDump(device, log);

  // Detect "gallery empty / no permission" screen and abort early
  if (
    xml.includes("Nenhuma foto encontrada") ||
    xml.includes("No photos found") ||
    xml.includes("Definir agora") ||
    xml.includes("autorizou apenas algumas")
  ) {
    throw new Error(
      "Kwai não tem acesso à galeria. No celular: Configurações → Apps → Kwai → Permissões → Fotos e vídeos → Permitir acesso a todas as mídias."
    );
  }

  const byName = await tapByTexts(device, [filename, filename.replace(/\.[^.]+$/, "")], doTap, log);
  if (byName) return;

  const galleryRe = /class="android\.widget\.(ImageView|FrameLayout)"[^>]*bounds="(\[\d+,\d+\]\[\d+,\d+\])"/g;
  let best: { cx: number; cy: number } | null = null;
  let match: RegExpExecArray | null;
  while ((match = galleryRe.exec(xml)) !== null) {
    const pos = parseBounds(match[2]);
    if (!pos) continue;
    if (!best || pos.cx + pos.cy < best.cx + best.cy) best = pos;
  }

  if (best) {
    await tap(doTap, best.cx, best.cy);
    log("Primeiro vídeo da galeria selecionado.");
  } else {
    log("Vídeo não encontrado na galeria — verifique screenshot 02-after-create.");
  }
}

async function fillCaption(
  device: string,
  text: string,
  doTap: (cx: number, cy: number) => Promise<void>,
  doText: (t: string) => Promise<void>,
  log: (m: string) => void
): Promise<void> {
  const xml = await uiDump(device, log);
  const editRe = /class="android\.widget\.EditText"[^>]*bounds="(\[\d+,\d+\]\[\d+,\d+\])"/g;
  const m = editRe.exec(xml);

  if (m) {
    const pos = parseBounds(m[1]);
    if (pos) {
      await tap(doTap, pos.cx, pos.cy);
      await delay(500);
    }
  } else {
    const hintPos = findElementByText(xml, ["Adicionar legenda", "Add a caption", "Write a caption", "Caption"]);
    if (hintPos) await tap(doTap, hintPos.cx, hintPos.cy);
  }

  await delay(500);
  await doText(text);
  log("Legenda preenchida.");
}

async function dismissAndroidPopups(
  device: string,
  doTap: (cx: number, cy: number) => Promise<void>,
  log: (m: string) => void
): Promise<void> {
  const dismissTexts = ["OK", "Allow", "Permitir", "Aceitar", "Got it", "Entendi", "Later", "Agora não", "Skip"];
  try {
    const xml = await uiDump(device, log);
    for (const text of dismissTexts) {
      const pos = findElementByText(xml, [text]);
      if (pos) {
        await tap(doTap, pos.cx, pos.cy);
        log(`Popup dispensado: ${text}`);
        await delay(500);
        break;
      }
    }
  } catch { /* ignore */ }
}

// ─── Caption builder ──────────────────────────────────────────────────────────

function buildCaption(title: string, hashtags: string[], comment?: string): string {
  const tags = hashtags.map((t) => `#${t.replace(/^#+/, "")}`).join(" ");
  const parts = [title, tags];
  return parts.filter(Boolean).join(" ").trim();
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
