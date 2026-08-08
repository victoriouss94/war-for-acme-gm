import {access,readFile} from 'node:fs/promises';
const files=['index.html','css/main.css','js/supabase-config.js','js/cloud.js','js/app.js'];
await Promise.all(files.map(file=>access(file)));
const html=await readFile('index.html','utf8');
for(const file of files.slice(1))if(!html.includes(file.split('?')[0]))throw new Error(`index.html does not load ${file}`);
console.log('Static build verified:',files.join(', '));
