import http from 'node:http';

export async function mockApi(choose){
  const requests=[];
  const server=http.createServer(async(req,res)=>{
    let raw='';
    for await(const chunk of req)raw+=chunk;
    try {
      const body=JSON.parse(raw);
      requests.push({path:req.url,authorization:req.headers.authorization,body});
      const answer=await choose(body,requests.length);
      if(answer.hang) {res.writeHead(200,{'Content-Type':'text/event-stream'});res.flushHeaders();return;}
      if(answer.error){res.writeHead(answer.error,{'Content-Type':'application/json','Retry-After':'0'});res.end(JSON.stringify({error:{message:'fixture API error'}}));return;}
      res.writeHead(200,{'Content-Type':'text/event-stream'});
      const base={id:'fixture-'+requests.length,object:'chat.completion.chunk',created:100,model:body.model};
      const data=(delta,finish_reason=null)=>res.write('data: '+JSON.stringify({...base,choices:[{index:0,delta,finish_reason}]})+'\n\n');
      data({role:'assistant'});
      if(answer.calls){
        answer.calls.forEach(([name,input],index)=>{
          const args=JSON.stringify(input);
          const middle=Math.floor(args.length/2);
          data({tool_calls:[{index,id:`test-${requests.length}-${index}`,type:'function',function:{name,arguments:args.slice(0,middle)}}]});
          data({tool_calls:[{index,function:{arguments:args.slice(middle)}}]});
        });
      }else{
        for(const part of answer.text??['验收','完成']){
          data({content:part});
          if(answer.delayMs)await new Promise(resolve=>setTimeout(resolve,answer.delayMs));
        }
      }
      data({},answer.calls?'tool_calls':'stop');
      res.end('data: '+JSON.stringify({...base,choices:[],usage:{prompt_tokens:125,completion_tokens:18,total_tokens:143,prompt_cache_hit_tokens:20,prompt_cache_miss_tokens:105}})+'\n\ndata: [DONE]\n\n');
    }catch{
      if(!res.headersSent)res.writeHead(500);
      res.end();
    }
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {url:`http://127.0.0.1:${server.address().port}`,requests,close:()=>new Promise(resolve=>{
    server.close(resolve);server.closeAllConnections();
  })};
}

