import html
import json
import os
import re
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'site/data/content.json'
if os.getenv('CONTENT_OUTPUT'):
    OUT = Path(os.environ['CONTENT_OUTPUT'])

CST = timezone(timedelta(hours=8))
TAG = re.compile(r'<[^>]+>')
WS = re.compile(r'\s+')
INVISIBLE = re.compile(r'[\u200b\u200c\u200d\ufeff]')


def fetch(url):
    if not url.startswith('https://'):
        raise ValueError('HTTPS required')
    req = urllib.request.Request(url, headers={'User-Agent': 'PersonalListeningReader/1.0'})
    with urllib.request.urlopen(req, timeout=25) as response:
        data = response.read(8_000_001)
    if len(data) > 8_000_000:
        raise ValueError('Feed too large')
    if data.startswith(b'\xef\xbb\xbf'):
        data = data[3:]
    return ET.fromstring(data)


def plain(raw):
    text = html.unescape(raw or '')
    text = TAG.sub(' ', text)
    text = html.unescape(text)
    text = INVISIBLE.sub('', text)
    return WS.sub(' ', text).strip()


def short_summary(raw, limit):
    """Keep a short lead only. Publisher descriptions are often the full article."""
    text = plain(raw)
    credit = r'(作者|编辑|文|图|图源)\s*[丨|｜/／:：]\s*\S+'
    for _ in range(4):
        cleaned = text.lstrip('，,。；;：:、 ')
        cleaned = re.sub(rf'^本文来自微信公众号[:：]\s*\S+\s*[，,]?\s*({credit}\s*)?', '', cleaned)
        cleaned = re.sub(rf'^{credit}\s*', '', cleaned)
        cleaned = re.sub(r'^本文约\s*\d+\s*字[，,。]?\s*(建议阅读\s*\d+\s*分钟\s*)?', '', cleaned)
        cleaned = re.sub(r'\s*查看全文\s*$', '', cleaned).strip()
        if cleaned == text:
            break
        text = cleaned
    if len(text) <= limit:
        return text
    cut = text[:limit]
    for sep in '。！？':
        index = cut.rfind(sep)
        if index >= 36:
            return cut[:index + 1]
    trimmed = cut.rstrip('，,、；;：: ')
    if len(trimmed) >= limit:
        trimmed = trimmed[:limit - 1]
    return trimmed + '…'


def parse_date(value):
    if not value:
        return None
    raw = value.strip()
    try:
        return parsedate_to_datetime(raw)
    except (TypeError, ValueError, IndexError, OverflowError):
        pass
    compact = WS.sub(' ', raw)
    for fmt in ('%Y-%m-%d %H:%M:%S %z', '%Y-%m-%d %H:%M:%S', '%Y-%m-%d'):
        try:
            return datetime.strptime(compact, fmt)
        except ValueError:
            continue
    return None


def display_date(when):
    if when is None:
        return ''
    if when.tzinfo is None:
        return when.strftime('%Y-%m-%d')
    return when.astimezone(CST).strftime('%Y-%m-%d')


def stamp(item):
    if item.get('_ts'):
        return item['_ts']
    when = parse_date(item.get('date') or '')
    return when.timestamp() if when else 0


def norm_url(url):
    return (url or '').split('?', 1)[0].rstrip('/')


def norm_title(title):
    return re.sub(r'[\s|｜丨:：,，.。!！?？、"“”\'‘’]+', '', title or '').lower()


def matches(title, summary, keywords, summary_keywords, excludes):
    if any(word and word in title for word in excludes):
        return False
    if any(word and word in title for word in keywords):
        return True
    head = summary[:100]
    return any(word and word in head for word in summary_keywords)


def rss_channel(url):
    root = fetch(url)
    channel = root.find('channel')
    if channel is None:
        raise ValueError('Not RSS 2.0')
    return channel


def https_link(item):
    link = (item.findtext('link') or '').strip()
    if link.startswith('https://'):
        return link
    guid = (item.findtext('guid') or '').strip()
    if guid.startswith('https://'):
        return guid
    return ''


def main():
    config = json.loads((ROOT / 'sources.json').read_text())
    old = json.loads(OUT.read_text()) if OUT.exists() else {'podcasts': [], 'cases': {'items': []}}
    case_config = config.get('cases') or {}
    result = {
        'updated': datetime.now(timezone.utc).isoformat(),
        'podcasts': [],
        'cases': {
            'title': case_config.get('title') or '商业与营销案例',
            'items': [],
        },
        'errors': [],
    }

    for source in config.get('podcasts') or []:
        url = source['url']
        try:
            channel = rss_channel(url)
            episodes = []
            for item in channel.findall('item')[:40]:
                enclosure = item.find('enclosure')
                audio = enclosure.get('url') if enclosure is not None else ''
                if audio.startswith('https://'):
                    episodes.append({
                        'title': plain(item.findtext('title') or '') or '未命名',
                        'audio': audio,
                        'date': item.findtext('pubDate') or '',
                    })
            if not episodes:
                raise ValueError('No audio')
            result['podcasts'].append({
                'url': url,
                'title': plain(channel.findtext('title') or '') or '播客',
                'episodes': episodes,
            })
        except Exception as error:
            result['errors'].append(url + ': ' + str(error))
            result['podcasts'] += [podcast for podcast in old.get('podcasts') or [] if podcast.get('url') == url]

    keywords = config.get('keywords') or []
    summary_keywords = config.get('summary_keywords') or keywords
    excludes = case_config.get('exclude') or []
    limit = int(case_config.get('limit') or 24)
    summary_chars = int(case_config.get('summary_chars') or 120)
    old_items = (old.get('cases') or {}).get('items') or []
    collected = []

    for source in case_config.get('sources') or []:
        if source.get('enabled') is False:
            continue
        url = source['url']
        name = source.get('name') or '公开来源'
        try:
            channel = rss_channel(url)
            for item in channel.findall('item'):
                link = https_link(item)
                if not link:
                    continue
                title = plain(item.findtext('title') or '') or '未命名'
                summary = short_summary(item.findtext('description') or '', summary_chars)
                if not matches(title, summary, keywords, summary_keywords, excludes):
                    continue
                when = parse_date(item.findtext('pubDate') or '')
                collected.append({
                    'title': title,
                    'url': link,
                    'summary': summary,
                    'source': name,
                    'date': display_date(when),
                    'feed': url,
                    '_ts': when.timestamp() if when else 0,
                })
        except Exception as error:
            result['errors'].append(name + ': ' + str(error))
            for item in old_items:
                if item.get('feed') == url:
                    kept = dict(item)
                    kept['_ts'] = stamp(kept)
                    collected.append(kept)

    collected.sort(key=stamp, reverse=True)
    seen_urls = set()
    seen_titles = set()
    items = []
    for item in collected:
        url_key = norm_url(item.get('url'))
        title_key = norm_title(item.get('title'))
        if not url_key or url_key in seen_urls or (title_key and title_key in seen_titles):
            continue
        seen_urls.add(url_key)
        if title_key:
            seen_titles.add(title_key)
        item.pop('_ts', None)
        item['summary'] = short_summary(item.get('summary') or '', summary_chars)
        if len(item['summary']) > summary_chars:
            item['summary'] = item['summary'][:summary_chars - 1] + '…'
        items.append(item)
        if len(items) >= limit:
            break

    result['cases']['items'] = items
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    longest = max((len(item.get('summary') or '') for item in items), default=0)
    print(
        'Episodes:', sum(len(podcast['episodes']) for podcast in result['podcasts']),
        'Cases:', len(items),
        'Longest summary:', longest,
        'Errors:', result['errors'],
    )


if __name__ == '__main__':
    main()
