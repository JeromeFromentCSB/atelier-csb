const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('csbHost', {
  getConfig: () => ipcRenderer.invoke('csb:get-config'),
  setConfig: (partial) => ipcRenderer.invoke('csb:set-config', partial),
  openExternal: (url) => ipcRenderer.invoke('csb:open-external', url),
  platform: process.platform,
  getAppVersion: () => ipcRenderer.invoke('csb:app-version'),
  installUpdate: () => ipcRenderer.invoke('csb:install-update'),
  onUpdateStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('csb:update-status', listener);
    return () => ipcRenderer.removeListener('csb:update-status', listener);
  },
  vectorize: (rgba, width, height, options) => ipcRenderer.invoke('csb:vectorize', { rgba, width, height, options }),
  emailSetCredentials: (email, appPassword, host, port) => ipcRenderer.invoke('csb:email-set-credentials', { email, appPassword, host, port }),
  emailStatus: () => ipcRenderer.invoke('csb:email-status'),
  emailDisconnect: () => ipcRenderer.invoke('csb:email-disconnect'),
  emailTestConnection: () => ipcRenderer.invoke('csb:email-test-connection'),
  emailList: (query, limit, mailbox, offset) => ipcRenderer.invoke('csb:email-list', { query, limit, mailbox, offset }),
  emailGetByUids: (uids, mailbox) => ipcRenderer.invoke('csb:email-get-by-uids', { uids, mailbox }),
  emailGetMessage: (uid, mailbox) => ipcRenderer.invoke('csb:email-get-message', { uid, mailbox }),
  emailListFolders: () => ipcRenderer.invoke('csb:email-list-folders'),
  emailSetFlags: (uid, mailbox, addFlags, removeFlags) => ipcRenderer.invoke('csb:email-set-flags', { uid, mailbox, addFlags, removeFlags }),
  emailMoveToTrash: (uid, mailbox) => ipcRenderer.invoke('csb:email-move-to-trash', { uid, mailbox }),
  emailMoveToFolder: (uid, mailbox, targetPath) => ipcRenderer.invoke('csb:email-move-to-folder', { uid, mailbox, targetPath }),
  onWebviewOpenTab: (callback) => {
    const listener = (_event, url) => callback(url);
    ipcRenderer.on('csb:webview-open-tab', listener);
    return () => ipcRenderer.removeListener('csb:webview-open-tab', listener);
  }
});
