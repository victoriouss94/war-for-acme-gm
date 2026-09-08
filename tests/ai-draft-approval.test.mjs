import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const app=await readFile(new URL('../js/app.js',import.meta.url),'utf8');
const approval=app.slice(app.indexOf('async function approveAiDraft('),app.indexOf('async function rejectAiDraft('));
function fixture(options={}){
  const game={id:'audit-game'},calls=[],alerts=[];
  const state={players:[],roles:[],abilities:[{id:'audit-ability',name:'Ask'}],factions:[{id:'audit-faction',name:'Village'}],rules:[],history:[]};
  const context={state,cloudDirty:false,cloudSaveInFlight:false,aiDraftApprovalPending:false,cloudVersion:7,
    currentGame:()=>game,canEditGame:()=>true,draftRecordValue:record=>record,normalized:value=>String(value??'').trim().toLowerCase(),
    id:()=> 'new-entity',now:()=> '2026-09-08T00:00:00Z',normalizeFaction:entity=>entity,normalizeRule:entity=>entity,normalizeRole:entity=>entity,
    ROLE_TYPES:{BASIC:'BASIC',STANDARD:'STANDARD'},ABILITY_DATA_STATUSES:{INTENTIONALLY_NONE:'INTENTIONALLY_NONE',COMPLETE:'COMPLETE'},
    abilityFromStableId:()=>state.abilities[0],confirm:()=>true,alert:message=>alerts.push(message),
    save:()=>calls.push('non-atomic-save'),setCloudSavePaused:()=>calls.push('paused'),setConnection:()=>{},
    refreshAiGmData:async()=>calls.push('refresh'),
    applyCloudDocument:row=>{calls.push('apply');context.state=row.document.data},
    GMCloud:{user:()=>({id:'audit-owner'}),reviewAiDraft:async()=>calls.push('review'),
      approveAndAddAiDraft:async(draftId,version,entity)=>{
        calls.push('atomic');assert.equal(version,7);assert.equal(context.state,state);
        assert.equal(state.factions.length,1);assert.equal(state.roles.length,0);assert.equal(state.rules.length,0);assert.equal(state.abilities.length,1);
        if(options.rpc)return options.rpc({context,game,entity});
        return {document:{game,data:{...state,[options.collection??'factions']:[...state[options.collection??'factions'],entity]}},version:8};
      }}
  };
  vm.createContext(context);vm.runInContext(approval,context);
  const payload={name:'New entry',description:'Definition',category:'Neutral',alignment:'',win_condition:'',special_mechanics:[],relationships:[],balance_notes:[],resolution_notes:[],potential_interactions:[],exceptions:[],standard_ability_ids:['ask'],active_abilities:['Ask'],passive_abilities:[],role_modifiers:[],immunities:[],uses:'',cooldowns:'',role_type:'STANDARD',slot_count:1,faction_id:'audit-faction',faction_name:'Village',active_passive:'ACTIVE',targeting:''};
  const record={id:'draft-1',game_id:game.id,status:'DRAFT',draft_type:options.type??'FACTION',title:'New entry',payload};
  return {context,record,calls,alerts,game,state};
}
for(const [type,collection] of [['ROLE','roles'],['ABILITY','abilities'],['FACTION','factions'],['RULE','rules']]){
  test(type+' approval makes one atomic call before changing local content',async()=>{
    const f=fixture({type,collection});await f.context.approveAiDraft(f.record);
    assert.deepEqual(f.alerts,[]);assert.deepEqual(f.calls,['atomic','apply','refresh']);
    assert.equal(f.context.state[collection].at(-1).id,'new-entity');
    assert.equal(f.context.aiDraftApprovalPending,false);
  });
}
test('failed draft approval does not append local content or schedule a save',async()=>{
  const f=fixture({rpc:async()=>{throw new Error('VERSION_CONFLICT')}});
  await f.context.approveAiDraft(f.record);
  assert.equal(f.context.state,f.state);assert.equal(f.state.factions.length,1);
  assert.deepEqual(f.calls,['atomic']);assert.match(f.alerts[0],/VERSION_CONFLICT|game changed/i);
  assert.equal(f.context.aiDraftApprovalPending,false);
});
test('pending unsynced changes prevent draft approval',async()=>{
  const f=fixture();f.context.cloudDirty=true;await f.context.approveAiDraft(f.record);
  assert.deepEqual(f.calls,[]);assert.equal(f.state.factions.length,1);assert.ok(f.alerts.length);
});
test('a game switch during approval cannot replace the newly selected game',async()=>{
  const f=fixture({rpc:async({game})=>{game.id='another-game';return {document:{data:{}}}}});
  await f.context.approveAiDraft(f.record);assert.deepEqual(f.calls,['atomic']);assert.equal(f.context.state,f.state);
});
test('unsynced edits made while approval is in flight are not overwritten',async()=>{
  const f=fixture({rpc:async({context})=>{context.cloudDirty=true;return {document:{data:{}}}}});
  await f.context.approveAiDraft(f.record);assert.equal(f.context.state,f.state);assert.ok(!f.calls.includes('apply'));assert.ok(f.calls.includes('paused'));
});
test('status-only draft review never applies a live status',async()=>{
  const f=fixture({type:'STATUS'});await f.context.approveAiDraft(f.record);
  assert.deepEqual(f.calls,['review','refresh']);assert.equal(f.context.state,f.state);
});
test('a second click while approval is pending cannot submit another request',async()=>{
  let release;
  const f=fixture({rpc:()=>new Promise(resolve=>{release=resolve})});
  const first=f.context.approveAiDraft(f.record);
  assert.equal(f.context.aiDraftApprovalPending,true);
  await f.context.approveAiDraft(f.record);assert.deepEqual(f.calls,['atomic']);
  release({document:{data:f.state}});await first;
  assert.equal(f.context.aiDraftApprovalPending,false);
});
test('cloud bridge exposes the atomic RPC and release loads its new cache key',async()=>{
  const cloud=await readFile(new URL('../js/cloud.js',import.meta.url),'utf8'),html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  assert.match(cloud,/approveAndAddAiDraft\(draftId,version,entity\).*rpc\('approve_and_add_ai_draft',\{target_draft_id:draftId,expected_game_version:version,target_entity:entity\}\)/);
  assert.match(cloud,/window.GMCloud.approveAndAddAiDraft=approveAndAddAiDraft/);
  assert.match(html,/js\/cloud\.js\?v=12\.2\.20/);
});
test('stale cross-game or already-reviewed draft cannot be approved',async()=>{
  for(const changes of [{game_id:'other-game'},{status:'APPROVED'}]){
    const f=fixture();Object.assign(f.record,changes);await f.context.approveAiDraft(f.record);assert.deepEqual(f.calls,[]);
  }
});
