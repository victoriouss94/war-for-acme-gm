import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
function render(raw,session={}){
  const marker=source.includes('function resolutionAccountingWarningHtml(')?'function resolutionAccountingWarningHtml(':'function resolutionOutputHtml(';
  const start=source.indexOf(marker),end=source.indexOf('\nfunction ',source.indexOf('function resolutionOutputHtml('));
  return vm.runInNewContext(source.slice(start,end)+'\nresolutionOutputHtml(raw)',{
    raw,currentResolutionSession:()=>session,normalizeResolution:value=>value,
    buildResolutionDraft:({proposal})=>proposal,trackerResolutionOutputHtml:()=>'<section>Actual ruling retained</section>',
    state:{players:[]}
  });
}
const warning={action_id:'custom',accounting_warning:'AI usage could not be saved.'};
test('actual resolution renderer shows incomplete accounting without replacing the ruling',()=>{
  const raw={ai_adjudications:[warning]},before=JSON.stringify(raw),html=render(raw);
  assert.match(html,/AI usage recording incomplete/);assert.match(html,/Actual ruling retained/);
  assert.equal(JSON.stringify(raw),before);
});
test('approved result retains the warning from saved session adjudications',()=>{
  assert.match(render({title:'Approved'},{status:'FINALIZED',ai_adjudications:[warning]}),/AI usage recording incomplete/);
});
test('older saved engine proposal preserves the accounting notice',()=>{
  assert.match(render({title:'Approved'},{engine_proposal:{ai_adjudications:[warning]}}),/AI usage recording incomplete/);
});
test('duplicate warning sources show one notice and never render provider text or markup',()=>{
  const malicious={...warning,accounting_warning:'<script>secret provider trace</script>'};
  const html=render({ai_adjudications:[malicious]},{ai_adjudications:[malicious],engine_proposal:{ai_adjudications:[malicious]}});
  assert.equal((html.match(/AI usage recording incomplete/g)||[]).length,1);
  assert.doesNotMatch(html,/secret provider trace|<script>/);
  assert.match(html,/Do not re-run the resolution/);
});
test('known-only, successful and malformed accounting metadata create no warning',()=>{
  for(const raw of [{},{ai_adjudications:[{action_id:'ok'}]},{ai_adjudications:'invalid'},{ai_adjudications:[null,{accounting_warning:''},{accounting_warning:{}}]}]){
    assert.equal(render(raw,{ai_adjudications:null}),'<section>Actual ruling retained</section>');
  }
});
