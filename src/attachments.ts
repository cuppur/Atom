import { nativeImage } from 'electron';
import { open } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { Attachment } from './types';

export const imageBytes=10*1024*1024;
export function imageAttachment(name:string,bytes:Buffer):Attachment {
  if(!bytes.length||bytes.length>imageBytes)throw new Error('图片大小需在 10 MB 以内');
  const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  const webp=bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
  if(!png&&!jpeg&&!webp)throw new Error('支持 PNG、JPEG 和 WebP 图片');
  const decoded=nativeImage.createFromBuffer(bytes);
  if(decoded.isEmpty())throw new Error('图片无法解码');
  const {width,height}=decoded.getSize();
  if(width*height>16000000)throw new Error('图片尺寸超过 1600 万像素，请缩小后添加');
  const encoded=decoded.toPNG();
  if(encoded.length>imageBytes)throw new Error('图片解码后超过 10 MB，请缩小后添加');
  return {id:randomUUID(),name,image:'data:image/png;base64,'+encoded.toString('base64')};
}
export async function readImage(file:string):Promise<Attachment> {
  const handle=await open(file,'r');
  try{
    const stat=await handle.stat();
    if(!stat.isFile()||stat.size>imageBytes)throw new Error('请选择 10 MB 以内的普通图片文件');
    const bytes=Buffer.alloc(imageBytes+1);
    const {bytesRead}=await handle.read(bytes,0,bytes.length,0);
    return imageAttachment(file.split(/[\\/]/).at(-1)!,bytes.subarray(0,bytesRead));
  }finally{await handle.close();}
}
