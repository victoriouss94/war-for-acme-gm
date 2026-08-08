(function(){
  const config=window.GM_SUPABASE_CONFIG||{};
  let client=null,session=null,channel=null,authListener=null;
  const required=()=>{if(!client)throw new Error('Shared database is not configured.');return client};
  const unwrap=({data,error})=>{if(error)throw error;return data};
  const displayName=()=>session?.user?.user_metadata?.display_name||session?.user?.email?.split('@')[0]||'GM';
  const importBucket='game-import-documents';
  const safeFileName=name=>String(name||'game.docx').replace(/[^a-z0-9._-]+/gi,'-').replace(/^-+|-+$/g,'').slice(-160)||'game.docx';

  async function init(onAuth){
    if(!window.supabase?.createClient||!config.url||!config.publishableKey)return {available:false,session:null};
    client=window.supabase.createClient(config.url,config.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true},realtime:{params:{eventsPerSecond:20}}});
    session=(await client.auth.getSession()).data.session;
    authListener=client.auth.onAuthStateChange((_event,next)=>{session=next;queueMicrotask(()=>onAuth?.(next))}).data.subscription;
    return {available:true,session};
  }
  async function signIn(email,name){
    const redirectTo=location.origin+location.pathname;
    return unwrap(await required().auth.signInWithOtp({email,options:{emailRedirectTo:redirectTo,data:{display_name:name||email.split('@')[0]}}}));
  }
  async function passwordSignIn(email,password){return unwrap(await required().auth.signInWithPassword({email,password}))}
  async function createAccount(email,password,name){return unwrap(await required().auth.signUp({email,password,options:{emailRedirectTo:location.origin+location.pathname,data:{display_name:name||email.split('@')[0]}}}))}
  async function signOut(){await unsubscribe();unwrap(await required().auth.signOut())}
  async function listGames(){
    const rows=unwrap(await required().from('games').select('*,game_members(user_id,member_role)').order('updated_at',{ascending:false}));
    return rows.map(row=>({...row,member_role:row.game_members?.find(m=>m.user_id===session.user.id)?.member_role||'viewer'}));
  }
  async function loadGame(gameId){
    const document=unwrap(await required().from('game_documents').select('*').eq('game_id',gameId).single());
    const game=unwrap(await required().from('games').select('*').eq('id',gameId).single());
    const members=unwrap(await required().from('game_members').select('user_id,member_role,created_at,invited_by,profiles(display_name)').eq('game_id',gameId));
    return {document,game,members};
  }
  async function createGame(document){return unwrap(await required().rpc('create_game',{game_id:document.game.id,initial_document:document}));}
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
  async function history(gameId){return unwrap(await required().from('change_history').select('*,profiles!change_history_profile_fkey(display_name)').eq('game_id',gameId).order('created_at',{ascending:false}).limit(250))}
  async function imports(gameId){return unwrap(await required().from('game_imports').select('*').eq('game_id',gameId).order('created_at',{ascending:false}))}
  async function downloadImport(record){const blob=unwrap(await required().storage.from(importBucket).download(record.storage_path)),link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=record.source_file_name||'game.docx';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000)}
  async function unsubscribe(){if(channel&&client){await client.removeChannel(channel);channel=null}}
  async function subscribe(gameId,{onDocument,onMembership,onInvites,onPresence,onStatus}){
    await unsubscribe();
    channel=required().channel('game:'+gameId,{config:{private:true,presence:{key:session.user.id}}});
    channel.on('postgres_changes',{event:'UPDATE',schema:'public',table:'game_documents',filter:'game_id=eq.'+gameId},payload=>onDocument?.(payload.new));
    channel.on('postgres_changes',{event:'*',schema:'public',table:'game_members',filter:'game_id=eq.'+gameId},payload=>onMembership?.(payload));
    channel.on('postgres_changes',{event:'*',schema:'public',table:'game_invites',filter:'game_id=eq.'+gameId},payload=>onInvites?.(payload));
    channel.on('presence',{event:'sync'},()=>onPresence?.(channel.presenceState()));
    channel.subscribe(async status=>{
      onStatus?.(status);
      if(status==='SUBSCRIBED')await channel.track({userId:session.user.id,name:displayName(),view:'game',editing:null,onlineAt:new Date().toISOString()});
    });
  }
  async function track(patch){if(channel)await channel.track({userId:session.user.id,name:displayName(),onlineAt:new Date().toISOString(),...patch})}
  function user(){return session?.user||null}
  function dispose(){authListener?.unsubscribe();unsubscribe()}
  window.GMCloud={init,signIn,passwordSignIn,createAccount,signOut,listGames,loadGame,createGame,createImportedGame,reimportGame,saveGame,deleteGame,joinGame,invites,generateInvite,revokeInvite,setMemberRole,removeMember,roleTemplates,abilityTemplates,history,imports,downloadImport,subscribe,unsubscribe,track,user,dispose};
})();
