import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS, type DesktopApi } from "../shared/ipc";

const api: DesktopApi = {
  onOperationProgress: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: { active: boolean; label?: string }
    ): void => listener(payload);
    ipcRenderer.on(IPC_CHANNELS.operationProgress, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.operationProgress, handler);
  },
  importHtml: () => ipcRenderer.invoke(IPC_CHANNELS.importHtml),
  ensureWelcomeProject: () =>
    ipcRenderer.invoke(IPC_CHANNELS.ensureWelcomeProject),
  listProjects: () => ipcRenderer.invoke(IPC_CHANNELS.listProjects),
  openProject: (projectId) =>
    ipcRenderer.invoke(IPC_CHANNELS.openProject, projectId),
  executeCommand: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.executeCommand, input),
  exportStatic: (projectId) =>
    ipcRenderer.invoke(IPC_CHANNELS.exportStatic, projectId),
  importImage: (projectId) =>
    ipcRenderer.invoke(IPC_CHANNELS.importImage, projectId),
  importImages: (projectId) =>
    ipcRenderer.invoke(IPC_CHANNELS.importImages, projectId),
  importMedia: (projectId, mediaType) =>
    ipcRenderer.invoke(IPC_CHANNELS.importMedia, projectId, mediaType),
  materializeProject: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.materializeProject, input),
  undo: (projectId) => ipcRenderer.invoke(IPC_CHANNELS.undo, projectId),
  redo: (projectId) => ipcRenderer.invoke(IPC_CHANNELS.redo, projectId),
  updateProjectFeatures: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.updateFeatures, input),
  exportPdf: (input) => ipcRenderer.invoke(IPC_CHANNELS.exportPdf, input),
  exportPptx: (input) => ipcRenderer.invoke(IPC_CHANNELS.exportPptx, input),
  checkForUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.checkForUpdate),
  quitAndInstall: () => ipcRenderer.send(IPC_CHANNELS.quitAndInstall)
};

contextBridge.exposeInMainWorld("sierraStudio", api);
