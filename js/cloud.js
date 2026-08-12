(function(){
  const config=window.GM_SUPABASE_CONFIG||{};
  const usernamePattern=/^[A-Za-z0-9][A-Za-z0-9_-]{2,29}$/;
  const accountDomain=config.accountDomain||'users.bipjqwemwqivyassibqm.supabase.co';
  const authStorageKey='gm-command-center-auth-v7';
  let client=null,session=null,profile=null,channel=null,authListener=null;
  const required=()=>{if(!client)throw new Error('Shared database is not configured.');return client};
  const unwrap=({data,error})=>{if(error)throw error;return data};
  const normalizeUsername=value=>String(value||'').trim().toLowerCase();
  const accountEmail=username=>normalizeUsername(username)+'@'+accountDomain;
  const importBucket='game-import-documents';
  const knowledgeBucket='game-knowledge-documents';
  const safeFileName=name=>String(name||'game.docx').replace(/[^a-z0-9._-]+/gi,'-').replace(/^-+|-+$/g,'').slice(-160)||'game.docx';

  function indexedDbStorage(){
    const databaseName='gm-command-center-auth',storeName='sessions',fallback=window.sessionStorage;
    let databasePromise=null;
    const openDatabase=()=>{
      if(!('indexedDB' in window))return Promise.resolve(null);
      if(databasePromise)return databasePromise;
      databasePromise=new Promise((resolve,reject)=>{
        const request=indexedDB.open(databaseName,1);
        request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(storeName))request.result.createObjectStore(storeName)};
        request.onsuccess=()=>resolve(request.result);
        request.onerror=()=>reject(request.error);
      }).catch(()=>null);
      return databasePromise;
    };
    const transact=async(mode,operation)=>{
      const database=await openDatabase();
      if(!database)return null;
      return new Promise((resolve,reject)=>{
        const transaction=database.transaction(storeName,mode),store=transaction.objectStore(storeName),request=operation(store);
        request.onsuccess=()=>resolve(request.result??null);
        request.onerror=()=>reject(request.error);
      });
    };
    return {
      async getItem(key){const database=await openDatabase();if(!database)return fallback.getItem(key);const value=await transact('readonly',store=>store.get(key));return value==null?null:String(value)},
      async setItem(key,value){const database=await openDatabase();if(!database){fallback.setItem(key,value);return}await transact('readwrite',store=>store.put(value,key))},
      async removeItem(key){const database=await openDatabase();if(!database){fallback.removeItem(key);return}await transact('readwrite',store=>store.delete(key))}
    };
  }

  async function migrateLegacyLocalStorageSession(storage){
    try{
      const projectRef=new URL(config.url).hostname.split('.')[0],prefix='sb-'+projectRef+'-auth-token';
      const legacyValue=localStorage.getItem(prefix),currentValue=await storage.getItem(authStorageKey);
      if(legacyValue&&!currentValue)await storage.setItem(authStorageKey,legacyValue);
      Object.keys(localStorage).filter(key=>key.startsWith(prefix)).forEach(key=>localStorage.removeItem(key));
    }catch{}
  }

  function safeUser(){
    if(!session?.user)return null;
    return {
      id:session.user.id,
      username:profile?.username||session.user.user_metadata?.username||'',
      displayName:profile?.display_name||session.user.user_metadata?.display_name||profile?.username||'GM',
      createdAt:profile?.created_at||session.user.created_at||null,
      lastLoginAt:profile?.last_login_at||null,
      isAnonymous:Boolean(session.user.is_anonymous),
      isLegacyAccount:Boolean(profile?.legacy_account)
    };
  }
  const displayName=()=>safeUser()?.displayName||'GM';

  async function loadProfile(touchLogin=false){
    if(!session?.user){profile=null;return null}
    let loaded=unwrap(await required().from('profiles').select('id,username,username_normalized,display_name,created_at,updated_at,last_login_at,legacy_account').eq('id',session.user.id).single());
    if(touchLogin){
      const loggedInAt=new Date().toISOString();
      loaded=unwrap(await required().from('profiles').update({last_login_at:loggedInAt}).eq('id',session.user.id).select('id,username,username_normalized,display_name,created_at,updated_at,last_login_at,legacy_account').single());
    }
    profile=loaded;
    return loaded;
  }

  async function setSession(next,{touchLogin=false}={}){
    session=next;profile=null;
    if(session)await loadProfile(touchLogin);
    return session;
  }

  async function init(onAuth){
    if(!window.supabase?.createClient||!config.url||!config.publishableKey)return {available:false,session:null};
    const storage=indexedDbStorage();await migrateLegacyLocalStorageSession(storage);
    client=window.supabase.createClient(config.url,config.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,storage,storageKey:authStorageKey},realtime:{params:{eventsPerSecond:20}}});
    session=(await client.auth.getSession()).data.session;
    if(session){
      const verified=await client.auth.getUser();
      if(verified.error||!verified.data.user){await client.auth.signOut({scope:'local'});session=null}
    }
    if(session)await setSession(session,{touchLogin:true});
    authListener=client.auth.onAuthStateChange((event,next)=>{
      queueMicrotask(async()=>{
        try{await setSession(next,{touchLogin:event==='SIGNED_IN'});await onAuth?.(next)}catch(error){console.error('Could not restore account profile',error);await client.auth.signOut({scope:'local'});await setSession(null);await onAuth?.(null)}
      });
    }).data.subscription;
    return {available:true,session};
  }

  async function passwordSignIn(username,password){
    const normalized=normalizeUsername(username);
    if(!usernamePattern.test(String(username||'').trim()))throw Object.assign(new Error('Invalid username or password.'),{code:'invalid_credentials'});
    const result=unwrap(await required().auth.signInWithPassword({email:accountEmail(normalized),password}));
    await setSession(result.session,{touchLogin:true});
    return {user:safeUser(),session:Boolean(result.session)};
  }

  async function createAccount(username,password){
    const requested=String(username||'').trim(),normalized=normalizeUsername(requested);
    if(!usernamePattern.test(requested))throw Object.assign(new Error('Invalid username.'),{code:'invalid_username'});
    const result=unwrap(await required().auth.signUp({email:accountEmail(normalized),password,options:{data:{username:requested,username_normalized:normalized,display_name:requested}}}));
    if(Array.isArray(result?.user?.identities)&&result.user.identities.length===0)throw Object.assign(new Error('Username already taken.'),{code:'username_taken'});
    if(!result.session)throw Object.assign(new Error('Account could not be signed in.'),{code:'signup_session_missing'});
    await setSession(result.session,{touchLogin:true});
    return {user:safeUser(),session:true};
  }

  async function upgradeLegacyAccount(username,password){
    const requested=String(username||'').trim(),normalized=normalizeUsername(requested);
    if(!session?.user?.is_anonymous||!profile?.legacy_account)throw Object.assign(new Error('Legacy account session required.'),{code:'auth_required'});
    if(!usernamePattern.test(requested))throw Object.assign(new Error('Invalid username.'),{code:'invalid_username'});
    const updated=unwrap(await required().auth.updateUser({email:accountEmail(normalized),password,data:{username:requested,username_normalized:normalized,display_name:requested}}));
    if(updated.user?.is_anonymous)throw Object.assign(new Error('The permanent sign-in identity could not be attached.'),{code:'upgrade_incomplete'});
    const nextSession=(await required().auth.getSession()).data.session;if(!nextSession)throw new Error('The upgraded session could not be restored.');
    session=nextSession;
    const rows=unwrap(await required().rpc('complete_legacy_account',{requested_username:requested}));profile=rows[0]||await loadProfile(true);
    return {user:safeUser(),session:true};
  }

  async function changePassword(currentPassword,newPassword){
    const current=safeUser();
    if(!current)throw Object.assign(new Error('Authentication required.'),{code:'auth_required'});
    unwrap(await required().auth.signInWithPassword({email:accountEmail(current.username),password:currentPassword}));
    unwrap(await required().auth.updateUser({password:newPassword,current_password:currentPassword}));
    try{unwrap(await required().auth.signOut({scope:'others'}))}catch(error){console.warn('Password changed, but other sessions could not be revoked.',error)}
    await loadProfile(true);
    return {user:safeUser()};
  }

  async function signOut(){
    await unsubscribe();
    try{unwrap(await required().auth.signOut())}catch(error){await required().auth.signOut({scope:'local'});throw error}finally{session=null;profile=null}
  }
  async function listGames(){
    const rows=unwrap(await required().from('games').select('*,game_members(user_id,member_role)').order('updated_at',{ascending:false}));
    return rows.map(row=>({...row,member_role:row.game_members?.find(member=>member.user_id===session.user.id)?.member_role||'viewer'}));
  }
  async function loadGame(gameId){
    const document=unwrap(await required().from('game_documents').select('*').eq('game_id',gameId).single());
    const game=unwrap(await required().from('games').select('*').eq('id',gameId).single());
    const members=unwrap(await required().from('game_members').select('user_id,member_role,created_at,invited_by,profiles(display_name,username)').eq('game_id',gameId));
    return {document,game,members};
  }
  async function createGame(document){return unwrap(await required().rpc('create_game',{game_id:document.game.id,initial_document:document}))}
  async function uploadImportSource(file,metadata){
    const path=session.user.id+'/'+metadata.id+'/'+safeFileName(file.name),options={contentType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',cacheControl:'3600',upsert:false};unwrap(await required().storage.from(importBucket).upload(path,file,options));return path;
  }
  async function removeImportSource(path){try{unwrap(await required().storage.from(importBucket).remove([path]))}catch(error){console.warn('Could not clean up import source',error)}}
  async function createImportedGame(document,file,metadata){
    const storagePath=await uploadImportSource(file,metadata);try{return unwrap(await required().rpc('create_game_from_import',{game_id:document.game.id,initial_document:document,source_import_id:metadata.id,source_file_name:metadata.fileName,source_storage_path:storagePath,source_file_size:metadata.fileSize,source_content_type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',source_sha256:metadata.sha256||'',import_summary:metadata.summary||{},import_warnings:metadata.warnings||[]}))}catch(error){await removeImportSource(storagePath);throw error}
  }
  async function saveGame(gameId,version,document,audit={}){
    const rows=unwrap(await required().rpc('save_game_document',{target_game_id:gameId,expected_version:version,next_document:document,change_action:audit.action||'Game updated',change_entity_type:audit.entityType||'game',change_entity_id:audit.entityId||null}));
    return rows[0];
  }
  async function reimportGame(gameId,version,document,file,metadata){
    const storagePath=await uploadImportSource(file,metadata);try{const rows=unwrap(await required().rpc('save_game_reimport',{target_game_id:gameId,expected_version:version,next_document:document,source_import_id:metadata.id,source_file_name:metadata.fileName,source_storage_path:storagePath,source_file_size:metadata.fileSize,source_content_type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',source_sha256:metadata.sha256||'',import_summary:metadata.summary||{},import_warnings:metadata.warnings||[]}));return rows[0]}catch(error){await removeImportSource(storagePath);throw error}
  }
  async function deleteGame(gameId){return unwrap(await required().rpc('delete_game',{target_game_id:gameId}))}
  async function joinGame(code){const rows=unwrap(await required().rpc('redeem_game_invite',{invite_code:code}));return rows[0]}
  async function invites(gameId){return unwrap(await required().from('game_invites').select('*').eq('game_id',gameId).order('created_at',{ascending:false}))}
  async function generateInvite(gameId,permission,expiresInSeconds,maxUses){const rows=unwrap(await required().rpc('generate_game_invite',{target_game_id:gameId,invite_permission:permission,expires_in_seconds:expiresInSeconds,requested_max_uses:maxUses}));return rows[0]}
  async function revokeInvite(inviteId){return unwrap(await required().rpc('revoke_game_invite',{target_invite_id:inviteId}))}
  async function setMemberRole(gameId,userId,role){return unwrap(await required().rpc('set_game_member_role',{target_game_id:gameId,target_user_id:userId,next_role:role}))}
  async function removeMember(gameId,userId){return unwrap(await required().rpc('remove_game_member',{target_game_id:gameId,target_user_id:userId}))}
  async function roleTemplates(){const rows=unwrap(await required().from('game_documents').select('game_id,document'));return rows.flatMap(row=>(row.document?.data?.roles||[]).map(role=>({key:row.game_id+':'+role.id,sourceGameId:row.game_id,sourceGameName:row.document?.game?.name||'Saved Game',role,abilities:row.document?.data?.abilities||[],factions:row.document?.data?.factions||[]})))}
  async function abilityTemplates(){const rows=unwrap(await required().from('game_documents').select('game_id,document'));return rows.flatMap(row=>(row.document?.data?.abilities||[]).map(ability=>({key:row.game_id+':'+ability.id,sourceGameId:row.game_id,sourceGameName:row.document?.game?.name||'Saved Game',...ability})))}
  async function history(gameId){return unwrap(await required().from('change_history').select('*,profiles!change_history_profile_fkey(display_name,username)').eq('game_id',gameId).order('created_at',{ascending:false}).limit(250))}
  async function statusEffects(gameId){return unwrap(await required().from('player_status_effects').select('*').eq('game_id',gameId).order('created_at',{ascending:true}))}
  async function playerStatusHistory(gameId,playerId=null){return unwrap(await required().rpc('get_player_status_history',{target_game_id:gameId,target_player_id:playerId,max_rows:250}))}
  async function playerState(gameId,playerId){return unwrap(await required().rpc('get_player_state',{target_game_id:gameId,target_player_id:playerId}))}
  async function mutatePlayerStatus(gameId,statusId,operation,payload){return unwrap(await required().rpc('mutate_player_status',{target_game_id:gameId,target_status_id:statusId||null,target_operation:operation,target_payload:payload||{}}))}
  async function applyPlayerStatusChanges(gameId,changes){return unwrap(await required().rpc('apply_player_status_changes',{target_game_id:gameId,target_changes:changes}))}
  async function imports(gameId){return unwrap(await required().from('game_imports').select('*').eq('game_id',gameId).order('created_at',{ascending:false}))}
  async function downloadImport(record){const blob=unwrap(await required().storage.from(importBucket).download(record.storage_path)),link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=record.source_file_name||'game.docx';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000)}
  async function askCopilot(gameId,request){
    const {data,error}=await required().functions.invoke('gm-copilot',{body:{gameId,...request}});
    if(error){
      let payload=null;
      try{payload=await error.context?.json?.()}catch{}
      throw Object.assign(new Error(payload?.error||error.message||'The GM Copilot request failed.'),{code:payload?.code||error.code||'COPILOT_ERROR',status:error.context?.status||null});
    }
    return data;
  }
  async function phaseOneContext(gameId){
    const [documents,abilities,modifiers,conversation]=await Promise.all([
      unwrap(await required().from('official_documents').select('id,document_key,title,document_type,updated_at,official_document_versions!official_document_versions_document_id_fkey(id,version_number,status,requested_status,source_file_name,content_type,file_size,summary,ingestion_error,created_at,completed_at)').eq('game_id',gameId).order('updated_at',{ascending:false})),
      unwrap(await required().rpc('list_standard_abilities',{target_game_id:gameId})),
      unwrap(await required().from('role_ability_modifiers').select('id,role_id,ability_id,version_number,status,modifier_text,created_at').eq('game_id',gameId).eq('status','ACTIVE').order('created_at',{ascending:false})),
      required().from('ai_conversations').select('id').eq('game_id',gameId).eq('active',true).maybeSingle()
    ]);
    let conversationId=conversation.data?.id||null;if(!conversationId&&['owner','gm'].includes((await required().from('game_members').select('member_role').eq('game_id',gameId).eq('user_id',session.user.id).single()).data?.member_role)){conversationId=unwrap(await required().rpc('ensure_ai_conversation',{target_game_id:gameId}))}
    const messages=conversationId?unwrap(await required().from('ai_messages').select('id,role,content,structured_result,model,game_version,created_at').eq('conversation_id',conversationId).order('created_at',{ascending:true}).limit(250)):[];
    return {documents,abilities,modifiers,conversationId,messages};
  }
  async function uploadKnowledgeDocument(gameId,file,metadata){
    const documentId=crypto.randomUUID(),versionId=crypto.randomUUID(),extension=String(file.name||'').toLowerCase().split('.').pop(),contentTypes={docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',pdf:'application/pdf',txt:'text/plain'},contentType=contentTypes[extension],safeName=safeFileName(file.name),storagePath=session.user.id+'/'+gameId+'/'+documentId+'/'+safeName;
    if(!contentType)throw Object.assign(new Error('Choose a DOCX, PDF, or TXT document.'),{code:'INVALID_DOCUMENT'});
    unwrap(await required().storage.from(knowledgeBucket).upload(storagePath,file,{contentType,cacheControl:'3600',upsert:false}));
    try{
      unwrap(await required().rpc('create_knowledge_document',{target_game_id:gameId,target_document_id:documentId,target_version_id:versionId,target_document_key:metadata.documentKey,target_title:metadata.title,target_document_type:metadata.documentType,target_source_file_name:file.name,target_storage_path:storagePath,target_file_size:file.size,target_content_type:contentType,target_source_sha256:metadata.sha256||'',target_status:metadata.status||'ACTIVE'}));
    }catch(error){try{unwrap(await required().storage.from(knowledgeBucket).remove([storagePath]))}catch{}throw error}
    const {data,error}=await required().functions.invoke('gm-knowledge-ingest',{body:{documentVersionId:versionId,depth:metadata.depth||'standard'}});
    if(error){let payload=null;try{payload=await error.context?.json?.()}catch{}throw Object.assign(new Error(payload?.error||error.message||'Document indexing failed.'),{code:payload?.code||'DOCUMENT_INGESTION_FAILED'})}
    return data;
  }
  async function activateAbilityDataset(gameId,datasetId){return unwrap(await required().rpc('activate_standard_ability_dataset',{target_game_id:gameId,target_dataset_id:datasetId}))}
  async function createStandardAbilityVersion(gameId,abilityId,description,structuredData,changeNote){return unwrap(await required().rpc('create_standard_ability_version',{target_game_id:gameId,target_ability_id:abilityId,target_description:description,target_structured_data:structuredData,target_change_note:changeNote||''}))}
  async function standardAbilityHistory(gameId,abilityId){return unwrap(await required().from('standard_ability_versions').select('id,game_id,version_number,status,definition_status,official_description,structured_data,change_note,created_at').eq('ability_id',abilityId).or('game_id.is.null,game_id.eq.'+gameId).order('created_at',{ascending:false}))}
  async function saveRoleAbilityModifier(gameId,roleId,abilityId,modifierText){return unwrap(await required().rpc('save_role_ability_modifier',{target_game_id:gameId,target_role_id:roleId,target_ability_id:abilityId,target_modifier_text:modifierText}))}
  async function startNewAiConversation(gameId){return unwrap(await required().rpc('start_new_ai_conversation',{target_game_id:gameId}))}
  async function resolutionContext(gameId){
    const [sessions,precedents,drafts,interactions,summary,usage,limit]=await Promise.all([
      required().from('resolution_sessions').select('*').eq('game_id',gameId).order('created_at',{ascending:false}).limit(100),
      required().from('gm_precedents').select('*').eq('game_id',gameId).order('updated_at',{ascending:false}).limit(250),
      required().from('ai_drafts').select('*').eq('game_id',gameId).order('created_at',{ascending:false}).limit(100),
      required().from('ability_interactions').select('*').eq('game_id',gameId).eq('active',true).order('updated_at',{ascending:false}).limit(250),
      required().rpc('get_ai_learning_summary',{target_game_id:gameId}),
      required().from('ai_usage_events').select('*').eq('game_id',gameId).order('created_at',{ascending:false}).limit(250),
      required().from('ai_usage_limits').select('*').eq('game_id',gameId).maybeSingle()
    ]);
    for(const result of [sessions,precedents,drafts,interactions,summary])if(result.error)throw result.error;
    return {sessions:sessions.data||[],precedents:precedents.data||[],drafts:drafts.data||[],interactions:interactions.data||[],summary:summary.data||{},usage:usage.error?[]:usage.data||[],limit:limit.error?null:limit.data||null};
  }
  async function resolutionEvents(sessionId){return unwrap(await required().from('resolution_session_events').select('*').eq('session_id',sessionId).order('event_order',{ascending:true}))}
  async function startResolutionSession(gameId,gameVersion){return unwrap(await required().rpc('start_resolution_session',{target_game_id:gameId,expected_game_version:gameVersion}))}
  async function finalizeResolutionSession(sessionId,lockVersion,decision,manualResolution,explanation,teachAi){return unwrap(await required().rpc('finalize_resolution_session',{target_session_id:sessionId,expected_lock_version:lockVersion,target_decision:decision,target_manual_resolution:manualResolution||{},target_gm_explanation:explanation||'',target_teach_ai:Boolean(teachAi)}))}
  async function reviewAiDraft(draftId,status){return unwrap(await required().rpc('review_ai_draft',{target_draft_id:draftId,target_status:status}))}
  async function managePrecedent(precedentId,version,status,supersededBy=null){return unwrap(await required().rpc('manage_gm_precedent',{target_precedent_id:precedentId,expected_version:version,target_status:status,target_superseded_by:supersededBy}))}
  async function setAiUsageLimit(gameId,monthlyLimitUsd,requestsPerMinute){return unwrap(await required().rpc('set_ai_usage_limit',{target_game_id:gameId,target_monthly_limit_usd:monthlyLimitUsd,target_requests_per_minute:requestsPerMinute}))}
  async function analyzeWordDocument(request){
    const {data,error}=await required().functions.invoke('gm-document-import',{body:request});
    if(error){
      let payload=null;
      try{payload=await error.context?.json?.()}catch{}
      throw Object.assign(new Error(payload?.error||error.message||'AI document analysis failed.'),{code:payload?.code||error.code||'AI_IMPORT_ERROR',status:error.context?.status||null});
    }
    return data;
  }
  async function unsubscribe(){if(channel&&client){await client.removeChannel(channel);channel=null}}
  async function subscribe(gameId,{onDocument,onMembership,onInvites,onStatuses,onResolution,onLearning,onPresence,onStatus}){
    await unsubscribe();
    channel=required().channel('game:'+gameId,{config:{private:true,presence:{key:session.user.id}}});
    channel.on('postgres_changes',{event:'UPDATE',schema:'public',table:'game_documents',filter:'game_id=eq.'+gameId},payload=>onDocument?.(payload.new));
    channel.on('postgres_changes',{event:'*',schema:'public',table:'game_members',filter:'game_id=eq.'+gameId},payload=>onMembership?.(payload));
    channel.on('postgres_changes',{event:'*',schema:'public',table:'game_invites',filter:'game_id=eq.'+gameId},payload=>onInvites?.(payload));
    channel.on('postgres_changes',{event:'*',schema:'public',table:'player_status_effects',filter:'game_id=eq.'+gameId},payload=>onStatuses?.(payload));
    channel.on('postgres_changes',{event:'*',schema:'public',table:'resolution_sessions',filter:'game_id=eq.'+gameId},payload=>onResolution?.(payload));
    channel.on('postgres_changes',{event:'*',schema:'public',table:'gm_precedents',filter:'game_id=eq.'+gameId},payload=>onLearning?.(payload));
    channel.on('postgres_changes',{event:'*',schema:'public',table:'ai_drafts',filter:'game_id=eq.'+gameId},payload=>onLearning?.(payload));
    channel.on('presence',{event:'sync'},()=>onPresence?.(channel.presenceState()));
    channel.subscribe(async status=>{
      onStatus?.(status);
      if(status==='SUBSCRIBED')await channel.track({userId:session.user.id,name:displayName(),view:'game',editing:null,onlineAt:new Date().toISOString()});
    });
  }
  async function track(patch){if(channel)await channel.track({userId:session.user.id,name:displayName(),onlineAt:new Date().toISOString(),...patch})}
  function user(){return safeUser()}
  function account(){return profile?{...profile}:null}
  function dispose(){authListener?.unsubscribe();unsubscribe()}
  window.GMCloud={init,passwordSignIn,createAccount,upgradeLegacyAccount,changePassword,signOut,listGames,loadGame,createGame,createImportedGame,reimportGame,saveGame,deleteGame,joinGame,invites,generateInvite,revokeInvite,setMemberRole,removeMember,roleTemplates,abilityTemplates,history,statusEffects,playerStatusHistory,playerState,mutatePlayerStatus,applyPlayerStatusChanges,imports,downloadImport,askCopilot,analyzeWordDocument,phaseOneContext,uploadKnowledgeDocument,activateAbilityDataset,createStandardAbilityVersion,standardAbilityHistory,saveRoleAbilityModifier,startNewAiConversation,resolutionContext,resolutionEvents,startResolutionSession,finalizeResolutionSession,reviewAiDraft,managePrecedent,setAiUsageLimit,subscribe,unsubscribe,track,user,account,dispose,normalizeUsername};
})();
