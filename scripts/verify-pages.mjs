// Read-only post-deployment check. Fetches static assets, never signs in or runs
// application code. This is not a native browser or authenticated workflow test.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const base=new URL(process.argv[2]||'https://victoriouss94.github.io/war-for-acme-gm/');
assert.equal(base.protocol,'https:');
const {version}=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
const checked=new Set(),external=new Set();
async function fetchStatic(url,script=false){
  const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(15000)});
  assert.equal(response.status,200,`Static asset unavailable: ${url.pathname} (${response.status})`);
  if(script)assert.match(response.headers.get('content-type')||'',/javascript|ecmascript/i,`Wrong module content type: ${url.pathname}`);
  return response.text();
}
const pageUrl=new URL(base);pageUrl.searchParams.set('verify',version+'-'+Date.now());
const html=await fetchStatic(pageUrl);
assert.ok(html.includes('js/app.js?v='+version),'Homepage is not the expected release');
const pending=[...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)].map(match=>new URL(match[1],base));
while(pending.length){
  const url=pending.shift();if(checked.has(url.href))continue;
  if(url.origin!==base.origin){external.add(url.origin);continue;}
  assert.ok(url.pathname.startsWith(base.pathname),'Asset escaped the deployed project');
  checked.add(url.href);const source=await fetchStatic(url,true);
  for(const match of source.matchAll(/^\s*(?:import|export)\s+(?:[^'"\n]+?\s+from\s*)?['"]([^'"]+)['"]/gm)){
    const specifier=match[1];if(specifier.startsWith('.'))pending.push(new URL(specifier,url));
  }
}
assert.ok([...checked].some(url=>new URL(url).pathname.endsWith('/supabase/functions/_shared/master-gm.js')),'Shared intent classifier was not checked');
console.log(JSON.stringify({version,staticAssetsChecked:checked.size,externalOriginsNotChecked:[...external],status:'passed',scope:'Homepage release and same-origin static script/module graph only; no browser/authentication proof.'}));
