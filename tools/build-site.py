#!/usr/bin/env python3
# Génère les pages HTML du site à partir de tools/site/*.html (fragments) + gabarit commun.
# Zéro dépendance : python3 seulement. Sortie dans site/.
import json, re, sys, pathlib, datetime
ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'tools' / 'site'
OUT = ROOT / 'site'
BASE = 'https://toufatech.github.io/Odin'
PAGES = json.loads((SRC / 'pages.json').read_text(encoding='utf-8'))
TPL = (SRC / '_layout.html').read_text(encoding='utf-8')
MASCOT = (SRC / 'parts' / 'mascot.svg').read_text(encoding='utf-8').strip()
NAV = [('index', 'Accueil'), ('fonctionnalites', 'Fonctionnalités'), ('autonomie', 'Autonomie'), ('securite', 'Sécurité'), ('installation', 'Installation'), ('guide', 'Guide'), ('faq', 'FAQ')]
today = datetime.date.today().isoformat()

def href(slug): return './' if slug == 'index' else f'./{slug}.html'

def nav(current):
    return '\n'.join(f'<li><a href="{href(s)}"{" aria-current=\"page\"" if s == current else ""}>{t}</a></li>' for s, t in NAV)

def crumbs(slug, title):
    if slug == 'index': return ''
    items = [{"@type": "ListItem", "position": 1, "name": "Accueil", "item": BASE + '/'}, {"@type": "ListItem", "position": 2, "name": title, "item": f'{BASE}/{slug}.html'}]
    return json.dumps({"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": items}, ensure_ascii=False)

for slug, meta in PAGES.items():
    body = (SRC / f'{slug}.html').read_text(encoding='utf-8')
    ld = meta.get('jsonld', [])
    ld_blocks = ''.join(f'<script type="application/ld+json">{json.dumps(x, ensure_ascii=False)}</script>' for x in ld)
    bc = crumbs(slug, meta['nav'])
    if bc: ld_blocks += f'<script type="application/ld+json">{bc}</script>'
    url = BASE + ('/' if slug == 'index' else f'/{slug}.html')
    html = TPL
    body = body.replace('{{MASCOT}}', MASCOT)
    for k, v in {
        'TITLE': meta['title'], 'DESC': meta['description'], 'URL': url, 'SLUG': slug, 'NAV': nav(slug), 'BODY': body, 'JSONLD': ld_blocks,
        'ROBOTS': 'noindex, follow' if meta.get('noindex') else 'index, follow', 'YEAR': str(datetime.date.today().year), 'BASE': BASE, 'MASCOT': MASCOT,
    }.items(): html = html.replace('{{' + k + '}}', v)
    (OUT / f'{slug}.html').write_text(html, encoding='utf-8')

# sitemap + robots
urls = [(BASE + ('/' if s == 'index' else f'/{s}.html'), m.get('priority', '0.6')) for s, m in PAGES.items() if not m.get('noindex')]
(OUT / 'sitemap.xml').write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + ''.join(f'  <url><loc>{u}</loc><lastmod>{today}</lastmod><priority>{p}</priority></url>\n' for u, p in urls) + '</urlset>\n', encoding='utf-8')
(OUT / 'robots.txt').write_text(f'User-agent: *\nAllow: /\nSitemap: {BASE}/sitemap.xml\n', encoding='utf-8')
print('pages :', ', '.join(PAGES))
