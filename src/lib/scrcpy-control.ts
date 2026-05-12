// Uses scrcpy-server (app_process) to inject touch and text events on Android 14+
// where adb shell input tap is blocked by INJECT_EVENTS restriction.

import { exec, spawn, ChildProcess } from "child_process";
import { promisify } from "util";
import net from "net";

const execAsync = promisify(exec);

const ADB =
  "C:\\Users\\Debroi\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe\\platform-tools\\adb.exe";

const SCRCPY_SERVER =
  "C:\\Users\\Debroi\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Genymobile.scrcpy_Microsoft.Winget.Source_8wekyb3d8bbwe\\scrcpy-win64-v3.3.4\\scrcpy-server";

const SCRCPY_VERSION = "3.3.4";
const CONTROL_PORT = 27183;

// Control message types
const MSG_INJECT_TEXT = 0;
const MSG_INJECT_TOUCH = 2;
const ACTION_DOWN = 0;
const ACTION_UP = 1;

type ScrcpyState = {
  socket: net.Socket;
  proc: ChildProcess;
  screenW: number;
  screenH: number;
};

// Module-level singleton — one server per device
const activeServers = new Map<string, ScrcpyState>();

async function adbCmd(args: string): Promise<string> {
  const { stdout } = await execAsync(`"${ADB}" ${args}`, { timeout: 30_000 });
  return stdout.trim();
}

async function ensureServer(
  deviceId: string,
  screenW: number,
  screenH: number,
  log: (m: string) => void
): Promise<ScrcpyState> {
  const existing = activeServers.get(deviceId);
  if (existing) return existing;

  log("Iniciando servidor scrcpy no dispositivo...");
  await adbCmd(`-s ${deviceId} push "${SCRCPY_SERVER}" /data/local/tmp/scrcpy-server.jar`);
  await adbCmd(`-s ${deviceId} forward tcp:${CONTROL_PORT} localabstract:scrcpy`);

  const shellCmd =
    `CLASSPATH=/data/local/tmp/scrcpy-server.jar app_process / ` +
    `com.genymobile.scrcpy.Server ${SCRCPY_VERSION} ` +
    `log_level=info video=false audio=false control=true tunnel_forward=true`;

  const proc = spawn(`"${ADB}"`, ["-s", deviceId, "shell", shellCmd], {
    shell: true,
    stdio: "pipe",
  });

  // Give the server time to bind
  await new Promise((r) => setTimeout(r, 1_500));

  const socket = await connectSocket();
  log("Servidor scrcpy conectado.");

  const state: ScrcpyState = { socket, proc, screenW, screenH };
  activeServers.set(deviceId, state);

  socket.on("close", () => activeServers.delete(deviceId));
  socket.on("error", () => activeServers.delete(deviceId));

  return state;
}

function connectSocket(): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const sock = new net.Socket();
    sock.connect(CONTROL_PORT, "127.0.0.1");

    const timeout = setTimeout(() => {
      sock.destroy();
      reject(new Error("scrcpy control socket connection timeout"));
    }, 5_000);

    sock.once("connect", () => {
      // Drain the 64-byte device-name header the server sends
      const drain = (data: Buffer) => {
        clearTimeout(timeout);
        sock.removeListener("data", drain);
        resolve(sock);
      };
      sock.once("data", drain);
      // If server sends nothing within 1s, proceed anyway
      setTimeout(() => {
        clearTimeout(timeout);
        sock.removeListener("data", drain);
        resolve(sock);
      }, 1_000);
    });

    sock.once("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function makeTouchMsg(
  action: number,
  x: number,
  y: number,
  screenW: number,
  screenH: number
): Buffer {
  const buf = Buffer.alloc(32);
  let o = 0;
  buf.writeUInt8(MSG_INJECT_TOUCH, o++);
  buf.writeUInt8(action, o++);
  buf.fill(0xff, o, o + 8); o += 8; // pointerId = -1 (virtual finger)
  buf.writeInt32BE(x, o); o += 4;
  buf.writeInt32BE(y, o); o += 4;
  buf.writeUInt16BE(screenW, o); o += 2;
  buf.writeUInt16BE(screenH, o); o += 2;
  buf.writeUInt16BE(action === ACTION_DOWN ? 0xffff : 0, o); o += 2; // pressure
  buf.writeInt32BE(0, o); o += 4; // actionButton
  buf.writeInt32BE(0, o);         // buttons
  return buf;
}

function makeTextMsg(text: string): Buffer {
  const encoded = Buffer.from(text, "utf8");
  const buf = Buffer.alloc(1 + 4 + encoded.length);
  let o = 0;
  buf.writeUInt8(MSG_INJECT_TEXT, o++);
  buf.writeUInt32BE(encoded.length, o); o += 4;
  encoded.copy(buf, o);
  return buf;
}

export async function scrcpyTap(
  deviceId: string,
  x: number,
  y: number,
  screenW: number,
  screenH: number,
  log: (m: string) => void
): Promise<void> {
  const state = await ensureServer(deviceId, screenW, screenH, log);
  state.socket.write(makeTouchMsg(ACTION_DOWN, x, y, screenW, screenH));
  await new Promise((r) => setTimeout(r, 60));
  state.socket.write(makeTouchMsg(ACTION_UP, x, y, screenW, screenH));
  await new Promise((r) => setTimeout(r, 60));
}

export async function scrcpyText(
  deviceId: string,
  text: string,
  screenW: number,
  screenH: number,
  log: (m: string) => void
): Promise<void> {
  const state = await ensureServer(deviceId, screenW, screenH, log);
  state.socket.write(makeTextMsg(text));
}

export function scrcpyStop(deviceId: string): void {
  const state = activeServers.get(deviceId);
  if (!state) return;
  state.socket.destroy();
  state.proc.kill();
  activeServers.delete(deviceId);
}
