#!/usr/bin/env python3
"""Loopback-only web-katrain static host and same-origin public Fox SGF gateway."""
from __future__ import annotations
import argparse,json,mimetypes,os,sys
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from urllib.parse import parse_qs,unquote,urlparse
# In a release fox.py is adjacent; in the local prototype it lives one level up.
if not (Path(__file__).resolve().parent/'fox.py').exists():
 sys.path.insert(0,str(Path(__file__).resolve().parent.parent))
from fox import FoxClient,FoxError

def make_handler(client,dist,manifest):
 dist=Path(dist).resolve()
 class Handler(BaseHTTPRequestHandler):
  server_version='WebKatrainFox/0.1'
  def reply(self,status,body,ctype='application/json; charset=utf-8',filename=None):
   if isinstance(body,(dict,list)):body=json.dumps(body,ensure_ascii=False).encode()
   if isinstance(body,str):body=body.encode()
   self.send_response(status)
   self.send_header('Content-Type',ctype);self.send_header('Content-Length',str(len(body)))
   self.send_header('Cache-Control','no-store' if 'json' in ctype or 'html' in ctype else 'public, max-age=3600')
   self.send_header('X-Content-Type-Options','nosniff')
   self.send_header('Referrer-Policy','no-referrer')
   self.send_header('Cross-Origin-Opener-Policy','same-origin')
   self.send_header('Cross-Origin-Embedder-Policy','require-corp')
   self.send_header('Content-Security-Policy',"frame-ancestors 'self'; object-src 'none'")
   if filename:self.send_header('Content-Disposition',f'attachment; filename="{filename}"')
   self.end_headers()
   if self.command!='HEAD':self.wfile.write(body)
  def do_HEAD(self):self.do_GET()
  def do_GET(self):
   host=self.headers.get('Host','')
   if host not in (f'127.0.0.1:{self.server.server_port}',f'localhost:{self.server.server_port}'):
    return self.reply(403,{'error':'Only loopback Host headers are allowed.'})
   origin=self.headers.get('Origin')
   if (origin and origin!='http://'+host) or self.headers.get('Sec-Fetch-Site')=='cross-site':
    return self.reply(403,{'error':'Cross-origin requests are disabled.'})
   parsed=urlparse(self.path);path=parsed.path
   params=parse_qs(parsed.query,keep_blank_values=True)
   def arg(key,default=''):
    values=params.get(key,[default])
    if len(values)!=1:raise ValueError(f'参数 {key} 不可重复。')
    return values[0]
   try:
    if path=='/api/fox/status':
     return self.reply(200,{'ok':True,'upstream_repo':'ykrsama/web-katrain',**manifest,'fox':'public-records-only','sgf_policy':'raw-download; explicit-komi-confirmation-on-import','bind':'127.0.0.1'})
    if path=='/api/fox/search':
     q=arg('q');mode=arg('mode','nickname')
     if not q or mode not in ('nickname','uid'):raise ValueError('请输入昵称或 UID，并选择正确模式。')
     user=client.resolve(q,mode)
     return self.reply(200,{'user':user,**client.games(user['uid'])})
    if path=='/api/fox/games':
     if not arg('uid'):raise ValueError('缺少 UID。')
     return self.reply(200,client.games(arg('uid'),arg('cursor','0')))
    if path=='/api/fox/sgf':
     if not arg('id'):raise ValueError('缺少棋谱 ID。')
     return self.reply(200,client.fetch_sgf(arg('id')))
    if path.startswith('/api/fox/download/') and path.endswith('.sgf'):
     chessid=unquote(path[len('/api/fox/download/'):-4])
     data=client.fetch_sgf(chessid)
     return self.reply(200,data['sgf'],'application/x-go-sgf; charset=utf-8',f'fox-{chessid}.sgf')
    if path.startswith('/api/'):
     return self.reply(404,{'error':'Unknown API route'})
    decoded=unquote(path)
    if '\x00' in decoded or '..' in Path(decoded).parts:return self.reply(403,{'error':'Invalid static path'})
    file=(dist/decoded.lstrip('/')).resolve() if path!='/' else dist/'index.html'
    if not file.is_relative_to(dist):return self.reply(403,{'error':'Static path escapes dist'})
    if not file.is_file():return self.reply(404,{'error':'Static asset not found'})
    ctype=mimetypes.guess_type(str(file))[0] or 'application/octet-stream'
    if file.suffix=='.wasm':ctype='application/wasm'
    if file.suffix in ('.js','.mjs'):ctype='text/javascript; charset=utf-8'
    return self.reply(200,file.read_bytes(),ctype)
   except ValueError as e:return self.reply(400,{'error':str(e)})
   except FoxError as e:return self.reply(502,{'error':str(e),'source':'fox-public-api'})
   except (BrokenPipeError,ConnectionResetError):return
   except Exception as e:
    print('Request failed',type(e).__name__,str(e),flush=True)
    return self.reply(500,{'error':'部署网关发生错误，请查看服务日志。'})
 return Handler

def main():
 p=argparse.ArgumentParser(description=__doc__)
 p.add_argument('--dist',type=Path,required=True);p.add_argument('--manifest',type=Path,required=True)
 p.add_argument('--port',type=int,default=18767);p.add_argument('--proxy',default='')
 a=p.parse_args()
 if not (a.dist/'index.html').is_file():raise SystemExit('Missing built dist/index.html')
 manifest=json.loads(a.manifest.read_text())
 server=ThreadingHTTPServer(('127.0.0.1',a.port),make_handler(FoxClient(proxy=a.proxy),a.dist,manifest))
 server.daemon_threads=True
 print(json.dumps({'listen':f'http://127.0.0.1:{a.port}','manifest':manifest}),flush=True)
 try:server.serve_forever()
 except KeyboardInterrupt:pass
 finally:server.server_close()
if __name__=='__main__':main()
