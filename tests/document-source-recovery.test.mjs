import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const cloud=readFileSync(new URL('../js/cloud.js',import.meta.url),'utf8');
const app=readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
const file={name:'test-source.docx',size:20},document={game:{id:'test-game'},data:{}};
const metadata={id:'test-import',fileName:file.name,fileSize:file.size,documentKey:'test-source',title:'Test source',documentType:'CHARACTER_ROLE_GUIDE'};
const operations={
  create:api=>api.createImportedGame(document,file,metadata),
  reimport:api=>api.reimportGame('test-game',7,document,file,metadata),
  knowledge:api=>api.uploadKnowledgeDocument('test-game',file,metadata)
};
function harness({failure,throws=false,commit=false,uploadError,cleanupError,cleanupThrows=false,ingestError,malformed=false,responseRows=rows=>rows}={}){
  const calls=[],objects=new Set(),references=new Set();
  let sequence=0;
  const client={
    storage:{from(bucket){return {
      upload:async(path,_file,options)=>{calls.push({kind:'upload',bucket,path,options});if(uploadError)return {error:uploadError};objects.add(bucket+'/'+path);return {data:{path}};},
      remove:async(paths)=>{calls.push({kind:'remove',bucket,paths:[...paths]});if(cleanupThrows)throw cleanupError;if(cleanupError)return {error:cleanupError};for(const path of paths)objects.delete(bucket+'/'+path);return {data:paths.map(name=>({name}))};}
    };}},
    rpc:async(name,args)=>{
      calls.push({kind:'rpc',name,args});
      const bucket=name==='create_knowledge_document'?'game-knowledge-documents':'game-import-documents',path=args.source_storage_path||args.target_storage_path;
      if(commit||!failure)references.add(bucket+'/'+path);
      if(throws)throw failure;
      if(failure)return {error:failure};
      if(malformed)return undefined;
      return {data:responseRows([{id:'test-game',version:8,share_code:'test-code',document,updated_at:'2026-09-13',document_id:args.target_document_id,version_id:args.target_version_id,version_number:1}])};
    },
    functions:{invoke:async(name,args)=>{calls.push({kind:'invoke',name,args});return ingestError?{error:ingestError}:{data:{status:'ACTIVE'}};}}
  };
  const context={window:{},fixtureClient:client,crypto:{randomUUID:()=> 'generated-'+(++sequence)},console:{warn:()=>{}}};
  vm.createContext(context);
  assert.equal(cloud.split('  window.GMCloud={').length,2);
  vm.runInContext(cloud.replace('  window.GMCloud={',"  client=fixtureClient;session={user:{id:'test-owner'}};\n  window.GMCloud={"),context);
  return {api:context.window.GMCloud,calls,objects,references};
}
async function capture(promise){try{await promise;assert.fail('Expected a visible failure');}catch(error){if(error.code==='ERR_ASSERTION')throw error;return error;}}

for(const [name,run] of Object.entries(operations)){
  test(name+': a missing, non-row, or multiple-row registration reply is not a confirmed save',async()=>{
    for(const responseRows of [()=>null,()=>undefined,()=>[],()=>({}),()=>[null],()=>[false],rows=>[...rows,...rows]]){
      const h=harness({responseRows}),error=await capture(run(h.api));
      assert.equal(error.code,'DOCUMENT_SAVE_UNCONFIRMED');assert.equal(error.saveOutcomeUnknown,true);assert.equal(h.objects.size,1);
      assert.equal(h.calls.filter(c=>c.kind==='remove'||c.kind==='invoke').length,0);assert.equal(h.calls.filter(c=>c.kind==='rpc').length,1);
    }
  });
  test(name+': returned identity and consumed metadata must match the request contract',async()=>{
    const changes=name==='create'?[{id:'other-game'},{id:null},{version:null},{version:'8'},{version:0},{version:1.5},{share_code:null}]:
      name==='reimport'?[{version:7},{version:9},{version:'8'},{document:{game:{id:'other-game'},data:{}}},{document:null},{document:{game:{id:'test-game'}}},{document:{game:{id:'test-game'},data:[]}},{updated_at:null},{updated_at:'not-a-date'}]:
      [{document_id:'other-document'},{version_id:'other-version'},{document_id:null},{version_number:null},{version_number:'1'},{version_number:0}];
    for(const change of changes){
      const h=harness({responseRows:rows=>[{...rows[0],...change}]}),error=await capture(run(h.api));
      assert.equal(error.code,'DOCUMENT_SAVE_UNCONFIRMED');assert.equal(error.saveOutcomeUnknown,true);assert.equal(h.objects.size,1);
      assert.equal(h.calls.filter(c=>c.kind==='remove'||c.kind==='invoke').length,0);
    }
  });
  test(name+': committed save with lost response retains the referenced source and never retries',async()=>{
    const failure=Object.freeze(Object.assign(new Error('Failed to fetch'),{code:'',status:504}));
    const h=harness({failure,throws:true,commit:true}),error=await capture(run(h.api));
    assert.equal(h.objects.size,1,'Committed source must not be deleted');
    assert.deepEqual([...h.objects],[...h.references]);assert.equal(h.calls.filter(c=>c.kind==='rpc').length,1);
    assert.equal(h.calls.filter(c=>c.kind==='remove'||c.kind==='invoke').length,0);
    assert.equal(error.saveOutcomeUnknown,true);assert.equal(error.sourceRetained,true);
    assert.equal(error.code,'');assert.equal(error.status,504);assert.equal(error.cause,failure);
    assert.match(error.message,/uncertain/i);assert.match(error.message,/retained/i);assert.match(error.message,/before retrying/i);
    assert.equal(failure.message,'Failed to fetch');
  });
  test(name+': ambiguous returned errors and malformed responses never authorize cleanup',async()=>{
    for(const failure of [{code:'40003',message:'statement completion unknown'},{code:'08006',message:'connection failure'},{code:'PGRST001',message:'connection error'},{code:'504',message:'gateway timeout'},null]){
      const h=harness({failure,commit:true,malformed:!failure}),error=await capture(run(h.api));
      assert.equal(h.objects.size,1);assert.equal(error.saveOutcomeUnknown,true);assert.equal(h.calls.filter(c=>c.kind==='remove'||c.kind==='invoke').length,0);
    }
  });
  test(name+': an unconfirmed noncommitted request conservatively retains the source too',async()=>{
    const h=harness({failure:{message:'network error'}}),error=await capture(run(h.api));
    assert.equal(h.references.size,0);assert.equal(h.objects.size,1);assert.equal(error.saveOutcomeUnknown,true);
  });
  test(name+': confirmed database rejection cleans only this new upload',async()=>{
    for(const code of ['22023','23502','23503','23505','23514','42501','P0001','40001','40P01','57014']){
      const failure={code,message:'Rejected by database',details:'test details'},h=harness({failure});
      h.objects.add('unrelated/original-source.docx');
      const error=await capture(run(h.api));
      assert.equal(error,failure);assert.equal(h.references.size,0);assert.deepEqual([...h.objects],['unrelated/original-source.docx']);
      const upload=h.calls.find(c=>c.kind==='upload'),removal=h.calls.find(c=>c.kind==='remove');
      assert.equal(upload.options.upsert,false);assert.equal(removal.bucket,upload.bucket);assert.deepEqual(removal.paths,[upload.path]);
      assert.equal(h.calls.filter(c=>c.kind==='remove').length,1);assert.equal(h.calls.filter(c=>c.kind==='invoke').length,0);
    }
  });
  test(name+': cleanup failure is visible without replacing original database details',async()=>{
    for(const cleanupThrows of [false,true]){
      const failure=Object.freeze({code:'42501',message:'GM_ACCESS_REQUIRED',details:'original details',status:403});
      const h=harness({failure,cleanupError:new Error('Storage unavailable'),cleanupThrows}),error=await capture(run(h.api));
      assert.equal(h.objects.size,1);assert.equal(error.code,'42501');assert.equal(error.status,403);assert.equal(error.details,'original details');assert.equal(error.cause,failure);
      assert.equal(error.sourceCleanupFailed,true);assert.match(error.message,/cleanup could not be confirmed/i);assert.match(error.message,/GM_ACCESS_REQUIRED/);
      assert.equal(h.calls.filter(c=>c.kind==='remove').length,1);
    }
  });
  test(name+': failed upload never registers or removes any object',async()=>{
    const uploadError={message:'Duplicate source',code:'Duplicate'},h=harness({uploadError});
    assert.equal(await capture(run(h.api)),uploadError);assert.deepEqual(h.calls.map(c=>c.kind),['upload']);
  });
  test(name+': successful registration keeps its exact source and returns the existing contract',async()=>{
    const h=harness(),result=await run(h.api);
    assert.equal(h.objects.size,1);assert.deepEqual([...h.objects],[...h.references]);
    assert.equal(h.calls.filter(c=>c.kind==='rpc').length,1);assert.equal(h.calls.filter(c=>c.kind==='remove').length,0);
    if(name==='knowledge'){assert.equal(result.status,'ACTIVE');assert.equal(h.calls.filter(c=>c.kind==='invoke').length,1);}
    else assert.equal((name==='create'?result[0]:result).version,8);
  });
}
test('actual knowledge uploader exposes uncertain save without clearing the selected source',async()=>{
  const h=harness({failure:new Error('Lost save response'),throws:true,commit:true}),notices=[],elements={knowledgeTitle:{value:'Reference'},knowledgeType:{value:'CHARACTER_ROLE_GUIDE'},knowledgeStatus:{value:'ACTIVE'},knowledgeScope:{value:'GAME_SPECIFIC'},copilotDepth:{value:'standard'},knowledgeFile:{value:'test-source.docx'}};
  const selectedFile={...file,arrayBuffer:async()=>new ArrayBuffer(0)};
  const context={knowledgePending:false,canEditGame:()=>true,selectedKnowledgeFile:selectedFile,validateKnowledgeFile:()=>[],$:id=>elements[id]??={},setNotice:(_element,text,kind)=>notices.push({text,kind}),renderKnowledgeLibrary:()=>{},renderAll:()=>{},crypto:globalThis.crypto,id:()=> 'synthetic-doc',knowledgeDocumentKey:()=> 'synthetic',currentGame:()=>document.game,GMCloud:h.api};
  vm.createContext(context);
  const start=app.indexOf('async function uploadSelectedKnowledge('),end=app.indexOf('\nfunction renderOfficialAbilities',start);
  assert.ok(start>=0&&end>start);
  vm.runInContext(app.slice(start,end)+'\nglobalThis.upload=uploadSelectedKnowledge;',context);
  await context.upload();
  assert.equal(notices.at(-1).kind,'error');assert.match(notices.at(-1).text,/uncertain.*retained/i);
  assert.equal(context.selectedKnowledgeFile,selectedFile);assert.equal(context.knowledgePending,false);assert.equal(elements.knowledgeFile.value,file.name);
  assert.equal(h.calls.filter(c=>c.kind==='invoke'||c.kind==='remove').length,0);assert.equal(h.objects.size,1);
});

test('knowledge ingestion failure after registration never deletes the saved source',async()=>{
  const h=harness({ingestError:new Error('Indexing failed')}),error=await capture(operations.knowledge(h.api));
  assert.equal(h.objects.size,1);assert.deepEqual([...h.objects],[...h.references]);assert.equal(error.code,'DOCUMENT_INGESTION_FAILED');
  assert.equal(h.calls.filter(c=>c.kind==='remove').length,0);assert.equal(h.calls.filter(c=>c.kind==='invoke').length,1);
});


for(const importMode of ['initial','reimport'])test('actual '+importMode+' handler never publishes mismatched registration into local game state',async()=>{
  const h=harness({responseRows:rows=>rows.map(row=>importMode==='initial'?{...row,id:'other-game'}:{...row,document:{game:{id:'other-game'},data:{}}})}),elements={},writes=[],successes=[];
  const originalState={preserved:true},current={...document.game},gameIndex={games:[]};
  const context={GMCloud:h.api,importDraft:{roles:[]},importSourceFile:file,cloudSession:{},importMode,cloudVersion:7,id:()=>metadata.id,state:originalState,gameIndex,
    validateGameImport:()=>({errors:[]}),validateReimportChoices:()=>[],$:id=>elements[id]??={},currentGame:()=>current,
    createImportedDocument:()=>({...document,game:{...document.game},sourceRecord:metadata,modifierRecords:[],summary:{warnings:0}}),
    createReimportDocument:()=>({document,sourceRecord:metadata,summary:{}}),localStorage:{setItem:(...args)=>writes.push(args)},gameDataKey:id=>id,
    saveIndex:()=>writes.push('index'),persistImportedRoleModifiers:async()=>[],renderAll:()=>{},showImportSuccess:()=>successes.push(true),
    migrateGameData:data=>data,normalizeMeta:meta=>meta,refreshOpenGame:async()=>{}};
  vm.createContext(context);
  const start=app.indexOf('async function confirmDocumentImport(){'),end=app.indexOf('\nfunction renderHistory',start);
  vm.runInContext(app.slice(start,end)+'\nglobalThis.confirmImport=confirmDocumentImport;',context);
  await context.confirmImport();
  assert.deepEqual(writes,[]);assert.deepEqual(successes,[]);assert.equal(gameIndex.games.length,0);
  assert.equal(context.state,originalState);assert.equal(context.cloudVersion,7);assert.equal(current.id,'test-game');
  assert.match(elements.documentImportError.textContent,/could not be confirmed/);assert.equal(h.objects.size,1);
});

for(const importMode of ['initial','reimport'])test('actual '+importMode+' import handler shows uncertainty and preserves the preview',async()=>{
  const h=harness({failure:new Error('Network response lost'),throws:true,commit:true}),elements={};
  const context={GMCloud:h.api,importDraft:{roles:[]},importSourceFile:file,cloudSession:{},importMode,cloudVersion:7,id:()=>metadata.id,
    validateGameImport:()=>({errors:[]}),validateReimportChoices:()=>[],$:id=>elements[id]??={},currentGame:()=>document.game,
    createImportedDocument:()=>({...document,sourceRecord:metadata}),createReimportDocument:()=>({document,sourceRecord:metadata})};
  vm.createContext(context);
  const start=app.indexOf('async function confirmDocumentImport(){'),end=app.indexOf('\nfunction renderHistory',start);
  assert.ok(start>=0&&end>start);
  vm.runInContext(app.slice(start,end)+'\nglobalThis.confirmImport=confirmDocumentImport;',context);
  await context.confirmImport();
  assert.match(elements.documentImportError.textContent,/Import could not be confirmed:/);
  assert.match(elements.documentImportError.textContent,/retained/);assert.doesNotMatch(elements.documentImportError.textContent,/failed safely/);
  assert.equal(elements.documentImportError.hidden,false);assert.equal(elements.confirmDocumentImportBtn.disabled,false);
  assert.equal(context.importSourceFile,file);assert.equal(context.cloudVersion,7);assert.equal(h.objects.size,1);
});
