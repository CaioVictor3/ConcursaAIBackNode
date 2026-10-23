from pathlib import Path
import shutil
source=Path('../ConcursaAI.BackEnd');target=Path('.tmp/dotnet-reference')
if not target.exists():
 def ignore(d,names):return [n for n in names if n.startswith('.') or n in ['obj','bin','artifacts','appsettings.Local.json']]
 shutil.copytree(source,target,ignore=ignore)
