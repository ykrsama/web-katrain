"""Boundary-only fixtures; no claim that these SGFs are live downloaded games."""
from pathlib import Path
import json,os
from playwright.sync_api import sync_playwright,TimeoutError
URL=os.environ.get('FOX_TEST_URL','http://127.0.0.1:5173')
OUT=Path(__file__).resolve().parent.parent/'.external/fox-evidence'
OUT.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 results={}
 def start():
  c=browser.new_context(viewport={'width':1365,'height':900},locale='en-US',service_workers='block');page=c.new_page()
  page.route('**/api/fox/status',lambda route:route.fulfill(json={'ok':True,'fox':'public-records-only'}))
  try:page.goto(URL,wait_until='domcontentloaded',timeout=90000)
  except TimeoutError:pass
  page.get_by_role('button',name='More file actions',exact=True).wait_for(timeout=60000)
  return c,page
 def open_dialog(page):
  page.get_by_role('button',name='More file actions',exact=True).click()
  page.get_by_role('button',name='Fox records',exact=True).click()
 def fixture(page,sgf):
  page.route('**/api/fox/player?*',lambda r:r.fulfill(json={'uid':'123','nickname':'Fixture','mode':'nickname','live':[]}))
  page.route('**/api/fox/games?*',lambda r:r.fulfill(json={'uid':'123','count':1,'games':[{'chessid':'123','black':'Fixture B','white':'Fixture W','date':'fixture','moves':2}],'next_cursor':None,'can_request_next':False}))
  page.route('**/api/fox/sgf?*',lambda r:r.fulfill(json={'chessid':'123','sgf':sgf,'bytes':len(sgf),'info':{'black':'Fixture B','white':'Fixture W','komi':'7.5'}}))
  open_dialog(page);page.get_by_label('Search Fox players').fill('Fixture');page.get_by_role('button',name='Find records',exact=True).click()
  page.get_by_role('button',name='Import',exact=True).click()
 try:
  c,page=start();fixture(page,'(;SZ[19]KM[7.5];B[pd];W[dp])')
  page.locator('.fox-import-settings').wait_for();page.keyboard.press('Escape');open_dialog(page)
  assert page.locator('.fox-import-settings').count()==0,'Selected record survives dialog dismissal'
  results['preview_resets_on_reopen']=True;c.close()
  for sgf in ['(;SZ[19]KM[7.5];B[pd][dp];W[qq])','(;SZ[19]KM[7.5]B[pd]W[dp])','(;SZ[19]KM[7.5];B[pd](;W[qq])(;B[aa]W[bb]))']:
   c,page=start();fixture(page,sgf);page.get_by_role('alert').wait_for()
   assert page.locator('.fox-import-error').count()==1,'A multi-move node was silently accepted: '+sgf
   assert 'multiple moves' in page.locator('.fox-import-error').inner_text();c.close()
  results['all_tree_multi_move_nodes_rejected']=True
  c,page=start();page.route('**/api/fox/player?*',lambda route:route.abort())
  open_dialog(page);page.get_by_label('Search Fox players').fill('Cancelled');page.get_by_role('button',name='Find records',exact=True).click();page.keyboard.press('Escape');open_dialog(page)
  page.wait_for_timeout(300)
  assert page.locator('.fox-import-error').count()==0,'Cancelled session leaked an error into reopened modal'
  assert page.get_by_role('button',name='Find records',exact=True).is_enabled();c.close()
  results['dismissed_request_cannot_write_new_session']=True
  # An unavailable API must report the search failure without exposing room/link inputs.
  c=browser.new_context(viewport={'width':1365,'height':900},locale='en-US',service_workers='block');page=c.new_page()
  page.route('**/api/fox/player?*',lambda route:route.fulfill(status=404,json={'error':'fixture no backend'}))
  page.goto(URL,wait_until='commit',timeout=60000);page.get_by_role('button',name='More file actions',exact=True).wait_for(timeout=60000);page.get_by_role('button',name='More file actions',exact=True).click()
  assert page.get_by_role('button',name='Fox records',exact=True).count()==1,'Static deployment must retain live observation'
  page.get_by_role('button',name='Fox records',exact=True).click()
  page.get_by_label('Search Fox players').fill('Fixture')
  page.get_by_role('button',name='Find records',exact=True).click()
  page.get_by_role('alert').wait_for()
  assert page.locator('.fox-live-match').count()==0,'Failed lookups must not claim a current game'
  results['missing_backend_reports_search_error']=True;c.close()
  (OUT/'pr-boundary-verification.json').write_text(json.dumps(results,indent=2));print(json.dumps(results,indent=2))
 finally:browser.close()
