import pathlib,zipfile,json,hashlib
root=pathlib.Path(__file__).resolve().parent
allowed=[f for f in root.iterdir() if f.is_file() and f.suffix in ['.md','.mjs','.py','.json']]
allowed += list((root/'engine').glob('*.mjs'))+list((root/'test').glob('*.mjs'))+[root/'.gitignore']
out=root/'.work/gen2-native-monitor-canary-source.zip';out.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
 for f in sorted(allowed):z.write(f,'gen2-monitor-canary/'+f.relative_to(root).as_posix())
with zipfile.ZipFile(out) as z:
 assert all('/base/' not in n and '/output/' not in n and '/.work/' not in n for n in z.namelist())
print(json.dumps({'sourceFiles':len(allowed),'bytes':out.stat().st_size,'sha256':hashlib.sha256(out.read_bytes()).hexdigest(),'path':str(out)}))
