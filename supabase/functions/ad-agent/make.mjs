// Puts playbook.md into index.ts (between the PLAYBOOK markers), so the function deploys as one file.
// Run after editing the playbook:  node supabase/functions/ad-agent/make.mjs
import { readFileSync, writeFileSync } from 'node:fs';
const dir = new URL('.', import.meta.url);
const md = readFileSync(new URL('playbook.md', dir), 'utf8').replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
const file = new URL('index.ts', dir);
const src = readFileSync(file, 'utf8');
const out = src.replace(/\/\/ PLAYBOOK:START[\s\S]*?\/\/ PLAYBOOK:END/, `// PLAYBOOK:START\nexport const PLAYBOOK = \`${md}\`;\n// PLAYBOOK:END`);
writeFileSync(file, out);
console.log(`playbook inlined (${md.length} chars)`);
