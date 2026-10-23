import tableJson from '../contracts/tables.json' with { type:'json' };
import { project } from '../contracts/codec.js';
import type { Models } from '../contracts/models.js';
import { Database, quote, type UserContext } from './database.js';
import { ServiceError } from '../domain/errors.js';
type Table = keyof typeof tableJson;
interface TableMap { table:string; key:string; select:string; columns:Record<string,string>; }
const tables: Record<Table,TableMap> = tableJson;
export interface Filter { column:string; op:'eq'|'ne'|'contains'|'ieq'|'in'; value:unknown; }
export const eq = (column:string,value:unknown):Filter => ({column,op:'eq',value});
export const ne = (column:string,value:unknown):Filter => ({column,op:'ne',value});
export const contains = (column:string,value:string):Filter => ({column,op:'contains',value:value.trim()});
export const ieq = (column:string,value:string):Filter => ({column,op:'ieq',value});
export const within = (column:string,value:readonly string[]):Filter => ({column,op:'in',value});
export interface Query { filters?:Filter[]; or?:Filter[]; order?:[string,boolean?][]; offset?:number; limit?:number; }
export class Repository {
  constructor(readonly db:Database,readonly user:UserContext) {}
  private column(map:TableMap,name:string) {
    const alias = map.select.split(',').map(x=>x.split(':')).find(p=>p[0]===name && p.length===2);
    const physical = alias?.[1] ?? name;
    if (!map.columns[physical]) throw new Error('Coluna não mapeada.'); return physical;
  }
  async query<K extends keyof Models>(table:Table, model:K, request:Query = {}):Promise<{itens:Models[K][];total:number}> {
    const limit=request.limit??1000, offset=request.offset??0;
    if (offset<0 || limit<1 || limit>1000) throw new Error('Intervalo de consulta inválido.');
    return this.db.asUser(this.user, async client => {
      const map=tables[table], params:unknown[]=[];
      const param=(v:unknown)=>{params.push(v);return '$'+params.length;};
      const condition=(f:Filter)=>{
        const col=quote(this.column(map,f.column));
        if (f.value===null) return `${col} is ${f.op==='ne'?'not ':''}null`;
        let value=f.value;
        if (f.op==='contains' || f.op==='ieq') {value=String(value).replace(/[\\%_]/g,'\\$&');if(f.op==='contains')value='%'+value+'%';}
        const p=param(value);
        return f.op==='in'?`${col}=any(${p}::uuid[])`: `${col}${f.op==='ne'?'<>':f.op==='contains'||f.op==='ieq'?' ilike ':'='}${p}`;
      };
      const parts=(request.filters??[]).map(condition);
      if(request.or?.length)parts.push('('+request.or.map(condition).join(' or ')+')');
      const where=parts.length?' where '+parts.join(' and '):'';
      const selection=map.select.split(',').map(c=>{const [alias,physical]=c.split(':');return physical?quote(physical)+' as '+quote(alias!):quote(alias!);}).join(',');
      const order=request.order?.length?request.order.map(([c,desc])=>quote(this.column(map,c))+(desc?' desc':' asc')).join(','):quote(map.key);
      const lim=param(limit),off=param(offset);
      const sql=`select jsonb_build_object('itens',coalesce((select jsonb_agg(to_jsonb(x)) from (select ${selection} from public.${quote(map.table)}${where} order by ${order} limit ${lim} offset ${off}) x),'[]'::jsonb),'total',(select count(*) from public.${quote(map.table)}${where})) as value`;
      const result=await client.query<{value:{itens:unknown[];total:number}}>(sql,params);
      const data=result.rows[0]!.value;
      return {itens:data.itens.map(x=>project(model,x)),total:data.total};
    });
  }
  async one<K extends keyof Models>(table:Table,model:K,filters:Filter[],message='Registro não encontrado.',or?:Filter[]):Promise<Models[K]> {
    const result=await this.query(table,model,{filters,or,limit:2});
    if(result.itens.length!==1)throw new ServiceError(message,404);return result.itens[0]!;
  }
  async optional<K extends keyof Models>(table:Table,model:K,filters:Filter[]):Promise<Models[K]|null> {return (await this.query(table,model,{filters,limit:2})).itens[0]??null;}
  async exists(table:Table,filters:Filter[]) {return (await this.query(table,'VerificarSistemaRequestModel',{filters,limit:1})).total>0;}
  async all<K extends keyof Models>(table:Table,model:K,request:Query={}):Promise<Models[K][]> {
    const items:Models[K][]=[];
    for(let offset=0;;offset+=500){const page=await this.query(table,model,{...request,offset,limit:500});items.push(...page.itens);if(items.length>=page.total)return items;if(!page.itens.length)throw new ServiceError('A consulta foi alterada. Tente novamente.',409);}
  }
  async mutate(table:Table,operation:'insert'|'update'|'delete',id:string,data:Record<string,unknown>={}) {
    if(!['Questao','Concurso','Assunto','Banca','Disciplina'].includes(table))throw new Error('Esta tabela só pode ser alterada pelas funções autorizadas do banco.');
    return this.db.asUser(this.user,async client=>{
      const map=tables[table],values:unknown[]=[id],keys=Object.keys(data).map(k=>this.column(map,k));
      const value=(v:unknown)=>{values.push(v);return '$'+values.length;};
      let sql:string;
      if(operation==='delete')sql=`delete from public.${quote(map.table)} where ${quote(map.key)}=$1`;
      else if(operation==='insert') {values.length=0;if(data[map.key]!==id)throw new Error('Identidade de registro inválida.');sql=`insert into public.${quote(map.table)} (${keys.map(quote).join(',')}) values (${Object.values(data).map(value).join(',')})`;}
      else {if(!keys.length||keys.includes(map.key))throw new Error('Campos de atualização inválidos.');sql=`update public.${quote(map.table)} set ${keys.map((k,i)=>quote(k)+'='+value(Object.values(data)[i])).join(',')} where ${quote(map.key)}=$1`;}
      const result=await client.query(sql+' returning '+quote(map.key),values);
      if(result.rowCount!==1)throw new ServiceError('O registro não existe ou não pôde ser alterado.',404);
    });
  }
  async rpc<T>(name:string,params:Record<string,unknown>={},list=false):Promise<T> {
    if(!/^[a-z_]+$/.test(name)||Object.keys(params).some(k=>!/^[a-z_]+$/.test(k)))throw new Error('Identificador de função inválido.');
    return this.db.asUser(this.user,async client=>{
      const values=Object.values(params).map(v=>v!==null&&typeof v==='object'&&!Array.isArray(v)?JSON.stringify(v):v);
      const args=Object.keys(params).map((k,i)=>quote(k)+'=> $'+(i+1)).join(',');
      const call=`public.${quote(name)}(${args})`;
      const sql=list?`select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) as value from ${call} x`:`select to_jsonb(${call}) as value`;
      return (await client.query<{value:T}>(sql,values)).rows[0]!.value;
    });
  }
  async rpcModel<K extends keyof Models>(name:string,model:K,params:Record<string,unknown>={}) { const value=await this.rpc<unknown>(name,params);return value===null?null:project(model,value); }
}
