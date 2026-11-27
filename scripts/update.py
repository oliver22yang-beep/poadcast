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
FETCH_LIMIT = 12_000_000


def fetch_channel(url):
    if not url.startswith('https://'):
        raise ValueError('HTTPS required')
    request = urllib.request.Request(url, headers={'User-Agent': 'PersonalListeningReader/1.0'})
    with urllib.request.urlopen(request, timeout=25) as response:
        data = response.read(FETCH_LIMIT + 1)
    if data.startswith(b'\xef\xbb\xbf'):
        data = data[3:]
    if data.lstrip().startswith(b'<!') or data.lstrip()[:15].lower().startswith(b'<html'):
        raise ValueError('Feed returned a web page')
    if len(data) > FETCH_LIMIT:
        cut = data.rfind(b'</item>')
        if cut == -1:
            raise ValueError('Feed too large')
        data = data[:cut + len(b'</item>')] + b'</channel></rss>'
    root = ET.fromstring(data)
    channel = root.find('channel')
    if channel is None:
        raise ValueError('Not RSS 2.0')
    return channel


def plain(raw):
    text = html.unescape(raw or '')
    text = TAG.sub(' ', text)
    text = html.unescape(text)
    text = INVISIBLE.sub('', text)
    return WS.sub(' ', text).strip()


def short_summary(raw, limit):
    """One short lead only. Publisher descriptions are often the full article."""
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
        if index >= 24:
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


def display_date(when, fallback=''):
    if when is None:
        return WS.sub(' ', fallback).strip()[:32]
    if when.tzinfo is None:
        return when.strftime('%Y-%m-%d')
    return when.astimezone(CST).strftime('%Y-%m-%d')


def https_link(item):
    link = (item.findtext('link') or '').strip()
    if link.startswith('https://'):
        return link
    guid = (item.findtext('guid') or '').strip()
    if guid.startswith('https://'):
        return guid
    return ''


def iter_shows(document):
    for key in ('followed', 'marketing'):
        group = document.get(key) or {}
        for show in group.get('shows') or []:
            yield show
    for show in document.get('podcasts') or []:
        yield show


def previous_show(document, url):
    for show in iter_shows(document):
        if show.get('url') == url:
            return show
    return None


def audio_show(source, old):
    url = source['url']
    limit = int(source.get('limit') or 12)
    channel = fetch_channel(url)
    episodes = []
    for item in channel.findall('item'):
        enclosure = item.find('enclosure')
        audio = enclosure.get('url') if enclosure is not None else ''
        if not audio.startswith('https://'):
            continue
        when = parse_date(item.findtext('pubDate') or '')
        episodes.append({
            'title': plain(item.findtext('title') or '') or '未命名',
            'audio': audio,
            'date': display_date(when, item.findtext('pubDate') or ''),
            'kind': 'audio',
        })
        if len(episodes) >= limit:
            break
    if not episodes:
        raise ValueError('No audio')
    return {
        'title': source.get('name') or plain(channel.findtext('title') or '') or '播客',
        'url': url,
        'kind': 'audio',
        'episodes': episodes,
    }


def keep_speech(title, summary, link, keywords, excludes):
    blob = title + ' ' + link
    if any(word and word in blob for word in excludes):
        return False
    if '/newsflashes/' in link:
        return False
    if len(summary) < 20:
        return False
    return any(word and word in title for word in keywords)


def speech_show(source, old, keywords, excludes, summary_chars):
    url = source['url']
    limit = int(source.get('limit') or 8)
    channel = fetch_channel(url)
    episodes = []
    for item in channel.findall('item'):
        link = https_link(item)
        if not link:
            continue
        title = plain(item.findtext('title') or '') or '未命名'
        summary = short_summary(item.findtext('description') or '', summary_chars)
        if not keep_speech(title, summary, link, keywords, excludes):
            continue
        when = parse_date(item.findtext('pubDate') or '')
        episodes.append({
            'title': title,
            'summary': summary,
            'url': link,
            'date': display_date(when),
            'kind': 'speech',
            'source': source.get('name') or '公开来源',
        })
        if len(episodes) >= limit:
            break
    if not episodes:
        raise ValueError('No matching cases')
    return {
        'title': source.get('name') or plain(channel.findtext('title') or '') or '案例',
        'url': url,
        'kind': 'speech',
        'episodes': episodes,
    }


def take_shows(sources, loader, old, errors):
    shows = []
    for source in sources:
        if source.get('enabled') is False:
            continue
        try:
            shows.append(loader(source))
        except Exception as error:
            errors.append((source.get('name') or source.get('url')) + ': ' + str(error))
            previous = previous_show(old, source.get('url'))
            if previous:
                shows.append(previous)
    return shows


def main():
    config = json.loads((ROOT / 'sources.json').read_text())
    old = json.loads(OUT.read_text()) if OUT.exists() else {}
    errors = []
    keywords = config.get('keywords') or []
    excludes = config.get('exclude') or []
    summary_chars = int(config.get('summary_chars') or 80)
    followed = take_shows(
        config.get('followed') or config.get('podcasts') or [],
        lambda source: audio_show(source, old),
        old,
        errors,
    )
    marketing = take_shows(
        config.get('marketingAudio') or [],
        lambda source: audio_show(source, old),
        old,
        errors,
    )
    marketing += take_shows(
        config.get('marketingSpeech') or [],
        lambda source: speech_show(source, old, keywords, excludes, summary_chars),
        old,
        errors,
    )
    result = {
        'updated': datetime.now(timezone.utc).isoformat(),
        'followed': {
            'title': '在听',
            'subtitle': '已订阅的公开节目',
            'shows': followed,
        },
        'marketing': {
            'title': '营销案例',
            'subtitle': '公开音频，以及可朗读的短导语',
            'shows': marketing,
        },
        'unavailable': config.get('unavailable') or [],
        'errors': errors,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    audio_count = sum(len(show.get('episodes') or []) for show in followed + marketing if show.get('kind') == 'audio')
    speech_count = sum(len(show.get('episodes') or []) for show in marketing if show.get('kind') == 'speech')
    longest = 0
    for show in marketing:
        if show.get('kind') != 'speech':
            continue
        for episode in show.get('episodes') or []:
            longest = max(longest, len(episode.get('summary') or ''))
            if len(episode.get('summary') or '') > summary_chars:
                raise SystemExit('Summary longer than the allowed lead')
    print('Audio items:', audio_count, 'Speech items:', speech_count, 'Longest lead:', longest, 'Errors:', errors)


if __name__ == '__main__':
    main()
