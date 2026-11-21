export function redactor(keys: string[]) {
  const secrets = keys.filter(key => key && key.trim()).sort((a,b) => b.length-a.length);
  return function redact(text: string) {
    for (const key of secrets) text = text.replaceAll(key, '[凭据已隐藏]');
    return text.replace(/\b(?:sk-[\w-]{16,}|AIza[\w-]{25,}|gh[pousr]_[\w]{20,})\b/g, '[凭据已隐藏]')
      .replace(/(authorization\s*[:=]\s*["']?bearer\s+)\S+/gi,'$1[凭据已隐藏]');
  };
}
export const trimOutput = (value: string, max = 14000) => value.length <= max ? value
  : value.slice(0,Math.floor(max*0.62)) + '\n… 输出已裁剪 …\n' + value.slice(-Math.floor(max*0.36));

