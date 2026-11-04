import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const folder=resolve('fixtures/local-notes');
await mkdir(folder,{recursive:true});
await writeFile(resolve(folder,'ticket-T104.txt'),'Sample data\nTicket T104: Checkout fails on mobile.\nDesktop checkout works. Ask which browser was used.\n');
const client=new Client({name:'support-tutorial-local',version:'1.0.0'});
const transport=new StdioClientTransport({command:process.execPath,args:[resolve('node_modules/@modelcontextprotocol/server-filesystem/dist/index.js'),folder],stderr:'inherit'});
try {
 await client.connect(transport);
 const tools=await client.listTools();
 console.log('Connected over stdio. Discovered tools:',tools.tools.length);
 console.log('Read tool:',tools.tools.find(t=>t.name==='read_text_file')?.name);
 console.log('Also exposes writes:',tools.tools.some(t=>t.name==='write_file'));
 const result=await client.callTool({name:'read_text_file',arguments:{path:resolve(folder,'ticket-T104.txt')}});
 assert.equal(result.isError,undefined);
 console.log('Actual read_text_file result:');
 for(const block of result.content)if(block.type==='text')console.log(block.text);
} finally {await client.close();}
