// Explicitly opt in: GM_AUDIT_EDGE_CHECKS=1 node scripts/audit-edge-auth.mjs
// No real user credentials, game mutations, uploads or AI requests are used.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';

if(process.env.GM_AUDIT_EDGE_CHECKS!=='1')throw new Error('Set GM_AUDIT_EDGE_CHECKS=1 to run live negative-auth checks.');
const config=readFileSync(new URL('../js/supabase-config.js',import.meta.url),'utf8');
const base=config.match(/url:'([^']+)'/)?.[1];
const key=config.match(/publishableKey:'([^']+)'/)?.[1];
assert.ok(base&&key?.startsWith('sb_publishable_'),'Expected public connection settings');
const origin='https://victoriouss94.github.io';
const id='00000000-0000-4000-8000-000000000000';
const endpoints=[
  ['gm-copilot',{gameId:id,message:'Negative authorization audit'}],
  ['gm-document-import',{fileName:'audit.docx',blocks:[{text:'Negative authorization audit'}]}],
  ['gm-knowledge-ingest',{documentVersionId:id}]
];
const results=[];
for(const [endpoint,body] of endpoints){
  for(const [name,authorization] of [['missing bearer',null],['invalid bearer','Bearer audit-invalid-token'],['API key is not a user token',`Bearer ${key}`]]){
    const headers={apikey:key,Origin:origin,'Content-Type':'application/json'};
    if(authorization)headers.Authorization=authorization;
    const response=await fetch(`${base}/functions/v1/${endpoint}`,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
    await response.arrayBuffer();
    assert.equal(response.status,401,`${endpoint}: ${name}`);
    results.push({endpoint,check:name,status:response.status});
  }
  for(const [name,requestOrigin,status] of [['allowed preflight',origin,200],['foreign preflight','https://audit.invalid',403]]){
    const response=await fetch(`${base}/functions/v1/${endpoint}`,{method:'OPTIONS',headers:{Origin:requestOrigin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,apikey,content-type'},signal:AbortSignal.timeout(15000)});
    await response.arrayBuffer();
    assert.equal(response.status,status,`${endpoint}: ${name}`);
    if(status===200){assert.equal(response.headers.get('access-control-allow-origin'),origin);assert.match(response.headers.get('access-control-allow-headers')||'',/authorization/i)}
    results.push({endpoint,check:name,status:response.status});
  }
}
console.log(JSON.stringify({passed:results.length,results,scope:'Gateway negative-auth and handler preflight checks only; authenticated GM/isolation/cost paths are not covered.'},null,2));
