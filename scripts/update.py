import json, urllib.request, xml.etree.ElementTree as ET
import os
from pathlib import Path
from datetime import datetime, timezone
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'site/data/content.json'
if os.getenv('CONTENT_OUTPUT'): OUT=Path(os.environ['CONTENT_OUTPUT'])
def fetch(url):
    if not url.startswith('https://'): raise ValueError('HTTPS required')
    with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'PersonalListeningReader/1.0'}),timeout=25) as r:
        data=r.read(8_000_001)
        if len(data)>8_000_000: raise ValueError('Feed too large')
        return ET.fromstring(data)
def main():
    config=json.loads((ROOT/'sources.json').read_text())
    old=json.loads(OUT.read_text()) if OUT.exists() else {'podcasts':[],'cards':[]}
    result={'updated':datetime.now(timezone.utc).isoformat(),'podcasts':[],'cards':[], 'errors':[]}
    for source in config['podcasts']:
        url=source['url']
        try:
            root=fetch(url); channel=root.find('channel'); episodes=[]
            for item in channel.findall('item')[:40]:
                enc=item.find('enclosure')
                if enc is not None and enc.get('url','').startswith('https://'):
                    episodes.append({'title':item.findtext('title','未命名'),'audio':enc.get('url'),'date':item.findtext('pubDate','')})
            if not episodes: raise ValueError('No audio')
            result['podcasts'].append({'url':url,'title':channel.findtext('title'),'episodes':episodes})
        except Exception as e:
            result['errors'].append(url+': '+str(e));result['podcasts'] += [p for p in old['podcasts'] if p['url']==url]
    for source in config['articles']:
        if not source.get('enabled'): continue
        try:
            root=fetch(source['url'])
            for i in root.findall('.//item')[:50]:
                title=i.findtext('title','');url=i.findtext('link','')
                if url.startswith('https://') and any(k.lower() in title.lower() for k in config['keywords']):
                    result['cards'].append({'title':title,'url':url,'source':source['name'],'date':i.findtext('pubDate','')})
        except Exception as e:
            result['errors'].append(source['name']+': '+str(e));result['cards'] += [c for c in old['cards'] if c['source']==source['name']]
    result['cards']=list({c['url']:c for c in result['cards']}.values())[:30]
    OUT.write_text(json.dumps(result,ensure_ascii=False,indent=2))
    print('Episodes:',sum(len(p['episodes']) for p in result['podcasts']),'Cards:',len(result['cards']),'Errors:',result['errors'])
if __name__=='__main__': main()
