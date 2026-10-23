import express,{type Request,type Response,type ErrorRequestHandler} from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { pino,type Logger } from 'pino';
import { randomUUID,randomBytes } from 'node:crypto';
import { loadConfig,type Config } from './config/config.js';
import { Database,type UserContext } from './infrastructure/database.js';
import { Accounts } from './infrastructure/accounts.js';
import { Emails } from './infrastructure/emails.js';
import { GoogleProvider,OpenAIProvider,type HttpFetch } from './infrastructure/providers.js';
import { Auth } from './application/auth.js';
import { createServices,type Services } from './application/services.js';
import { dispatch } from './http/dispatch.js';
import { BrowserCookies,type BrowserTokens } from './http/cookies.js';
import { bind } from './contracts/codec.js';
import { success,failure,classifyError,ServiceError } from './domain/errors.js';
import routes from './contracts/routes.json' with {type:'json'};
import { openapi } from './http/openapi.js';
import swaggerUi from 'swagger-ui-express';
export interface AppOptions {config?:Config;database?:Database;logger?:Logger;fetch?:HttpFetch;}
export function createApp(options:AppOptions={}) {
  const config=options.config??loadConfig(),db=options.database??new Database(config),logger=options.logger??pino({level:config.logLevel,redact:['authorization','cookie','password','senha','token','refreshToken','accessToken']}),http=options.fetch??fetch;
  const emails=new Emails(db,config,http),auth=new Auth(config,new Accounts(db),emails,new GoogleProvider(config,http)),ai=new OpenAIProvider(config,http),cookies=new BrowserCookies(config),app=express();
  app.disable('x-powered-by');app.set('trust proxy',config.trustProxy);app.use(helmet({contentSecurityPolicy:false}));
  app.use((req,res,next)=>{res.setHeader('Cache-Control','no-store');const id=randomUUID();res.setHeader('X-Request-Id',id);const start=Date.now();res.on('finish',()=>logger.info({requestId:id,method:req.method,path:req.path,status:res.statusCode,durationMs:Date.now()-start},'HTTP'));next();});
  app.use(cors({origin(origin,cb){cb(null,!!origin&&config.origins.includes(origin));},credentials:true}));
  app.use((req,res,next)=>{const mutation=!['GET','HEAD','OPTIONS'].includes(req.method),session=cookies.read<BrowserTokens>(req,'sessao');if(mutation&&(req.path.toLowerCase().startsWith('/api/navegador')||session)){if(req.get('X-Concursa-Client')!=='web'||!config.origins.includes(req.get('Origin')??'')){res.status(403).json(failure(403,'Origem da solicitação não autorizada.'));return;}}next();});
  const limiter=(limit:number)=>rateLimit({windowMs:60000,limit,standardHeaders:'draft-8',legacyHeaders:false,handler:(_req,res)=>{res.status(429).json(failure(429,'Muitas tentativas. Aguarde um minuto e tente novamente.'));}}),authLimit=limiter(10),cepLimit=limiter(30);
  const webhookProblem=(res:Response,status:number)=>res.status(status).type('application/problem+json').json({type:'https://tools.ietf.org/html/rfc9110#section-15.5.'+(status===401?'2':'1'),title:status===401?'Unauthorized':'Bad Request',status,traceId:'00-'+randomBytes(16).toString('hex')+'-'+randomBytes(8).toString('hex')+'-00'});
  app.post('/api/ResendWebhook/registrar-evento-entrega',express.raw({type:()=>true,limit:65536}),async(req,res)=>{const body=req.body as Buffer;if(!Buffer.isBuffer(body)||!emails.verifyWebhook(req.get('svix-id')??'',req.get('svix-timestamp')??'',req.get('svix-signature')??'',body)){webhookProblem(res,401);return;}let event:{type?:unknown;data?:{email_id?:unknown}};try{event=JSON.parse(body.toString());if(typeof event.type!=='string'||typeof event.data?.email_id!=='string'){webhookProblem(res,400);return;}}catch{webhookProblem(res,400);return;}if(event.type?.trim()&&event.data?.email_id?.trim())await emails.event(req.get('svix-id')!,event.data.email_id,event.type);res.json(success({recebido:true},'Evento recebido.'));});
  app.use(express.json({limit:'10mb',strict:true}));
  app.get('/api/health',(_req,res)=>res.json(success({status:'healthy',aplicacao:'ConcursaAI',runtime:'node',bancoConfigurado:db.configured},'API em execução.')));
  const spec=openapi();app.get(['/openapi/v1.json','/api/openapi.json'],(_req,res)=>res.json(spec));app.use('/api/docs',swaggerUi.serve,swaggerUi.setup(spec));
  for(const route of routes) {
    if(route.controller==='ResendWebhook')continue;
    // Authorization precedes rate limiting, as in the original pipeline.
    const run=async(req:Request,res:Response)=>{
      let user:UserContext={id:'',sessionId:'',token:''};const header=req.get('Authorization');const access=header?.match(/^Bearer\s+(.+)$/i)?.[1]??(!header?cookies.read<BrowserTokens>(req,'sessao')?.accessToken:undefined);
      if(access){try{user=await auth.authenticate(access);}catch(error){if(!route.anonymous)throw error;}}
      if(!route.anonymous&&!user.id){res.setHeader('WWW-Authenticate','Bearer');throw new ServiceError('Entre na sua conta para continuar.',401);}
      const execute=async()=>{const services=createServices(db,auth,ai,user);if(route.controller==='Navegador'){await browser(route.action,req,res,services,cookies);return;}
        const handlers=dispatch(services,route.binding==='query'),handler=handlers[route.path as keyof typeof handlers];if(!handler)throw new Error('Endpoint sem implementação.');const input=route.binding==='query'?req.query:req.body;if(input===undefined)throw new ServiceError('Confira os campos informados e envie uma requisição válida.');res.json(await handler(input));};
      const limit=route.controller==='Autenticacao'||route.controller==='Navegador'?authLimit:route.controller==='Cep'?cepLimit:null;
      if(limit)await new Promise<void>((resolve,reject)=>{limit(req,res,error=>{if(error){reject(error);return;}execute().then(resolve,reject);});res.once('finish',resolve);});else await execute();
    };
    const method=route.method.toLowerCase() as 'get'|'post'|'put'|'patch'|'delete';app[method](route.path,run);
  }
  app.use((_req,res)=>res.status(404).json(failure(404,'Endpoint não encontrado.')));
  const errors:ErrorRequestHandler=(error,req,res,_next)=>{if(res.headersSent)return;const {status,message}=classifyError(error);if(status===401)res.setHeader('WWW-Authenticate','Bearer');logger.warn({requestId:res.getHeader('X-Request-Id'),status,errorType:error instanceof Error?error.name:'Unknown'},'Requisição recusada');res.status(status).json(failure(status,message));};app.use(errors);
  return {app,db,config,logger,emails,auth};
}
async function browser(action:string,req:Request,res:Response,services:Services,cookies:BrowserCookies) {
  const save=(s:Awaited<ReturnType<Services['entrarEstudante']>>)=>{if(!s.data)throw new ServiceError('Sessão indisponível.',503);res.json({...cookies.session(res,s.data),message:s.message});};
  if(req.method!=='GET'&&req.body===undefined)throw new ServiceError('Confira os campos informados e envie uma requisição válida.');
  switch(action){
    case 'obterConfiguracaoAcesso':res.json(await services.obterConfiguracaoAcesso(bind('ObterConfiguracaoAcessoRequestModel',req.query,true)));return;
    case 'obterVinculoGoogle':res.json(await services.obterVinculoGoogle(bind('ObterVinculoGoogleRequestModel',req.query,true)));return;
    case 'iniciarGoogle':case 'iniciarVinculoGoogle':{
      bind(action==='iniciarGoogle'?'IniciarGoogleRequestModel':'IniciarVinculoGoogleRequestModel',req.body);
      const flow=await services[action]({origemFrontend:req.get('Origin')??null});if(!flow.data)throw new ServiceError('Fluxo Google indisponível.',503);cookies.write(res,'google',flow.data);res.json(success({url:flow.data.url},flow.message));return;
    }
    case 'concluirGoogle':{const q=bind('ConcluirGoogleRequestModel',req.body),flow=cookies.consumeGoogle(req,res,q.estado);save(await services.trocarCodigoGoogle({codigo:q.codigo,verificador:flow.verificador,nonce:flow.nonce,redirectUri:flow.redirectUri,idUsuarioVinculo:flow.idUsuarioVinculo}));return;}
    case 'entrarEstudante':save(await services.entrarEstudante(bind('EntrarEstudanteRequestModel',req.body)));return;
    case 'entrarAdministrador':save(await services.entrarAdministrador(bind('EntrarAdministradorRequestModel',req.body)));return;
    case 'confirmarSessao':save(await services.renovarSessao(bind('RenovarSessaoRequestModel',req.body)));return;
    case 'renovarSessao':{bind('RenovarSessaoNavegadorRequestModel',req.body);const s=cookies.read<BrowserTokens>(req,'sessao');if(!s)throw new ServiceError('Entre na sua conta para continuar.',401);try{save(await services.renovarSessao({refreshToken:s.refreshToken}));}catch(e){if(e instanceof ServiceError&&[401,403].includes(e.status))cookies.remove(res,'sessao');throw e;}return;}
    case 'sairSessao':{const result=await services.sairSessao(bind('SairSessaoRequestModel',req.body));cookies.remove(res,'sessao');res.json(result);return;}
    default:throw new Error('Endpoint de navegador desconhecido.');
  }
}
