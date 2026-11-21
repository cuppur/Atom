import { DatabaseSync } from 'node:sqlite';
import { defaults, type Settings, type Project, type Session, type Profile, type MemoryNote, type ContextHeader, type ContextTrace, type ComposerModel } from './types';

export class Store {
  private db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS prefs (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, scope TEXT NOT NULL, updated INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS memory_scope ON memories (scope, updated DESC);
      CREATE TABLE IF NOT EXISTS context_requests (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, timestamp INTEGER NOT NULL, state TEXT NOT NULL, metadata TEXT NOT NULL, detail TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS context_session ON context_requests (session_id,timestamp DESC);
    `);
  }

  private all<T>(table: 'sessions'|'projects'|'profiles'): T[] {
    return this.db.prepare(`SELECT data FROM ${table}`).all().map(row => JSON.parse(String(row.data)) as T);
  }
  private put(table: 'sessions'|'projects'|'profiles'|'prefs', id: string, data: unknown) {
    this.db.prepare(`INSERT INTO ${table} VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`).run(id,JSON.stringify(data));
  }
  projects() { return this.all<Project>('projects'); }
  sessions() { return this.all<Session>('sessions'); }
  profiles() { return this.all<{profile: Profile; encrypted?:string}>('profiles'); }
  project(record: Project) { this.put('projects',record.id,record); }
  session(record: Session) { this.put('sessions',record.id,record); }
  profile(profile: Profile, encrypted?: string) { this.put('profiles',profile.id,{profile,encrypted}); }
  removeProfile(id: string) { this.db.prepare('DELETE FROM profiles WHERE id=?').run(id); }
  settings(): Settings {
    const row = this.db.prepare('SELECT data FROM prefs WHERE id=?').get('settings');
    return row ? {...defaults,...JSON.parse(String(row.data))} : structuredClone(defaults);
  }
  saveSettings(record: Settings) { this.put('prefs','settings',record); }
  selected():string|null|undefined {
    const row=this.db.prepare('SELECT data FROM prefs WHERE id=?').get('selected');
    return row?JSON.parse(String(row.data)):undefined;
  }
  saveSelection(id?:string) {this.put('prefs','selected',id??null);}
  composer():ComposerModel|undefined {
    const row=this.db.prepare("SELECT data FROM prefs WHERE id='composer-model'").get();
    return row?JSON.parse(String(row.data)):undefined;
  }
  saveComposer(value:ComposerModel) {this.put('prefs','composer-model',value);}
  memories(projectId?:string):MemoryNote[] {
    return this.db.prepare('SELECT data FROM memories WHERE scope=? ORDER BY updated DESC')
      .all(projectId??'').map(row=>JSON.parse(String(row.data)) as MemoryNote);
  }
  memory(note:MemoryNote) {
    this.db.prepare(`INSERT INTO memories VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET updated=excluded.updated,data=excluded.data`)
      .run(note.id,note.projectId??'',note.updated,JSON.stringify(note));
  }
  removeMemory(id:string,projectId?:string) {
    return this.db.prepare('DELETE FROM memories WHERE id=? AND scope=?').run(id,projectId??'').changes>0;
  }
  contextStart(sessionId:string,trace:ContextTrace) {
    const {header,...detail}=trace;
    this.db.prepare('INSERT INTO context_requests VALUES (?,?,?,?,?,?)')
      .run(header.id,sessionId,header.time,header.state,JSON.stringify(header),JSON.stringify(detail));
    this.db.prepare(`DELETE FROM context_requests WHERE id IN
      (SELECT id FROM context_requests WHERE session_id=? ORDER BY timestamp DESC,rowid DESC LIMIT -1 OFFSET 20)`).run(sessionId);
  }
  contextUpdate(header:ContextHeader) {
    this.db.prepare('UPDATE context_requests SET state=?,metadata=? WHERE id=?').run(header.state,JSON.stringify(header),header.id);
  }
  contextList(sessionId:string):ContextHeader[] {
    return this.db.prepare('SELECT state,metadata FROM context_requests WHERE session_id=? ORDER BY timestamp DESC,rowid DESC')
      .all(sessionId).map(row=>({...JSON.parse(String(row.metadata)),state:row.state}));
  }
  contextRead(sessionId:string,id:string):ContextTrace|undefined {
    const row=this.db.prepare('SELECT state,metadata,detail FROM context_requests WHERE session_id=? AND id=?').get(sessionId,id);
    return row?{...JSON.parse(String(row.detail)),header:{...JSON.parse(String(row.metadata)),state:row.state}}:undefined;
  }
  recoverContexts() {
    this.db.prepare("UPDATE context_requests SET state='interrupted' WHERE state='running'").run();
  }
  close() { this.db.close(); }
}

