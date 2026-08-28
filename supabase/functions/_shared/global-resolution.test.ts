import {classifyAndOrderResolutionActions,classifyResolutionAction,GLOBAL_RESOLUTION_ORDER} from './global-resolution.ts';

const equal=(actual:unknown,expected:unknown,message:string)=>{
  if(JSON.stringify(actual)!==JSON.stringify(expected))throw new Error(`${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
};

Deno.test('Edge classifier prefers the exact longest ability meaning',()=>{
  const result=classifyResolutionAction({name:'Super Protect',standardizedAbilityType:'Super Protect'});
  equal(result.standardizedAbilityType,'Super Protect','standardized ability');
  equal(result.resolutionCategory,'STATUS_EFFECTS','resolution category');
});

Deno.test('Edge classifier semantically maps longer Roleblock wording',()=>{
  const result=classifyResolutionAction({name:'Stop a player from acting tonight'});
  equal(result.standardizedAbilityType,'Roleblock','semantic ability');
  equal(result.resolutionPriority,1,'semantic priority');
});

Deno.test('Edge ordering is category-first and keeps passives event driven',()=>{
  const result=classifyAndOrderResolutionActions([{id:'kill',name:'Personal Instant Kill'},{id:'convert',name:'Convert'},{id:'reflect',name:'Reflection'}]);
  equal(GLOBAL_RESOLUTION_ORDER,['BLOCKS','GUARANTEE','CONTROL','SWAPS','REDIRECTS','STATUS_EFFECTS','INTEL','CONVERTS','KILLS','DOC'],'global order');
  equal(result.ordered.map(item=>item.id),['convert','kill'],'ordered actions');
  equal(result.passives.map(item=>item.id),['reflect'],'event-driven passives');
});

Deno.test('role-defined passives cannot enter the numbered order',()=>{
  const result=classifyResolutionAction({name:'Custom Mirror',resolutionCategory:'REDIRECTS',activePassive:'PASSIVE'});
  equal(result.resolutionCategory,'PASSIVES','passive category');
  equal(result.resolutionTiming,'EVENT_TRIGGERED','passive timing');
  equal(result.resolutionPriority,null,'passive priority');
});
