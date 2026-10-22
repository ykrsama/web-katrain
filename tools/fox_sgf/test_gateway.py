import pathlib,sys,tempfile,threading,unittest,urllib.request,json
from http.server import ThreadingHTTPServer
HERE=pathlib.Path(__file__).resolve().parent
sys.path.insert(0,str(HERE));sys.path.insert(0,str(HERE.parent))

class GatewayTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory()
  self.dist=pathlib.Path(self.temp.name)
  (self.dist/'index.html').write_text('<html>YKR static build</html>')
  from fox import FoxClient
  self.client=FoxClient(proxy='')
  if (HERE/'gateway.py').exists():
   from gateway import make_handler
   handler=make_handler(self.client,self.dist,{'upstream_commit':'test-sha'})
  else:
   from server import make_handler
   handler=make_handler(self.client)
  self.server=ThreadingHTTPServer(('127.0.0.1',0),handler)
  self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
  self.base='http://127.0.0.1:'+str(self.server.server_port)
  self.opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
 def tearDown(self):
  self.server.shutdown();self.server.server_close();self.thread.join();self.temp.cleanup()
 def get(self,path,headers=None):return self.opener.open(urllib.request.Request(self.base+path,headers=headers or {}),timeout=3)
 def test_root_serves_the_built_web_katrain_not_the_old_prototype(self):
  with self.get('/') as r:self.assertEqual(r.read().decode(),'<html>YKR static build</html>')
 def test_status_reports_pinned_upstream(self):
  with self.get('/api/fox/status') as r:self.assertEqual(json.load(r)['upstream_commit'],'test-sha')
 def test_static_assets_keep_javascript_and_wasm_mime(self):
  for name,content,ctype in [('app.js',b'export const ok=true','text/javascript'),('engine.wasm',b'\x00asm','application/wasm')]:
   (self.dist/name).write_bytes(content)
   with self.get('/'+name) as r:
    self.assertTrue(r.headers['Content-Type'].startswith(ctype));self.assertEqual(r.read(),content)
 def assert_http_error(self,path,status,headers=None):
  with self.assertRaises(urllib.error.HTTPError) as raised:self.get(path,headers)
  self.assertEqual(raised.exception.code,status)
 def test_foreign_origin_and_host_are_blocked(self):
  self.assert_http_error('/api/fox/status',403,{'Origin':'https://foreign.example'})
  self.assert_http_error('/api/fox/status',403,{'Host':'foreign.example'})
 def test_repeated_parameters_and_missing_inputs_are_not_silently_accepted(self):
  self.assert_http_error('/api/fox/search?q=x&q=y',400)
  self.assert_http_error('/api/fox/sgf',400)
 def test_paths_cannot_read_outside_the_build(self):
  self.assert_http_error('/%2e%2e/secret',403)
 def test_unknown_api_or_missing_assets_do_not_return_index_html(self):
  self.assert_http_error('/api/unknown',404);self.assert_http_error('/missing.js',404)
 def test_sgf_api_and_download_preserve_identical_source_bytes(self):
  original='(;SZ[19]KM[375]PB[fixture];B[pd])'
  self.client.fetch_sgf=lambda chessid:{'chessid':chessid,'sgf':original}
  with self.get('/api/fox/sgf?id=123') as r:self.assertEqual(json.load(r)['sgf'],original)
  with self.get('/api/fox/download/123.sgf') as r:
   self.assertIn('attachment',r.headers['Content-Disposition']);self.assertEqual(r.read(),original.encode())
 def test_upstream_failure_is_a_visible_gateway_error(self):
  from fox import FoxError
  def fail(*args):raise FoxError('upstream unavailable')
  self.client.fetch_sgf=fail
  self.assert_http_error('/api/fox/sgf?id=123',502)

if __name__=='__main__':unittest.main()
