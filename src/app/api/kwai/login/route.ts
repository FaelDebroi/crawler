import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";

const execAsync = promisify(exec);

const ADB = (() => {
  const wingetPath =
    "C:\\Users\\Debroi\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe\\platform-tools\\adb.exe";
  if (fs.existsSync(wingetPath)) return `"${wingetPath}"`;
  return "adb";
})();

export async function GET() {
  try {
    const { stdout } = await execAsync(`${ADB} devices`, { timeout: 5_000 });
    const devices = stdout
      .split("\n")
      .slice(1)
      .filter((l) => l.includes("\tdevice"))
      .map((l) => l.split("\t")[0].trim());

    return NextResponse.json({ connected: devices.length > 0, devices });
  } catch {
    return NextResponse.json({ connected: false, devices: [], error: "ADB não encontrado ou nenhum dispositivo conectado." });
  }
}
