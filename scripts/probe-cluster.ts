import { cluster } from '../tests/postgres/cluster.js';
try{const c=await cluster();console.log('PostgreSQL isolado e migrations originais: OK');await c.stop();}catch(e){let current:unknown=e;while(current instanceof Error){console.error(current.message);current=current.cause;}process.exitCode=1;}
