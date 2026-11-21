import { trimOutput } from './redact';
export const ellipsizeError = (error:unknown,redact:(s:string)=>string) =>
  trimOutput(redact(error instanceof Error ? error.message : String(error)),1000);
export function sanitizeValue<T>(value:T,redact:(s:string)=>string):T {
  if(typeof value==='string') return redact(value) as T;
  if(Array.isArray(value)) return value.map(item=>sanitizeValue(item,redact)) as T;
  if(value && typeof value==='object') return Object.fromEntries(Object.entries(value).map(([key,item])=>[redact(key),sanitizeValue(item,redact)])) as T;
  return value;
}

