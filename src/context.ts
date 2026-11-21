import type { ModelMessage } from 'ai';

export function imageMetadata(value:unknown):string {
  const serialize=(_key:string,item:unknown)=>typeof item==='string'&&item.startsWith('data:image/')
    ? `[图片，编码长度 ${item.length}，视觉 Token 按供应商计量]`:item;
  return JSON.stringify(value,serialize);
}
export const estimate = (value:unknown) => {
  if(typeof value==='string')return Math.ceil(Buffer.byteLength(value)/3);
  let images=0;
  const serialized=JSON.stringify(value,(_key,item)=>{
    if(typeof item==='string'&&item.startsWith('data:image/')){images++;return '[图片]';}
    return item;
  });
  return Math.ceil(Buffer.byteLength(serialized)/3)+images*1536;
};
export function groups(messages:ModelMessage[]) {
  const result:ModelMessage[][]=[];
  for(const message of messages) {
    if(message.role==='tool' && result.length) result.at(-1)!.push(message);
    else result.push([message]);
  }
  return result;
}
export function tailFor(messages:ModelMessage[],budget:number) {
  const blocks=groups(messages);
  let used=0;
  let cut=blocks.length;
  while(cut>0 && used+estimate(blocks[cut-1])<=budget) used+=estimate(blocks[--cut]);
  if(cut===blocks.length && cut>0) cut--;
  return {older:blocks.slice(0,cut).flat(),recent:blocks.slice(cut).flat()};
}

