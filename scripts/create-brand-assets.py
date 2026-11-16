"""Export the approved Radius SVG masters. The source geometry is frozen in public/brand/radius-v2.
Run from the repository with Node + sharp available. Never retype the wordmark or restore the retired ER mark.
"""
from pathlib import Path
import json,subprocess,zipfile
root=Path(__file__).resolve().parents[1];assets=root/'public/brand/radius-v2'
jobs=[{'input':str(p),'output':str(p.with_suffix('.png')),'width':2600 if 'logo' in p.stem else 1024} for p in assets.glob('*.svg')]
code="let sharp;try{sharp=require('sharp')}catch{sharp=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/sharp')};let b=[];process.stdin.on('data',x=>b.push(x));process.stdin.on('end',async()=>{for(const j of JSON.parse(Buffer.concat(b).toString()))await sharp(j.input,{density:300}).resize({width:j.width}).png().toFile(j.output)});"
subprocess.run(['node','-e',code],input=json.dumps(jobs).encode(),check=True)
with zipfile.ZipFile(assets/'eduradius-logo-kit.zip','w',zipfile.ZIP_DEFLATED) as z:
 for f in sorted(assets.iterdir()):
  if f.suffix in ['.svg','.png'] and 'Preview' not in f.name and 'preview' not in f.name:z.write(f,'EduRadius-Radius-Logo-Kit/'+f.name)
 if (assets/'README.txt').exists():z.write(assets/'README.txt','EduRadius-Radius-Logo-Kit/README.txt')
print('Radius logo exports updated')
