import type { ModelMessage } from 'ai';

export const estimate = (value:unknown) => Math.ceil(Buffer.byteLength(typeof value==='string'?value:JSON.stringify(value))/3);
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

