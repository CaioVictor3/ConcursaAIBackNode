"""Read-only extraction of the original contracts and provenance; never loads secret values."""
from pathlib import Path
import re,json,hashlib,shutil
root=Path(__file__).resolve().parents[1]; source=root.parent/'ConcursaAI.BackEnd'
models={}
primitive={'string':'string','Guid':'string','DateOnly':'string','DateTimeOffset':'string','int':'number','long':'number','decimal':'number','double':'number','bool':'boolean','JsonElement':'unknown','object':'unknown'}
camel=lambda s:s[0].lower()+s[1:]
def field(t,n,default=None,required=False):
 nullable=t.endswith('?'); typ=t.rstrip('?'); array=re.match(r'IReadOnlyList<(.+)>',typ)
 return {'name':camel(n),'type':typ,'nullable':nullable,'array':bool(array),'item':array[1] if array else None,'default':default,'required':required}
for p in sorted((source/'ConcursaAI.Application/Models').rglob('*.cs')):
 s=p.read_text(); c=re.search(r'(?:class|record) (\w+)(?:\s*:\s*(\w+))?',s)
 if not c or c[1]=='Response':continue
 fields=[]
 for m in re.finditer(r'((?:\[[^\]]+\]\s*)*)public ([\w<>?]+) (\w+)\s*\{\s*get;\s*(?:init|set);\s*\}\s*(?:=\s*([^;]+);)?',s):
  fields.append(field(m[2],m[3],m[4], 'Required' in m[1]))
 if not fields and re.search(r'record \w+\(',s):
  args=re.search(r'record \w+\((.*?)\);',s,re.S)
  if args:
   for t,n in re.findall(r'([\w<>?]+) (\w+)',args[1]):fields.append(field(t,n))
 models[c[1]]={'base':c[2], 'fields':fields,'source':str(p.relative_to(source))}
def ts(t):
 nullable=t.endswith('?');t=t.rstrip('?');a=re.match(r'IReadOnlyList<(.+)>',t)
 return (ts(a[1])+'[]' if a else primitive.get(t,t)) + (' | null' if nullable else '')
lines=['// Extracted from the original .NET DTOs; see scripts/inventory.py.','export interface ApiResponse<T> { success: boolean; message: string; statusCode: number; data: T | null; }']
for n,m in models.items():
 lines.append('export interface '+n+(' extends '+m['base'] if m['base'] else '')+' {')
 for f in m['fields']:lines.append('  '+f['name']+': '+ts(f['type']+('?' if f['nullable'] else ''))+';')
 if n=='QuestaoPublicaResponseModel':lines.append('  revisaoPendente: boolean;')
 lines.append('}')
lines+=['export interface Models {']+['  '+n+': '+n+';' for n in models]+['}']
(root/'src/contracts/models.ts').write_text('\n'.join(lines)+'\n')
(root/'src/contracts/metadata.json').write_text(json.dumps(models,ensure_ascii=False,indent=2))
routes=[]
for p in sorted((source/'ConcursaAI.Api/Controllers').glob('*.cs')):
 s=p.read_text();controller=p.stem.removesuffix('Controller'); classhead=s.split('public sealed class')[0]
 for m in re.finditer(r'\[Http(Get|Post|Put|Patch|Delete)\("([^"]+)"\)\](.*?)(?=\[Http|\Z)',s,re.S):
  block=m[3]; sig=re.search(r'public (?:async )?[^\n]+? (\w+)\(\[From(Query|Body)\] (\w+) request',block)
  if not sig:raise Exception(str(p)+m[2])
  before=s[:m.start()]; attrs=before[before.rfind('=> Ok'):]
  # Action attributes can precede Http; use the region after previous method, not the entire class.
  tail=before[max(before.rfind(';'),before.rfind('}'))+1:]
  response=re.search(r'ProducesResponseType<Response<(\w+)>',block)
  routes.append({'method':m[1].upper(),'path':'/api/'+controller+'/'+m[2], 'action':camel(sig[1].removesuffix('Async')),'request':sig[3], 'response':response[1] if response else 'VerificarSistemaResponseModel','binding':sig[2].lower(),'anonymous':('AllowAnonymous' in classhead or 'AllowAnonymous' in tail),'controller':controller,'source':str(p.relative_to(source))})
(root/'src/contracts/routes.json').write_text(json.dumps(routes,ensure_ascii=False,indent=2))
maptext=(source/'ConcursaAI.Infra/Supabase/Dados/ModelosSupabase.cs').read_text(); maps={}
for name,model,cols,key in re.findall(r'TabelaSupabase\.(\w+) => \(typeof\((\w+)\), "([^"]+)", "([^"]+)"\)',maptext):
 s=(source/'ConcursaAI.Infra/Supabase/Dados/Models'/ (model+'.cs')).read_text()
 maps[name]={'table':re.search(r'\[Table\("([^"]+)"',s)[1],'key':key,'select':cols,'columns':{}}
 for attr,t,n in re.findall(r'\[(Column|PrimaryKey)\("([^"]+)"[^\]]*\)\]\s*public ([\w?]+)',s):pass
 for col,t in re.findall(r'\[(?:Column|PrimaryKey)\("([^"]+)"[^\]]*\)\]\s*public ([\w?]+)',s):maps[name]['columns'][col]=t
(root/'src/contracts/tables.json').write_text(json.dumps(maps,ensure_ascii=False,indent=2))
files=[]
for p in sorted(source.rglob('*')):
 if not p.is_file() or any(x in p.parts for x in ['obj','bin','.git','.vs','.agents','skills','artifacts','.supabase']):continue
 b=p.read_bytes(); files.append({'path':str(p.relative_to(source)),'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()})
(root/'docs/source-inventory.json').write_text(json.dumps({'files':files,'routes':routes,'models':list(models)},ensure_ascii=False,indent=2))
for name in ['migrations','tests']:
 shutil.copytree(source/'database'/name,root/'database/reference'/name,dirs_exist_ok=True)
shutil.copy2(source/'database/schema-supabase.json',root/'database/reference/schema-supabase.json')
if not (root/'tools/importacao').exists():
 shutil.copytree(source/'tools/importacao',root/'tools/importacao')
shutil.copytree(source/'ConcursaAI.Api/certificados',root/'certificates',dirs_exist_ok=True)
print(f'{len(files)} arquivos inventariados; {len(routes)} rotas; {len(models)} DTOs; {len(maps)} tabelas/projeções.')
