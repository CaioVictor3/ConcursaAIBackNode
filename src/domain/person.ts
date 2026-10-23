import type { DadosPessoaRequestModel } from '../contracts/models.js';
import { ServiceError } from './errors.js';
export function validatePerson(p:DadosPessoaRequestModel) {
  if(!p)throw new ServiceError('Informe os dados pessoais.');
  const name=p.nomeCompleto?.trim().replace(/\s+/g,' ')??'';
  if(name.length<3||name.length>200||!name.includes(' '))throw new ServiceError('Informe nome e sobrenome.');
  if(!p.dataNascimento||p.dataNascimento<'1900-01-01'||p.dataNascimento>new Date().toISOString().slice(0,10))throw new ServiceError('Informe uma data de nascimento válida.');
  const cpf=p.cpf?.replace(/\D/g,'')??'';
  let valid=cpf.length===11&&!/^(.)\1+$/.test(cpf);
  for(let position=9;valid&&position<=10;position++){let sum=0;for(let i=0;i<position;i++)sum+=Number(cpf[i])*(position+1-i);const rest=sum*10%11;valid=Number(cpf[position])===(rest===10?0:rest);}
  if(!valid)throw new ServiceError('Informe um CPF válido.');
  const cep=p.cep?.replace(/\D/g,'')??'';if(cep.length!==8)throw new ServiceError('Informe um CEP de oito dígitos.');
  if(!p.logradouro?.trim()||!p.numero?.trim()||!p.bairro?.trim()||!p.cidade?.trim()||!/^[a-zA-Z]{2}$/.test(p.uf?.trim()??''))throw new ServiceError('Complete o endereço.');
  return {nome_completo:name,data_nascimento:p.dataNascimento,cpf,cep,logradouro:p.logradouro.trim(),numero:p.numero.trim(),complemento:p.complemento?.trim()??null,bairro:p.bairro.trim(),cidade:p.cidade.trim(),uf:p.uf.trim().toUpperCase()};
}
