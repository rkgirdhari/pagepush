"""Validate the static website and its local preview without third-party packages."""
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import urlopen
from urllib.error import HTTPError
import json
import re
import sys

ROOT = Path(__file__).parent / 'public'
VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}

class Inspect(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.ids = set()
        self.links = []
        self.h1 = 0
        self.main = 0
        self.desc = ''
        self.title = ''
        self.in_title = False
        self.errors = []
        self.accessible_table = False
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag not in VOID: self.stack.append(tag)
        if 'id' in attrs:
            if attrs['id'] in self.ids: self.errors.append('duplicate id: ' + attrs['id'])
            self.ids.add(attrs['id'])
        if tag == 'h1': self.h1 += 1
        if tag == 'main': self.main += 1
        if tag == 'title': self.in_title = True
        if tag == 'meta' and attrs.get('name') == 'description': self.desc = attrs.get('content', '')
        if tag == 'a' and 'href' in attrs: self.links.append(attrs['href'])
        if tag == 'img' and 'alt' not in attrs: self.errors.append('image missing alt')
        if tag == 'div' and attrs.get('class') == 'table-wrap' and attrs.get('role') == 'region' and attrs.get('tabindex') == '0' and attrs.get('aria-label'):
            self.accessible_table = True
        if tag in {'img', 'link', 'script'}:
            url = attrs.get('src') or attrs.get('href')
            if url and url.startswith('/') and not (ROOT / url.lstrip('/')).is_file(): self.errors.append('missing asset: ' + url)
    def handle_endtag(self, tag):
        if tag in VOID: return
        if not self.stack or self.stack[-1] != tag:
            self.errors.append(f'improper closing tag: {tag}, stack={self.stack[-3:]}')
        else: self.stack.pop()
        if tag == 'title': self.in_title = False
    def handle_data(self, data):
        if self.in_title: self.title += data

pages = {'/': ROOT / 'index.html', '/privacy/': ROOT / 'privacy' / 'index.html'}
parsed = {}
errors = []
for route, file in pages.items():
    text = file.read_text(encoding='utf-8')
    page = Inspect(); page.feed(text); page.close(); parsed[route] = page
    if page.stack: page.errors.append('unclosed tags: ' + str(page.stack))
    if not text.lower().lstrip().startswith('<!doctype html>'): page.errors.append('missing doctype')
    if page.h1 != 1 or page.main != 1: page.errors.append(f'expected one h1 and main; got {page.h1}, {page.main}')
    if not (30 <= len(page.title) <= 60): page.errors.append('unexpected title length: ' + str(len(page.title)))
    if not (50 <= len(page.desc) <= 160): page.errors.append('unexpected description length: ' + str(len(page.desc)))
    errors.extend(f'{route}: {item}' for item in page.errors)
if not parsed['/privacy/'].accessible_table: errors.append('/privacy/: scrollable table is not keyboard-accessible')
for route, page in parsed.items():
    for link in page.links:
        parts = urlsplit(link)
        if parts.scheme or parts.netloc: continue
        target = parts.path or route
        if target not in pages: errors.append(f'{route}: invalid internal route {link}')
        elif parts.fragment and parts.fragment not in parsed[target].ids: errors.append(f'{route}: missing anchor {link}')
manifest = json.loads((ROOT / 'manus-routes.json').read_text(encoding='utf-8'))
if {entry['path'] for entry in manifest['routes']} != set(pages): errors.append('route manifest does not match pages')
css = (ROOT / 'styles.css').read_text(encoding='utf-8')
if css.count('{') != css.count('}'): errors.append('unbalanced CSS braces')
if '@media(max-width:720px)' not in css or ':focus-visible' not in css: errors.append('responsive or focus styles missing')
for route, expected_type in [('/', 'text/html'), ('/privacy/', 'text/html'), ('/manus-routes.json', 'application/json'), ('/styles.css', 'text/css'), ('/assets/hero-art.jpg', 'image/jpeg')]:
    try:
        with urlopen('http://127.0.0.1:3000' + route, timeout=5) as response:
            body = response.read()
            if response.status != 200 or expected_type not in response.headers.get('Content-Type', ''): errors.append(f'{route}: incorrect response')
            if route == '/' and b'A clearer way to' not in body: errors.append('homepage missing initial content')
            if route == '/privacy/' and b'multi-panel erasure is not guaranteed' not in body: errors.append('policy missing deletion limitation')
            if route == '/manus-routes.json' and json.loads(body) != manifest: errors.append('served route manifest mismatch')
    except Exception as exc: errors.append(f'{route}: {exc}')
try:
    urlopen('http://127.0.0.1:3000/not-a-route', timeout=5)
    errors.append('unknown route did not return 404')
except HTTPError as exc:
    if exc.code != 404: errors.append(f'unknown route returned {exc.code}')
except Exception as exc: errors.append(f'unknown route: {exc}')
if errors:
    print('\n'.join(errors)); sys.exit(1)
print('PASS: both initial HTML pages, local links, metadata, route manifest, assets, accessibility basics, responsive/focus styles, HTTP responses, and 404')
