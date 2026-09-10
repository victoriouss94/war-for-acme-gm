// Read-only source/catalog comparison. No RPC or application code is executed.
// This is a bounded literal-call scanner, not a JavaScript/TypeScript type checker.
import {readFileSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

function parts(source,start,close){
  const segments=[],stack=[];let begin=start,quote='',comment='';
  for(let i=start;i<source.length;i++){
    const c=source[i],n=source[i+1];
    if(comment==='line'){if(c==='\n')comment='';continue;}
    if(comment==='block'){if(c==='*'&&n==='/'){comment='';i++;}continue;}
    if(quote){if(c==='\\'){i++;continue;}if(c===quote)quote='';continue;}
    if(c==='/'&&n==='/'){comment='line';i++;continue;}
    if(c==='/'&&n==='*'){comment='block';i++;continue;}
    if(c==='\''||c==='"'||c==='`'){quote=c;continue;}
    if(!stack.length&&c===close){segments.push(source.slice(begin,i).trim());return {segments,end:i};}
    if(c==='('||c==='{'||c==='[')stack.push({ '(':')','{':'}','[':']'}[c]);
    else if(c===')'||c==='}'||c===']'){if(stack.pop()!==c)return null;}
    else if(!stack.length&&c===','){segments.push(source.slice(begin,i).trim());begin=i+1;}
  }
  return null;
}

function codeMask(source){
  const chars=source.split('');let quote='',comment='';
  for(let i=0;i<source.length;i++){
    const c=source[i],n=source[i+1];
    if(comment==='line'){if(c==='\n')comment='';else chars[i]=' ';continue;}
    if(comment==='block'){chars[i]=c==='\n'?'\n':' ';if(c==='*'&&n==='/'){chars[++i]=' ';comment='';}continue;}
    if(quote){chars[i]=c==='\n'?'\n':' ';if(c==='\\'){chars[++i]=' ';continue;}if(c===quote)quote='';continue;}
    if(c==='/'&&n==='/'){chars[i]=chars[++i]=' ';comment='line';continue;}
    if(c==='/'&&n==='*'){chars[i]=chars[++i]=' ';comment='block';continue;}
    if(c==='\''||c==='"'||c==='\`'){chars[i]=' ';quote=c;}
  }
  return chars.join('');
}

export function scanRpcCalls(source,file='source'){
  const calls=[];
  for(const match of codeMask(source).matchAll(/\.rpc\s*\(/g)){
    const parsed=parts(source,match.index+match[0].length,')');
    if(!parsed){calls.push({file,line:source.slice(0,match.index).split('\n').length,unresolved:'Unbalanced call syntax'});continue;}
    const [target,args]=parsed.segments,name=target?.match(/^['"]([a-zA-Z0-9_]+)['"]$/)?.[1];
    const call={file,line:source.slice(0,match.index).split('\n').length,name:name||null,target,keys:[],unresolved:''};
    if(!name)call.unresolved='Dynamic RPC target';
    if(args?.startsWith('{')){
      const object=parts(args,1,'}');
      if(!object||object.end!==args.length-1)call.unresolved+='; Nonliteral argument object';
      else for(const raw of object.segments.filter(Boolean)){
        const item=raw.replace(/^\s*\/\*[\s\S]*?\*\/\s*/,'');
        const key=item.match(/^(?:([a-zA-Z_$][\w$]*)|['"]([a-zA-Z0-9_]+)['"])\s*:/)?.slice(1).find(Boolean)
          ||item.match(/^([a-zA-Z_$][\w$]*)$/)?.[1];
        if(key)call.keys.push(key);else call.unresolved+='; Spread/computed/unsupported argument property';
      }
    }else if(args)call.unresolved+='; Argument object supplied by expression';
    calls.push(call);
  }
  return calls;
}

export function compareRpcCalls(calls,catalog){
  return calls.map(call=>{
    if(call.unresolved)return {...call,status:'MANUAL_REVIEW'};
    const candidates=catalog.filter(row=>row.name===call.name);
    if(!candidates.length)return {...call,status:'MISSING_FUNCTION'};
    const matching=candidates.filter(row=>{
      const names=(row.argument_names||[]).slice(0,row.input_count),required=names.slice(0,row.input_count-row.default_count);
      return call.keys.every(key=>names.includes(key))&&required.every(key=>call.keys.includes(key));
    });
    if(!matching.length)return {...call,status:'ARGUMENT_MISMATCH',signatures:candidates.map(row=>row.signature)};
    if(matching.length>1)return {...call,status:'AMBIGUOUS_SIGNATURE'};
    return {...call,status:'MATCH',signature:matching[0].signature};
  });
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  if(!process.argv[2])throw new Error('Supply a read-only catalog JSON snapshot path. This script never connects to production.');
  const walk=directory=>readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(join(directory,entry.name)):[join(directory,entry.name)]);
  const files=[...walk('js'),...walk('supabase/functions')].filter(file=>/\.(js|ts)$/.test(file)&&!file.includes('.test.'));
  const calls=files.flatMap(file=>scanRpcCalls(readFileSync(file,'utf8'),file)),catalog=JSON.parse(readFileSync(process.argv[2],'utf8'));
  const results=compareRpcCalls(calls,catalog),counts=results.reduce((all,row)=>(all[row.status]=(all[row.status]||0)+1,all),{});
  console.log(JSON.stringify({scope:'Literal RPC names and argument keys only; no execution, type, RLS-body or reachability proof.',counts,results},null,2));
  if(results.some(row=>['MISSING_FUNCTION','ARGUMENT_MISMATCH','AMBIGUOUS_SIGNATURE'].includes(row.status)))process.exitCode=1;
}
