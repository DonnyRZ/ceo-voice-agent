"""Verify actual app responses; an empty HTTP 200 is a failure."""
from html.parser import HTMLParser
import json
import sys
from urllib.parse import urljoin, urlsplit
from urllib.request import Request, urlopen


class AppDocument(HTMLParser):
    def __init__(self):
        super().__init__()
        self.root = False
        self.assets = {}

    def handle_starttag(self, tag, attributes):
        attributes = dict(attributes)
        self.root |= tag == 'div' and attributes.get('id') == 'root'
        if tag == 'script' and attributes.get('type') == 'module':
            self.assets.setdefault('js', attributes.get('src', ''))
        if tag == 'link' and attributes.get('rel') == 'stylesheet':
            self.assets.setdefault('css', attributes.get('href', ''))


def check_site(origin, fetch=urlopen):
    origin = origin.rstrip('/')
    parsed = urlsplit(origin)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password \
            or parsed.path or parsed.query or parsed.fragment:
        raise ValueError('HTTPS origin')
    with fetch(origin + '/api/health', timeout=10) as response:
        if response.status != 200 or json.loads(response.read(65536)).get('status') != 'ok':
            raise ValueError('database health')
    with fetch(origin + '/', timeout=10) as response:
        document = response.read(1048576).decode('utf-8')
        if response.status != 200 or not document.lstrip().lower().startswith('<!doctype html>'):
            raise ValueError('application HTML')
    app = AppDocument()
    app.feed(document)
    if not app.root or set(app.assets) != {'js', 'css'}:
        raise ValueError('application root/assets')
    for kind, path in app.assets.items():
        target = urljoin(origin + '/', path)
        if urlsplit(target).netloc != parsed.netloc or not urlsplit(target).path.startswith('/assets/'):
            raise ValueError('asset origin')
        with fetch(Request(target, headers={'Range': 'bytes=0-1023'}), timeout=10) as response:
            allowed = ('text/javascript', 'application/javascript') if kind == 'js' else ('text/css',)
            if response.status not in (200, 206) or response.headers.get_content_type() not in allowed \
                    or not response.read(1024):
                raise ValueError('asset response')


if __name__ == '__main__':
    try:
        check_site(sys.argv[1])
        print('Public smoke lulus: database, HTML, JavaScript, dan CSS.')
    except Exception:
        print('Public smoke gagal: respons aplikasi/aset tidak sesuai; HTTP 200 saja tidak cukup.', file=sys.stderr)
        sys.exit(1)
