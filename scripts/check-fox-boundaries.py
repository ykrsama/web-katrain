"""Boundary-only fixtures; no claim that these SGFs are live downloaded games."""
from pathlib import Path
import json,os
from playwright.sync_api import sync_playwright,TimeoutError
URL=os.environ.get('FOX_TEST_URL','http://127.0.0.1:18767')
OUT=Path(__file__).resolve().parent.parent/'.external/fox-evidence'
OUT.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 results={}
 def start():
  c=browser.new_context(viewport={'width':1365,'height':900},locale='en-US',service_workers='block');page=c.new_page()
  try:page.goto(URL,wait_until='domcontentloaded',timeout=90000)
  except TimeoutError:pass
  page.get_by_role('button',name='More file actions',exact=True).wait_for(timeout=60000)
  return c,page
 def open_dialog(page):
  page.get_by_role('button',name='More file actions',exact=True).click()
  page.get_by_role('button',name='Import from Fox',exact=True).click()
 def fixture(page,sgf):
  page.route('**/api/fox/search?*',lambda r:r.fulfill(json={'user':{'uid':'123','nickname':'Fixture'},'uid':'123','count':1,'games':[{'chessid':'123','black':'Fixture B','white':'Fixture W','date':'fixture','moves':2}],'next_cursor':None,'can_request_next':False}))
  page.route('**/api/fox/sgf?*',lambda r:r.fulfill(json={'chessid':'123','sgf':sgf,'bytes':len(sgf),'info':{'black':'Fixture B','white':'Fixture W','komi':'7.5'}}))
  open_dialog(page);page.get_by_label('Fox nickname or UID').fill('Fixture');page.get_by_role('button',name='Find records',exact=True).click()
  page.get_by_role('button',name='Preview / import').click();page.locator('.fox-import-confirm input').wait_for()
 try:
  c,page=start();fixture(page,'(;SZ[19]KM[7.5];B[pd];W[dp])')
  page.locator('.fox-import-confirm input').check();page.keyboard.press('Escape');open_dialog(page)
  assert page.locator('.fox-import-confirm input:checked').count()==0,'Replacement permission survives dialog dismissal'
  results['replacement_consent_resets_on_reopen']=True;c.close()
  for sgf in ['(;SZ[19]KM[7.5];B[pd][dp];W[qq])','(;SZ[19]KM[7.5]B[pd]W[dp])','(;SZ[19]KM[7.5];B[pd](;W[qq])(;B[aa]W[bb]))']:
   c,page=start();fixture(page,sgf);page.locator('.fox-import-confirm input').check();page.get_by_role('button',name='Import onto board',exact=True).click()
   assert page.locator('.fox-import-error').count()==1,'A multi-move node was silently accepted: '+sgf
   assert 'multiple moves' in page.locator('.fox-import-error').inner_text();c.close()
  results['all_tree_multi_move_nodes_rejected']=True
  c,page=start();page.route('**/api/fox/search?*',lambda route:route.abort())
  open_dialog(page);page.get_by_label('Fox nickname or UID').fill('Cancelled');page.get_by_role('button',name='Find records',exact=True).click();page.keyboard.press('Escape');open_dialog(page)
  page.wait_for_timeout(300)
  assert page.locator('.fox-import-error').count()==0,'Cancelled session leaked an error into reopened modal'
  assert page.get_by_role('button',name='Find records',exact=True).is_enabled();c.close()
  results['dismissed_request_cannot_write_new_session']=True
  # No gateway on static deployments: the import action must not be exposed.
  c=browser.new_context(viewport={'width':1365,'height':900},locale='en-US',service_workers='block');page=c.new_page()
  page.route('**/api/fox/status',lambda route:route.fulfill(status=404,json={'error':'fixture no backend'}))
  page.goto(URL,wait_until='commit',timeout=60000);page.get_by_role('button',name='More file actions',exact=True).wait_for(timeout=60000);page.get_by_role('button',name='More file actions',exact=True).click()
  assert page.get_by_role('button',name='Import from Fox',exact=True).count()==0,'Static deployment exposes a broken Fox action'
  results['missing_backend_hides_entry']=True;c.close()
  (OUT/'pr-boundary-verification.json').write_text(json.dumps(results,indent=2));print(json.dumps(results,indent=2))
 finally:browser.close()
