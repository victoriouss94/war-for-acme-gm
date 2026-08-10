import {access,readFile} from 'node:fs/promises';
const files=['index.html','css/main.css','vendor/mammoth.browser.min.js','js/supabase-config.js','js/cloud.js','js/document-import.js','js/copilot.js','js/app.js','supabase/functions/gm-copilot/index.ts'];
await Promise.all(files.map(file=>access(file)));
const html=await readFile('index.html','utf8');
for(const file of ['css/main.css','vendor/mammoth.browser.min.js','js/supabase-config.js','js/cloud.js','js/app.js'])if(!html.includes(file))throw new Error(`index.html does not load ${file}`);
const app=await readFile('js/app.js','utf8');
if(!app.includes("from './document-import.js'"))throw new Error('app.js does not load js/document-import.js');
if(!app.includes("from './copilot.js'"))throw new Error('app.js does not load js/copilot.js');
console.log('Static build verified:',files.join(', '));
