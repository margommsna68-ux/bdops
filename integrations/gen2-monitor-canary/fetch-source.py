"""Populate ignored base fixtures from staging, or pinned read-only SFTP. Never runs remote commands."""
import argparse,hashlib,importlib.util,json,pathlib
ROOT=pathlib.Path(__file__).resolve().parent
manifest=json.loads((ROOT/'base-sha256.json').read_text(encoding='utf-8'))
parser=argparse.ArgumentParser();parser.add_argument('--sftp',action='store_true');args=parser.parse_args()
staging=ROOT.parent.parent/'.runtime/fleet-m1-source/gen2-app'
client=None;sftp=None
try:
 for name,expected in manifest['base'].items():
  remote_name='package.json' if name=='gen2-package.json' else name
  source=staging/remote_name
  if source.exists():data=source.read_bytes()
  elif args.sftp:
   if client is None:
    spec=importlib.util.spec_from_file_location('backup','D:/MoneyToHome/tools/moon-backup.py');b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
    conf=json.loads(b.dpapi((b.TOOLS/'backup-connection.dpapi').read_bytes(),False))
    client=b.paramiko.SSHClient();client.load_host_keys(str(b.TOOLS/'backup-known-hosts'));client.set_missing_host_key_policy(b.paramiko.RejectPolicy())
    client.connect('100.118.159.15',username='meo3',password=conf['password'],allow_agent=False,look_for_keys=False,timeout=20,auth_timeout=20);del conf
    sftp=client.open_sftp()
   with sftp.open('C:/GEN-MERGE/work/app/'+remote_name,'rb') as f:data=f.read()
  else:raise RuntimeError('Missing pinned staging source: '+remote_name+'; use --sftp for read-only retrieval')
  if hashlib.sha256(data).hexdigest()!=expected:raise RuntimeError('BASE_SHA_MISMATCH: '+remote_name)
  target=ROOT/'base'/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
 print(json.dumps({'verifiedBaseFiles':len(manifest['base']),'remoteCommands':0,'remoteWrites':0}))
finally:
 if sftp:sftp.close()
 if client:client.close()
