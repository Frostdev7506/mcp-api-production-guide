import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { delegateToApi } from '../dist/src/auth.js';
const token=await delegateToApi({subject:'benchmark-'+randomUUID(),tenant:'acme',scopes:['tickets:read']},new TextEncoder().encode(process.env.DELEGATION_SECRET));
const timings=[];let errors=0;const began=performance.now();
for(let batch=0;batch<5;batch++)await Promise.all(Array.from({length:20},async()=>{const start=performance.now();const r=await fetch(new URL('/tickets/T104',process.env.API_URL),{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(5000)});const body=await r.json();if(!r.ok||body.id!=='T104')errors++;timings.push(performance.now()-start);}));
timings.sort((a,b)=>a-b);
console.log(JSON.stringify({scope:'local API read boundary only; excludes model, MCP and internet',requests:100,batch_concurrency:20,errors,elapsed_ms:Math.round(performance.now()-began),p50_ms:Math.round(timings[49]),p95_ms:Math.round(timings[94]),timestamp:new Date().toISOString()},null,2));
if(errors)process.exitCode=1;
