import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {COPILOT_MAX_MESSAGE_LENGTH,copilotChangeLabel,normalizeCopilotRequest,normalizeCopilotResponse,validateCopilotChanges} from '../js/copilot.js';

const gameState={
  players:[{id:'player-1',name:'Rowan',alive:true,roleId:'role-1'}],
  roles:[{id:'role-1',name:'Watcher'},{id:'role-2',name:'Guardian'}],
  actions:[{id:'action-1',name:'Watch Rowan'}]
};

test('AI GM requests are bounded and normalized',()=>{
  const request=normalizeCopilotRequest({message:'  Resolve this  ',task:'resolve_actions',depth:'deep',history:Array.from({length:12},(_,index)=>({role:index%2?'assistant':'user',content:'message '+index}))});
  assert.deepEqual({message:request.message,task:request.task,depth:request.depth,historyLength:request.history.length},{message:'Resolve this',task:'resolve_actions',depth:'deep',historyLength:8});
  assert.throws(()=>normalizeCopilotRequest({message:'   '}),/question first/);
  assert.equal(normalizeCopilotRequest({message:'x'.repeat(COPILOT_MAX_MESSAGE_LENGTH+5)}).message.length,COPILOT_MAX_MESSAGE_LENGTH);
});

test('AI GM responses keep supported fields without trusting unknown change types',()=>{
  const result=normalizeCopilotResponse({answer:'Ruling',confidence:'high',ruling_basis:['Watcher ability'],warnings:[],follow_up_questions:[],proposed_changes:[{kind:'erase_game',target_id:'',value:'everything',reason:'unsafe'}]});
  assert.equal(result.answer,'Ruling');assert.equal(result.confidence,'high');assert.equal(result.proposed_changes[0].kind,'erase_game');
  const review=validateCopilotChanges(result.proposed_changes,gameState);
  assert.equal(review.valid.length,0);assert.match(review.rejected[0].reason,/Unsupported/);
});

test('AI GM proposals are allowlisted and revalidated against current game IDs',()=>{
  const proposals=[
    {kind:'remove_action',target_id:'action-1',value:'',reason:'resolved'},
    {kind:'set_player_alive',target_id:'player-1',value:'false',reason:'killed'},
    {kind:'set_player_role',target_id:'player-1',value:'role-2',reason:'converted'},
    {kind:'set_game_phase',target_id:'',value:'Night',reason:'advance'},
    {kind:'set_game_day',target_id:'',value:'7',reason:'advance'},
    {kind:'add_history',target_id:'',value:'Resolution recorded.',reason:'audit'},
    {kind:'remove_action',target_id:'missing',value:'',reason:'stale'},
    {kind:'set_game_day',target_id:'',value:'1000',reason:'invalid'}
  ];
  const review=validateCopilotChanges(proposals,gameState);
  assert.equal(review.valid.length,4);assert.equal(review.rejected.length,4);
  assert.ok(review.rejected.some(item=>item.change.kind==='set_game_phase'));
  assert.ok(review.rejected.some(item=>item.change.kind==='set_game_day'));
  assert.equal(copilotChangeLabel(proposals[1],gameState),'Mark dead Rowan');
  assert.equal(copilotChangeLabel(proposals[2],gameState),'Set Rowan role to Guardian');
});

test('AI GM frontend and Edge Function enforce authenticated human approval boundaries',async()=>{
  const [html,app,cloud,edge,service]=await Promise.all([
    readFile('index.html','utf8'),readFile('js/app.js','utf8'),readFile('js/cloud.js','utf8'),readFile('supabase/functions/gm-copilot/index.ts','utf8'),readFile('supabase/functions/_shared/ai-service.ts','utf8')
  ]);
  for(const id of ['copilotView','copilotTask','copilotDepth','copilotResolveQueueBtn','copilotConversation','copilotForm','copilotPrompt','copilotAskBtn'])assert.match(html,new RegExp(`id="${id}"`));
  assert.match(app,/validateCopilotChanges\(entry\.editedChanges\|\|result\.proposed_changes,state,liveStatuses\)/);
  assert.match(app,/Review the AI GM proposal before applying it/);
  assert.match(app,/entry\.applied=true;save\('AI GM proposal approved and applied/);
  assert.match(cloud,/functions\.invoke\('gm-copilot'/);
  assert.doesNotMatch(app+cloud,/OPENAI_API_KEY|api\.openai\.com/);
  for(const pattern of [/from\('game_members'\)/,/\['owner','gm'\]/,/from\('game_documents'\)/,/requires_gm_decision/,/match_game_knowledge/,/record_master_gm_exchange_internal/])assert.match(edge,pattern);
  for(const pattern of [/auth\.getUser\(token\)/,/Deno\.env\.get\('OPENAI_API_KEY'\)/,/gpt-5\.6-terra/,/gpt-5\.6-sol/,/store:false/,/type:'json_schema'/,/strict:true/])assert.match(service,pattern);
  assert.doesNotMatch(edge,/service_role/i);
});
