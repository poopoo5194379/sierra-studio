// SierraStudio Auto-Updater — checks GitHub Releases for new versions
// Uses electron-updater (part of electron-builder)
// 
// To enable:
//   1. Set SIERRASTUDIO_UPDATE_REPO in env (e.g. "your-username/sierrastudio")
//   2. Publish releases to GitHub with electron-builder
//   3. The app will check on startup + every 4 hours

import { app, BrowserWindow } from "electron";
import { autoUpdater } from "electron-updater";
import * as log from "electron-log";

// Default to the project's GitHub repo. Override via env if you fork.
const UPDATE_REPO = process.env.SIERRASTUDIO_UPDATE_REPO || "poopoo5194379/sierra-studio";

export function setupAutoUpdater(): void {
  if (!app.isPackaged) return;

  log.transports.file.level = "info";
  autoUpdater.logger = log;

  // Using GitHub Releases (free for public repos)
  autoUpdater.setFeedURL({
    provider: "github",
    owner: UPDATE_REPO.split("/")[0],
    repo: UPDATE_REPO.split("/")[1]
  });

  // Check every 4 hours
  setInterval(() => {
    autoUpdater.checkForUpdates();
  }, 4 * 60 * 60 * 1000);

  // Check on startup
  autoUpdater.checkForUpdatesAndNotify();

  autoUpdater.on("update-available", (info) => {
    log.info("Update available:", info.version);
  });

  autoUpdater.on("update-not-available", () => {
    log.info("No updates available");
  });

  autoUpdater.on("download-progress", (progress) => {
    log.info(`Download progress: ${Math.round(progress.percent)}%`);
  });

  autoUpdater.on("update-downloaded", () => {
    log.info("Update downloaded — will install on restart");
    // Prompt user to restart
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      const { dialog } = require("electron");
      dialog.showMessageBox(win, {
        type: "info",
        title: "SierraStudio 更新",
        message: "新版本已下载，是否立即重启安装？",
        buttons: ["立即重启", "稍后"]
      }).then(({ response }: { response: number }) => {
        if (response === 0) {
          autoUpdater.quitAndInstall();
        }
      });
    }
  });

  autoUpdater.on("error", (err) => {
    log.error("Auto-updater error:", err.message);
  });
}
