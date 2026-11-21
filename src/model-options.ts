import { contextPresets,type ModelRuntime,type Profile } from './types';

export const deepSeekModels=['deepseek-flash','deepseek-v4-pro'];
const contextPercentFormat=new Intl.NumberFormat('zh-CN',{style:'percent',maximumFractionDigits:2});
export const formatContextPercent=(value:number)=>value>0&&value<0.0001?'<0.01%':contextPercentFormat.format(value);
export function isOfficialDeepSeek(profile:Profile) {
  if(profile.provider!=='deepseek')return false;
  const url=URL.parse(profile.url);
  return url?.origin==='https://api.deepseek.com'&&/^\/(?:v1\/?)?$/.test(url.pathname);
}
export function modelVariants(profile:Profile) {
  return isOfficialDeepSeek(profile)?[...new Set([profile.model,...deepSeekModels])]:[profile.model];
}
export function contextCapacity(profile:Profile,model=profile.model) {
  return isOfficialDeepSeek(profile)&&deepSeekModels.includes(model)?1000000:profile.context;
}
export function contextDefault(profile:Profile,model=profile.model) {
  const limit=contextCapacity(profile,model);
  return limit>=contextPresets[0]&&profile.output<contextPresets[0]?contextPresets[0]:limit;
}
export function effectiveProfile(profile:Profile,runtime:ModelRuntime={}) {
  const model=runtime.model??profile.model;
  if(!modelVariants(profile).includes(model))throw new Error('该模型不属于当前 API 配置');
  const context=runtime.context??contextDefault(profile,model);
  if(context>contextCapacity(profile,model)||context<=profile.output)throw new Error('该上下文档位超出此模型的配置范围');
  const switching=isOfficialDeepSeek(profile)&&model!==profile.model;
  return {...profile,model,context,effort:runtime.effort??profile.effort,
    ...(switching&&{inputPrice:null,outputPrice:null,cachePrice:null,cacheWritePrice:null})};
}
export function compatibleRuntime(profile:Profile,runtime:ModelRuntime) {
  const model=runtime.model&&modelVariants(profile).includes(runtime.model)?runtime.model:undefined;
  const context=runtime.context&&runtime.context<=contextCapacity(profile,model)&&runtime.context>profile.output?runtime.context:undefined;
  return {model,context,effort:runtime.effort};
}

