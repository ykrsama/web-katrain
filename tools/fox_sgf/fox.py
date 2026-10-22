"""PROTOTYPE: public Fox records over HTTP. No credentials or native client.
SGF is returned unchanged; this is not a Fox-specific SGF normalizer.
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import ProxyHandler, Request, build_opener

H5 = 'https://h5.foxwq.com/yehuDiamond/chessbook_local'
USER_URL = 'https://newframe.foxwq.com/cgi/QueryUserInfoPanel'
SGF_ENDPOINTS = (
    'http://happyapp.huanle.qq.com/cgi-bin/CommonMobileCGI/TXWQFetchChess',
    'http://cgi.foxwq.com/cgi-bin/CommonMobileCGI/TXWQFetchChess',
)
MOBILE_UA = ('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) '
             'AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1')


class FoxError(Exception):
    """Expected validation, upstream response, or transport failure."""


def _identity(text: str, label: str) -> str:
    if not re.fullmatch(r'[0-9]{1,32}', text or ''):
        raise FoxError(f'{label} 必须是 1–32 位 ASCII 数字；纯数字昵称请选“昵称”。')
    return text


def inspect_sgf(sgf: str) -> dict:
    text = sgf.lstrip('\ufeff \t\r\n')
    if not text.startswith('(;') or not text.rstrip().endswith(')'):
        raise FoxError('上游返回的 chess 字段不是可辨识的 SGF，未生成下载文件。')
    # Header inspection only: not a complete SGF parser or position validator.
    root = text.split(';', 2)[1]
    def prop(name):
        match = re.search(r'(?<![A-Z])' + name + r'\[((?:\\.|[^\]\\])*)\]', root)
        return match.group(1) if match else ''
    warnings = ['原始 SGF：未删除变化、修正让子或换算贴目。']
    komi = prop('KM')
    try:
        if abs(float(komi)) >= 100:
            warnings.append(f'KM[{komi}] 可能使用野狐的特殊贴目编码；导入端需做兼容，原型不自动换算。')
    except ValueError:
        pass
    return {'black': prop('PB'), 'white': prop('PW'), 'size': prop('SZ'),
            'komi': komi, 'result': prop('RE'), 'date': prop('DT'), 'warnings': warnings}


class FoxClient:
    def __init__(self, request_json=None, proxy=None, timeout=15, allow_insecure_http=False):
        # Empty FOX_PROXY disables proxies; unset respects environment variables.
        proxy = os.environ.get('FOX_PROXY') if proxy is None else proxy
        self.proxy = proxy
        self.opener = build_opener(ProxyHandler({'http': proxy, 'https': proxy})
                                  if proxy else ProxyHandler({}) if proxy == '' else ProxyHandler())
        self.timeout = timeout
        self.allow_insecure_http = allow_insecure_http
        self._lock = threading.Lock()
        self._cache = {}
        self._last_request = 0.0
        self.request_json = request_json or self._request_json

    def _request_json(self, url, *, data=None, user_agent=MOBILE_UA):
        key = (url, data)
        with self._lock:
            now = time.monotonic()
            cached = self._cache.get(key)
            if cached and now - cached[0] < 120:
                return cached[1]
            delay = 0.4 - (now - self._last_request)
            if delay > 0:
                time.sleep(delay)
            headers = {'User-Agent': user_agent, 'Accept': 'application/json,text/plain,*/*'}
            if data is not None:
                headers['Content-Type'] = 'application/x-www-form-urlencoded'
            try:
                self._last_request = time.monotonic()
                with self.opener.open(Request(url, data=data, headers=headers), timeout=self.timeout) as response:
                    raw = response.read(4 * 1024 * 1024 + 1)
                if len(raw) > 4 * 1024 * 1024:
                    raise FoxError('上游响应超过 4 MiB 限制。')
                payload = json.loads(raw.decode('utf-8-sig'))
                if not isinstance(payload, dict):
                    raise FoxError('上游响应不是 JSON 对象。')
            except (HTTPError, URLError, TimeoutError, OSError, UnicodeError, json.JSONDecodeError) as error:
                raise FoxError(f'上游请求失败：{error}') from error
            if len(self._cache) >= 256:
                self._cache.clear()
            self._cache[key] = (time.monotonic(), payload)
            return payload

    @staticmethod
    def _success(payload):
        result = payload.get('result', payload.get('errcode', -1))
        if str(result) != '0':
            raise FoxError(str(payload.get('resultstr') or payload.get('errmsg') or f'野狐返回错误码 {result}'))
        return payload

    def resolve(self, query, mode='nickname'):
        if not isinstance(query, str) or not query.strip() or len(query) > 120:
            raise FoxError('请输入 1–120 个字符的昵称或 UID。')
        query = query.strip()
        if mode == 'uid':
            return {'uid': _identity(query, 'UID'), 'nickname': '', 'mode': mode}
        if mode != 'nickname':
            raise FoxError('查询模式只能是 nickname 或 uid。')
        payload = self._success(self.request_json(USER_URL + '?' + urlencode({'srcuid': '0', 'username': query})))
        uid = str(payload.get('uid') or '')
        if uid == '0' or not uid:
            raise FoxError('没有找到对应的野狐账号。')
        nickname = next((str(payload[k]) for k in ('username', 'name', 'englishname') if payload.get(k)), query)
        return {'uid': _identity(uid, 'UID'), 'nickname': nickname, 'mode': mode}

    def games(self, uid, cursor='0'):
        _identity(uid, 'UID')
        _identity(cursor, '分页游标')
        query = {'srcuid': '0', 'dstuid': uid, 'type': '1', 'lastcode': cursor, 'searchkey': '', 'uin': uid}
        payload = self._success(self.request_json(H5 + '/YHWQFetchChessList?' + urlencode(query)))
        raw = payload.get('chesslist')
        if not isinstance(raw, list):
            raise FoxError('响应缺少 chesslist 列表。')
        games = []
        for entry in raw:
            if not isinstance(entry, dict) or not entry.get('chessid'):
                continue
            games.append({
                'chessid': str(entry['chessid']),
                'black': next((str(entry[k]) for k in ('blacknick', 'blacknickname', 'blackname', 'blackenname') if entry.get(k)), '黑方'),
                'white': next((str(entry[k]) for k in ('whitenick', 'whitenickname', 'whitename', 'whiteenname') if entry.get(k)), '白方'),
                'date': str(entry.get('starttime') or ''), 'moves': entry.get('movenum', ''),
            })
        next_cursor = games[-1]['chessid'] if games else None
        return {'uid': uid, 'cursor': cursor, 'games': games, 'count': len(games),
                'next_cursor': next_cursor, 'can_request_next': bool(next_cursor and next_cursor != cursor),
                'source': 'fox-public-api'}

    def fetch_sgf(self, chessid):
        _identity(chessid, '棋谱 ID')
        body = urlencode({'chessid': chessid}).encode('utf-8')
        attempts = []
        endpoints = [(H5 + '/YHWQFetchChess?' + urlencode({'chessid': chessid}), None, MOBILE_UA)]
        if self.allow_insecure_http:
            endpoints.extend((url, body, 'okhttp/3.12.12') for url in SGF_ENDPOINTS)
        for endpoint, data, user_agent in endpoints:
            try:
                payload = self._success(self.request_json(endpoint, data=data, user_agent=user_agent))
                sgf = payload.get('chess')
                if not isinstance(sgf, str) or not sgf.strip():
                    raise FoxError('chess 字段为空。')
                info = inspect_sgf(sgf)
                return {'chessid': chessid, 'sgf': sgf, 'bytes': len(sgf.encode('utf-8')),
                        'endpoint': endpoint.split('?')[0], 'secure_transport': endpoint.startswith('https:'),
                        'info': info, 'attempts': attempts}
            except FoxError as error:
                attempts.append({'endpoint': endpoint.split('?')[0], 'error': str(error)})
        raise FoxError('所有已启用的下载地址均失败：' + '；'.join(a['error'] for a in attempts))
