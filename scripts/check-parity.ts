import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import inventory from '../docs/source-inventory.json' with {type:'json'};
import routes from '../src/contracts/routes.json' with {type:'json'};
import { createServices } from '../src/application/services.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config/config.js';
const runtime=createApp({config:loadConfig({LOG_LEVEL:'silent'})});
const services=createServices(runtime.db,runtime.auth,new (await import('../src/infrastructure/providers.js')).OpenAIProvider(runtime.config),{id:'',sessionId:'',token:''});
assert.equal(routes.length,inventory.routes.length);
for(const route of routes){if(['Navegador','ResendWebhook'].includes(route.controller))continue;assert.equal(typeof services[route.action as keyof typeof services],'function',route.path);}
let verified=0;
for(const file of inventory.files){const path=join('../ConcursaAI.BackEnd',file.path);const actual=createHash('sha256').update(await readFile(path)).digest('hex');assert.equal(actual,file.sha256,'Origem alterada desde inventário: '+file.path);verified++;}
console.log(`${routes.length} endpoints com implementação registrada; ${verified} arquivos da origem preservados.`);
await runtime.db.close();
