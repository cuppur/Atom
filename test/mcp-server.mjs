import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod';
const server=new McpServer({name:'atom-fixture',version:'1'});
server.registerTool('echo',{description:'Verifies round trips',inputSchema:{value:z.string()}},async ({value})=>({
  content:[{type:'text',text:'MCP '+value}],
}));
await server.connect(new StdioServerTransport());

