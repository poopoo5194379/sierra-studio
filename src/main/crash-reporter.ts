// SierraStudio Crash Reporter — sends uncaught errors to Cloud API
// Usage: import "./crash-reporter" in main/index.ts
import { app, crashReporter } from "electron";

const API_URL = process.env.SIERRASTUDIO_API_URL || "";

if (API_URL) {
  // Electron built-in crash reporter
  crashReporter.start({
    productName: "SierraStudio",
    companyName: "SierraStudio",
    submitURL: `${API_URL}/api/crash`,
    uploadToServer: true,
  });
}

// Also catch JS-level uncaught errors
function installGlobalErrorHandler(): void {
  const reportError = async (errorMessage: string, errorStack?: string): Promise<void> => {
    if (!API_URL) return;
    try {
      await fetch(`${API_URL}/api/crash`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "",
          appVersion: app.getVersion(),
          platform: `${process.platform} ${process.arch}`,
          errorMessage,
          errorStack
        })
      });
    } catch {
      // Fire-and-forget
    }
  };

  process.on("uncaughtException", (error) => {
    console.error("[uncaughtException]", error);
    reportError(error.message, error.stack);
  });

  process.on("unhandledRejection", (reason) => {
    console.error("[unhandledRejection]", reason);
    const msg = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack : undefined;
    reportError(msg, stack);
  });
}

installGlobalErrorHandler();
