import { contextBridge,ipcRenderer } from 'electron';
import type { Bridge, Snapshot } from './types';

const atom:Bridge & {tools:()=>Promise<{name:string;access:string;alwaysAsk?:boolean}[]>}={
  request:request=>ipcRenderer.invoke('atom:request',request),
  tools:()=>ipcRenderer.invoke('atom:tools'),
  subscribe(callback){
    const handler=(_event:Electron.IpcRendererEvent,snapshot:Snapshot)=>callback(snapshot);
    ipcRenderer.on('atom:update',handler);
    return ()=>ipcRenderer.removeListener('atom:update',handler);
  },
};
contextBridge.exposeInMainWorld('atom',atom);

