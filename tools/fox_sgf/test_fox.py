"""Offline fixtures only: these tests never claim to be live Fox data."""
import unittest
from urllib.parse import parse_qs, urlparse
from fox import FoxClient, FoxError, SGF_ENDPOINTS


class FoxRegressionTests(unittest.TestCase):
    def test_explicit_uid_does_not_query_nickname_endpoint(self):
        def unexpected(*args, **kwargs):
            self.fail('A UID lookup must not perform a nickname request')
        result = FoxClient(request_json=unexpected).resolve('00123456', 'uid')
        self.assertEqual(result['uid'], '00123456')

    def test_malformed_uid_is_not_silently_repaired(self):
        for uid in ['12x3', '１２３', '-1', 'https://example.org']:
            with self.subTest(uid=uid), self.assertRaises(FoxError):
                FoxClient().resolve(uid, 'uid')

    def test_next_page_uses_chessid_not_an_incremented_page_number(self):
        requests = []
        def fake(url, **kwargs):
            requests.append(url)
            return {'result': 0, 'chesslist': [
                {'chessid': '9876', 'blacknick': 'Fixture B', 'whitenick': 'Fixture W', 'movenum': 2},
                {'chessid': '8765', 'blacknick': 'Fixture B', 'whitenick': 'Fixture W', 'movenum': 3},
            ]}
        page = FoxClient(request_json=fake).games('123', '9999')
        self.assertEqual(page['count'], len(page['games']))
        self.assertEqual(page['next_cursor'], '8765')
        self.assertEqual(parse_qs(urlparse(requests[0]).query)['lastcode'], ['9999'])

    def test_empty_page_stops_next_request(self):
        page = FoxClient(request_json=lambda *a, **k: {'result': 0, 'chesslist': []}).games('123')
        self.assertEqual(page['count'], 0)
        self.assertIsNone(page['next_cursor'])
        self.assertFalse(page['can_request_next'])

    def test_business_failure_does_not_turn_into_an_empty_success(self):
        with self.assertRaises(FoxError):
            FoxClient(request_json=lambda *a, **k: {'result': 8, 'resultstr': 'fixture failure'}).games('123')

    def test_sgf_fallback_preserves_original_handicap_and_komi(self):
        # Intentionally synthetic unit-test fixture, not a claimed downloaded game.
        original = '(;GM[1]SZ[19]KM[375]HA[0]PB[Fixture B]PW[Fixture W];B[pd];B[dp];W[qq])'
        requests = []
        def fake(url, **kwargs):
            requests.append((url, kwargs))
            if len(requests) == 1:
                raise FoxError('fixture primary offline')
            if len(requests) == 2:
                return {'result': 1, 'resultstr': 'fixture secondary unavailable'}
            return {'result': 0, 'chess': original}
        data = FoxClient(request_json=fake).fetch_sgf('123456')
        self.assertEqual(data['sgf'], original)
        self.assertEqual(data['bytes'], len(original.encode('utf-8')))
        self.assertEqual(len(data['attempts']), 2)
        self.assertEqual(requests[0][0], SGF_ENDPOINTS[0])
        self.assertEqual(requests[0][1]['data'], b'chessid=123456')
        self.assertIsNone(requests[-1][1]['data'])
        self.assertTrue(any('KM[375]' in w for w in data['info']['warnings']))

    def test_all_download_failures_are_reported_without_fabricated_sgf(self):
        with self.assertRaisesRegex(FoxError, '三个下载地址均失败'):
            FoxClient(request_json=lambda *a, **k: {'result': 0, 'chess': ''}).fetch_sgf('123')

    def test_html_is_not_accepted_as_sgf(self):
        with self.assertRaises(FoxError):
            FoxClient(request_json=lambda *a, **k: {'result': 0, 'chess': '<html>blocked</html>'}).fetch_sgf('123')


if __name__ == '__main__':
    unittest.main()
