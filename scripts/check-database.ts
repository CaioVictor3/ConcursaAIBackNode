import { Database } from '../src/infrastructure/database.js';
import { loadConfig } from '../src/config/config.js';
const db=new Database(loadConfig());
try {const result=await db.query<{user:string;version:string;count:string}>(`select current_user as user,current_setting('server_version') as version,(select count(*) from information_schema.tables where table_schema in ('public','identidade','comunicacao')) as count`);console.log(JSON.stringify({reachable:true,restrictedRole:result.rows[0]!.user.split('.')[0]==='concursa_backend',postgres:result.rows[0]!.version,visibleTables:Number(result.rows[0]!.count)}));}
catch(error){const e=error as {code?:string;name?:string};console.log(JSON.stringify({reachable:false,errorType:e.name,code:e.code??'CONFIGURATION'}));process.exitCode=1;}finally{await db.close();}
