import { timingSafeEqual } from 'node:crypto';
import type { Request,Response } from 'express';
import type { Config } from '../config/config.js';
import { encrypt,decrypt } from '../infrastructure/crypto.js';
import type { FluxoGoogleResponseModel,SessaoResponseModel } from '../contracts/models.js';
import { ServiceError,success } from '../domain/errors.js';
export interface BrowserTokens {accessToken:string;refreshToken:string;}
export class BrowserCookies {
  constructor(readonly config:Config) {}
  name(kind:'sessao'|'google'){return (this.config.production?'__Host-':'')+'concursa-'+kind;}
  private readCookie(req:Request,name:string){const pairs=(req.headers.cookie??'').split(';').map(p=>p.trim().split('='));const get=(n:string)=>pairs.find(p=>p[0]===n)?.slice(1).join('=');let value=get(name);if(value?.startsWith('chunks-')){const count=Number(value.slice(7));if(!Number.isInteger(count)||count<1||count>20)return undefined;value=Array.from({length:count},(_,i)=>get(name+'C'+(i+1))??'').join('');}return value?decodeURIComponent(value):undefined;}
  read<T>(req:Request,kind:'sessao'|'google'):T|null {try{if(this.config.auth.key.length<64)return null;const value=this.readCookie(req,this.name(kind));if(!value)return null;const data=JSON.parse(decrypt(value,this.config.auth.key,'ConcursaAI/node-cookie/'+kind+'/v1')) as {expires:number;data:T};return data.expires>Date.now()?data.data:null;}catch{return null;}}
  write(res:Response,kind:'sessao'|'google',data:unknown){const value=encrypt(JSON.stringify({expires:Date.now()+(kind==='google'?600000:604800000),data}),this.config.auth.key,'ConcursaAI/node-cookie/'+kind+'/v1');const options={httpOnly:true,secure:this.config.production,sameSite:kind==='google'?'lax' as const:'strict' as const,path:'/',...(kind==='google'?{maxAge:600000}:{})};const name=this.name(kind);if(value.length>3800){const chunks=value.match(/.{1,3800}/g)!;res.cookie(name,'chunks-'+chunks.length,options);chunks.forEach((chunk,i)=>res.cookie(name+'C'+(i+1),chunk,options));}else res.cookie(name,value,options);}
  remove(res:Response,kind:'sessao'|'google'){const options={httpOnly:true,secure:this.config.production,sameSite:kind==='google'?'lax' as const:'strict' as const,path:'/'};res.clearCookie(this.name(kind),options);for(let i=1;i<=20;i++)res.clearCookie(this.name(kind)+'C'+i,options);}
  session(res:Response,s:SessaoResponseModel){this.write(res,'sessao',{accessToken:s.accessToken,refreshToken:s.refreshToken});return success({usuario:s.usuario,expiresIn:s.expiresIn},'Acesso realizado.');}
  consumeGoogle(req:Request,res:Response,state:string) {const flow=this.read<FluxoGoogleResponseModel>(req,'google');this.remove(res,'google');if(!flow||!state?.trim()||state.length>100)throw new ServiceError('A confirmação do Google expirou. Inicie novamente.');const a=Buffer.from(flow.estado),b=Buffer.from(state);if(a.length!==b.length||!timingSafeEqual(a,b))throw new ServiceError('Confirmação do Google inválida. Inicie novamente.');return flow;}
}
