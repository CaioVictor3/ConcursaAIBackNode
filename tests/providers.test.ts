import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config/config.js';
import { OpenAIProvider,consultCep,type HttpFetch } from '../src/infrastructure/providers.js';
const fetchReturning=(body:unknown,status=200):HttpFetch=>(async()=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}})) as HttpFetch;
test('ViaCEP: contrato, sanitização, não encontrado e indisponibilidade',async()=>{
  const result=await consultCep('38400-100','https://viacep.com.br/ws/',fetchReturning({logradouro:'Rua',bairro:'Centro',localidade:'Uberlândia',uf:'MG'}));assert.deepEqual(result,{cep:'38400100',logradouro:'Rua',bairro:'Centro',cidade:'Uberlândia',uf:'MG'});
  await assert.rejects(consultCep('1234','https://viacep.com.br/ws/',fetchReturning({})));await assert.rejects(consultCep('12345678','https://viacep.com.br/ws/',fetchReturning({erro:true})),{status:404});await assert.rejects(consultCep('12345678','https://viacep.com.br/ws/',fetchReturning({},500)),{status:503});
});
test('OpenAI Responses envia modelo, prompt, schema estrito e não armazena',async()=>{
  const cfg=loadConfig({OPENAI_API_KEY:'test-only'}),context={enunciado:'Questão',explicacaoOficial:'Explicação',alternativas:[{idAlternativa:'a',texto:'A'},{idAlternativa:'b',texto:'B'}]};let payload:Record<string,unknown>={};
  const http:HttpFetch=async(_url,init)=>{payload=JSON.parse(init!.body as string);return new Response(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"resumo":"Resumo"}'}]}]}));};
  const result=await new OpenAIProvider(cfg,http).generate(context);assert.deepEqual(result,{resumo:'Resumo'});assert.equal(payload.model,'gpt-4.1-mini');assert.equal(payload.store,false);assert.equal(payload.max_output_tokens,4000);assert.equal(((payload.text as {format:{strict:boolean}}).format.strict),true);
  await assert.rejects(new OpenAIProvider(cfg,fetchReturning({},429)).generate(context),{status:503});await assert.rejects(new OpenAIProvider(cfg,fetchReturning({status:'incomplete'})).generate(context),{status:502});await assert.rejects(new OpenAIProvider(cfg,http).generate({...context,alternativas:[]}),{status:422});
});
test('Google OAuth valida PKCE, assinatura JWKS, issuer, audience, nonce, azp e email verificado',async()=>{
  const {GoogleProvider}=await import('../src/infrastructure/providers.js');const {generateKeyPair,exportJWK,SignJWT}=await import('jose');const keys=await generateKeyPair('RS256');const jwk=await exportJWK(keys.publicKey);Object.assign(jwk,{kid:'test-rsa',alg:'RS256',use:'sig'});
  const cfg=loadConfig({GOOGLE_CLIENT_ID:'client-test',GOOGLE_CLIENT_SECRET:'secret-test'});let claims:Record<string,unknown>={email:'person@example.test',email_verified:true,nonce:'expected-nonce',azp:'client-test',name:'Pessoa Teste'};let form='';
  const http:HttpFetch=async(url,init)=>{
    if(String(url).endsWith('/token')){form=String(init?.body);const token=await new SignJWT(claims).setProtectedHeader({alg:'RS256',kid:'test-rsa'}).setSubject('subject-test').setIssuer('https://accounts.google.com').setAudience('client-test').setExpirationTime('5m').sign(keys.privateKey);return new Response(JSON.stringify({id_token:token}));}
    if(String(url).includes('openid-configuration'))return new Response(JSON.stringify({jwks_uri:'https://www.googleapis.com/oauth2/v3/certs'}));
    return new Response(JSON.stringify({keys:[jwk]}),{headers:{'Content-Type':'application/json'}});
  };
  const provider=new GoogleProvider(cfg,http),url=new URL(provider.url('state','challenge','expected-nonce','http://localhost/auth'));assert.equal(url.searchParams.get('code_challenge_method'),'S256');
  assert.deepEqual(await provider.confirm('code','verifier','expected-nonce','http://localhost/auth'),{subject:'subject-test',email:'person@example.test',name:'Pessoa Teste'});assert.ok(form.includes('code_verifier=verifier'));
  await assert.rejects(provider.confirm('code','verifier','wrong-nonce','http://localhost/auth'),{status:401});claims={...claims,email_verified:false};await assert.rejects(provider.confirm('code','verifier','expected-nonce','http://localhost/auth'),{status:401});claims={...claims,email_verified:true,azp:'another-client'};await assert.rejects(provider.confirm('code','verifier','expected-nonce','http://localhost/auth'),{status:401});
});
