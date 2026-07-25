import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS, type DesktopApi } from "../shared/ipc";

const api: DesktopApi = {
  importHtml: () => ipcRenderer.invoke(IPC_CHANNELS.importHtml),
  executeCommand: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.executeCommand, input),
  exportStatic: (projectId) =>
    ipcRenderer.invoke(IPC_CHANNELS.exportStatic, projectId),
  importImage: (projectId) =>
    ipcRenderer.invoke(IPC_CHANNELS.importImage, projectId),
  undo: (projectId) => ipcRenderer.invoke(IPC_CHANNELS.undo, projectId),
  redo: (projectId) => ipcRenderer.invoke(IPC_CHANNELS.redo, projectId),
  exportPdf: (input) => ipcRenderer.invoke(IPC_CHANNELS.exportPdf, input),
  checkForUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.checkForUpdate),
  quitAndInstall: () => ipcRenderer.send(IPC_CHANNELS.quitAndInstall)
};

contextBridge.exposeInMainWorld("sierraStudio", api);
