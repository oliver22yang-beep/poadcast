const $ = selector => document.querySelector(selector);
const audio = $('#audio');
let current = null;
let page = readPage();
function readPage(){try{return JSON.parse(localStorage.getItem('page')) || 'listen'}catch{return 'listen'}}
let utterance = null;
let activeSpeech = null;
const read = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};
const save = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
};
let progress = read('progress', {});
let favorites = read('favorites-v3', {});
let added = read('added-v3', {});
let selected = new Set();
let lastSearch = '';
function stableId(item){return item.id || (item.script ? 'script:'+item.title : item.audio || item.url || item.title);}
function allItems(){return ['followed','marketing'].flatMap(k=>(data[k]?.shows||[]).flatMap(show=>(show.episodes||[]).map(item=>({...item,show:show.title}))));}
function setPage(next){page=next;save('page',page);renderPages();}
function renderPages(){
  if(!['discover','listen','library'].includes(page))page='listen';
  for(const name of ['discover','listen','library']) $('#'+name+'-page').hidden=page!==name;
  document.querySelectorAll('[data-page]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.page===page)));
  if(page==='library')renderLibrary();
  if(page==='discover'&&lastSearch)renderSearch(lastSearch);
  const last=read('last',null);$('#resume-box').hidden=!last;
  if(last)$('#resume-episode').textContent='继续收听 · '+last.title;
}
function renderSearch(q){
  lastSearch=q;
  const host=$('#discover-results');host.replaceChildren();
  const terms=q.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const unique=new Map();
  for(const item of allItems())if(terms.every(t=>[item.title,item.summary,item.script,item.show].filter(Boolean).join(' ').toLowerCase().includes(t)))unique.set(stableId(item),item);
  for(const [id,item] of [...unique].slice(0,10)){
    const row=el('article');row.className='result-row';const body=el('div');body.append(el('strong',item.title),el('p',item.show+' · '+(item.kind==='audio'?'音频':'文稿或导语')));row.append(body);
    const b=el('button',added[id]?'已添加':'＋ 添加');b.className='utility';b.disabled=!!added[id];b.onclick=()=>{added[id]=item;save('added-v3',added);renderSearch(q);render();};row.append(b);host.append(row);
  }
  if(!unique.size)host.append(el('p','当前节目库没有匹配项。外部 Agent 搜索尚未接入。'));
}
function renderLibrary(){
  const host=$('#library-list');host.replaceChildren();
  for(const [id,item] of Object.entries(favorites)){
    const wrap=el('div');wrap.className='library-row';const check=el('input');check.type='checkbox';check.checked=selected.has(id);check.setAttribute('aria-label','选择 '+item.title);check.onchange=()=>{check.checked?selected.add(id):selected.delete(id);};wrap.append(check,card({title:item.show||'收藏'},item,0));host.append(wrap);
  }
  if(!Object.keys(favorites).length)host.append(el('p','点击节目旁的爱心即可收藏。'));
}
document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>setPage(b.dataset.page));
$('#discover-form').onsubmit=e=>{e.preventDefault();renderSearch($('#discover-query').value.trim());};
$('#resume-episode').onclick=()=>{const item=read('last',null);if(item)play(item);};
$('#export-synthesis').onclick=()=>{
  const items=[...selected].map(id=>favorites[id]).filter(Boolean);
  if(items.length<2){alert('至少选择两份资料');return;}
  const prompt='请整合以下资料，比较共同观点、差异与证据，并提炼方法论。没有全文的资料请注明证据不足，不要编造。\n\n'+items.map(x=>JSON.stringify({title:x.title,source:x.show,url:x.url||x.audio,summary:x.summary,script:x.script,sources:x.sources},null,2)).join('\n\n');
  saveBlob(new Blob([prompt],{type:'text/plain;charset=utf-8'}),'shengjian-synthesis.txt');
  note('已导出整合请求；可交给 GPT 或 Grok。尚未连接后台。');
};
let custom = read('feeds', []);
let category = read('category', 'followed');
let showKey = read('showKey', {});
let data = { followed: { shows: [] }, marketing: { shows: [] }, unavailable: [], errors: [] };

function safe(url) {
  try { return new URL(url).protocol === 'https:'; } catch { return false; }
}
function el(tag, text) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  return node;
}
function note(text) { $('#status').textContent = text; }
function localStamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || '';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(date);
}
function rate() { return Number($('#speed').value) || 1; }
function fileExt(url) {
  try {
    const match = new URL(url).pathname.toLowerCase().match(/\.(m4a|mp3|aac|mp4|wav|ogg|m4b)$/);
    return match ? match[0] : '.m4a';
  } catch { return '.m4a'; }
}
function safeName(title, ext) {
  const name = (title || '声间').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  return (name || '声间') + ext;
}
function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function fallbackDownload(url, filename) {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  document.body.append(link);
  link.click();
  link.remove();
}
function setPlayer(mode) { document.body.dataset.player = mode;syncMini(); }
function syncMini(){const b=$('#mini-toggle');if(!b)return;const speech=document.body.dataset.player==='speech';const playing=speech?!!window.speechSynthesis&&!window.speechSynthesis.paused:!audio.paused;b.textContent=playing?'Ⅱ':'▶';b.setAttribute('aria-label',playing?'暂停':'播放');}
$('#mini-toggle').onclick=()=>{if(document.body.dataset.player==='speech'){if(window.speechSynthesis.paused)window.speechSynthesis.resume();else window.speechSynthesis.pause();}else if(audio.paused)audio.play().catch(()=>note('播放失败'));else audio.pause();syncMini();};
$('#mini-expand').onclick=()=>{const mini=document.querySelector('footer').classList.toggle('mini');$('#mini-expand').textContent=mini?'展开播放器':'收起';$('#mini-expand').setAttribute('aria-expanded',String(!mini));};
audio.addEventListener('play',syncMini);audio.addEventListener('pause',syncMini);
function stopSpeech() {
  activeSpeech = null;
  utterance = null;
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (document.body.dataset.player === 'speech') {
    setPlayer('idle');
    $('#mode').textContent = '';
  }
  markPlaying(null);
}
function chineseVoice() {
  const voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
  return voices.find(voice => /zh([-_]CN)?/i.test(voice.lang)) || null;
}
function speechLine(item) {
  if (item.script) return item.script;
  const lead = (item.summary || '').trim().slice(0, 80);
  const line = lead ? item.title + '。' + lead : item.title;
  return (line + '。全文请打开原文。').replace(/。。+/g, '。').slice(0, 180);
}

function playAudio(item) {
  stopSpeech();
  current = item;
  audio.src = item.audio;
  $('#now').textContent = item.title;
  $('#mode').textContent = item.show ? item.show + ' · 音频' : '音频';
  setPlayer('audio');
  save('last', item);
  markPlaying(item);
  audio.onloadedmetadata = () => {
    audio.currentTime = Math.min(progress[item.audio] || 0, Math.max(0, (audio.duration || Infinity) - 1));
  };
  audio.play().catch(() => note('播放失败：请检查是否允许音频，或稍后再试。'));
}
function playSpeech(item) {
  if (!window.speechSynthesis) {
    note('这台浏览器不能朗读。iPhone 请用 Safari，它会用系统中文语音读短导语。');
    return;
  }
  audio.pause();
  activeSpeech = null;
  window.speechSynthesis.cancel();
  current = item;
  const line = speechLine(item);
  const chunks = line.match(/[^。！？\n]{1,100}[。！？\n]?|[。！？\n]/gu) || [line];
  let pos = 0;
  const run = {};
  activeSpeech = run;
  function next() {
    if (activeSpeech !== run) return;
    if (pos >= chunks.length) { setPlayer('idle'); $('#mode').textContent = '朗读结束'; markPlaying(null); return; }
    utterance = new SpeechSynthesisUtterance(chunks[pos++]);
  utterance.lang = 'zh-CN';
  utterance.rate = rate();
  const voice = chineseVoice();
  if (voice) utterance.voice = voice;
  utterance.onend = next;
  utterance.onerror = () => { if (activeSpeech === run) { activeSpeech = null; setPlayer('idle'); markPlaying(null); note('朗读中断，请使用 Safari 重试。'); } };
  window.speechSynthesis.speak(utterance);
  }
  $('#now').textContent = item.title;
  $('#mode').textContent = item.script ? '正在朗读完整原创文稿' : '正在用系统语音朗读短导语';
  setPlayer('speech');
  save('last', item);
  markPlaying(item);
  next();
  syncMini();
  setTimeout(() => { if (window.speechSynthesis.paused) window.speechSynthesis.resume(); }, 200);
  note(item.script ? '原创节目：系统语音朗读完整文稿。' : '仅朗读公开来源导语；全文请打开原文。');
}
function play(item) {
  if (item.kind === 'speech') playSpeech(item);
  else playAudio(item);
}
function markPlaying(item) {
  document.querySelectorAll('.card').forEach(card => card.classList.remove('is-playing'));
  if (!item) return;
  const card = document.querySelector('[data-key="' + CSS.escape(item.key || '') + '"]');
  if (card) card.classList.add('is-playing');
}

audio.ontimeupdate = () => {
  if (current && current.audio) {
    progress[current.audio] = audio.currentTime;
    save('progress', progress);
  }
};
audio.onended = () => { setPlayer('idle'); markPlaying(null); };
audio.onerror = () => { if (document.body.dataset.player === 'audio') note('音频暂时无法加载，请稍后重试。'); };
$('#back').onclick = () => { audio.currentTime = Math.max(0, audio.currentTime - 15); };
$('#forward').onclick = () => { audio.currentTime = Math.min(audio.duration || Infinity, audio.currentTime + 30); };
$('#speed').onchange = () => {
  audio.playbackRate = rate();
  if (utterance && window.speechSynthesis && document.body.dataset.player === 'speech' && current && current.kind === 'speech') {
    playSpeech(current);
  }
};
$('#stop-speech').onclick = () => stopSpeech();
if (window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
  window.speechSynthesis.getVoices();
}

async function downloadAudio(item, button) {
  const filename = safeName(item.title, fileExt(item.audio));
  button.disabled = true;
  note('正在下载「' + item.title + '」…');
  try {
    const response = await fetch(item.audio, { signal: AbortSignal.timeout(180000) });
    if (!response.ok) throw new Error('http');
    const blob = await response.blob();
    if (!blob.size) throw new Error('empty');
    saveBlob(blob, filename);
    note('已下载到本机：' + filename);
  } catch {
    fallbackDownload(item.audio, filename);
    note('浏览器未能直接保存该音频，已尝试打开原文件。部分站点会拒绝桌面浏览器下载。');
  } finally {
    button.disabled = false;
  }
}
function downloadSpeech(item) {
  const lines = [
    item.title,
    '',
    item.script || item.summary || '（没有导语）',
    '',
    '原文：' + item.url,
    '来源：' + (item.source || item.show || '营销案例'),
    item.date ? '日期：' + item.date : '',
    '',
    item.script ? 'AI 原创节目文稿' : '声间只保存标题、一句短导语和原文链接，未保存全文。'
  ];
  saveBlob(new Blob(['\ufeff' + lines.join('\n')], { type: 'text/plain;charset=utf-8' }), safeName(item.title, '.txt'));
  note(item.script ? '已下载完整原创文稿。' : '已下载短导语。全文请打开原文链接。');
}

function itemKey(show, item, index) {
  return (show.url || show.title || '') + '|' + (item.audio || item.url || item.title) + '|' + index;
}
function card(show, item, index) {
  const key = itemKey(show, item, index);
  const row = document.createElement('article');
  row.className = 'card';
  row.dataset.key = key;
  const main = document.createElement('div');
  main.className = 'card-main';
  const text = document.createElement('div');
  text.className = 'text';
  text.append(el('h3', item.title));
  if (item.summary) {
    const summary = el('p', item.summary);
    summary.className = 'summary';
    text.append(summary);
  }
  const meta = document.createElement('p');
  meta.className = 'meta';
  const bits = [show.title, item.ai ? 'AI 合成语音' : item.script ? '原创文稿' : item.kind === 'speech' ? '朗读' : '音频', item.date].filter(Boolean);
  meta.append(document.createTextNode(bits.join(' · ')));
  if (item.kind === 'speech' && safe(item.url)) {
    meta.append(document.createTextNode(' · '));
    const link = el('a', '原文');
    link.className = 'source-link';
    link.href = item.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    meta.append(link);
  }
  text.append(meta);
  main.append(text);
  const actions = document.createElement('div');
  actions.className = 'actions';
  const playButton = el('button', '▶');
  playButton.title = '播放';
  playButton.type = 'button';
  playButton.className = 'play';
  const payload = { ...item, show: show.title, key };
  playButton.setAttribute('aria-label', (item.kind === 'speech' ? (item.script ? '朗读原创节目 ' : '朗读短导语 ') : '播放 ') + item.title);
  playButton.onclick = () => play(payload);
  const download = el('button', '↓');
  download.title = '下载';
  download.type = 'button';
  download.className = 'download';
  download.setAttribute('aria-label', '下载 ' + item.title);
  download.onclick = () => (item.kind === 'speech' ? downloadSpeech(payload) : downloadAudio(payload, download));
  const id=stableId(payload);const heart=el('button',favorites[id]?'♥':'♡');heart.className='favorite';heart.type='button';heart.setAttribute('aria-label','收藏 '+item.title);heart.setAttribute('aria-pressed',String(!!favorites[id]));heart.onclick=()=>{if(favorites[id]){delete favorites[id];selected.delete(id);}else favorites[id]=payload;save('favorites-v3',favorites);render();};actions.append(playButton, download, heart);
  row.append(main, actions);
  return row;
}

function group(name) {
  if(name==='followed')return {shows:[...(data.followed?.shows||[]),...(data.marketing?.shows||[]).filter(s=>!s.url?.endsWith('#originals'))]};
  if(name==='marketing')return {shows:[...(data.marketing?.shows||[]).filter(s=>s.url?.endsWith('#originals')),...(Object.keys(added).length?[{title:'我的添加',url:'https://oliver22yang-beep.github.io/poadcast/#added',episodes:Object.values(added)}]:[])]};
  return data[name] || { shows: [] };
}
function selectedShow(name) {
  const shows = group(name).shows || [];
  const wanted = showKey[name];
  if (wanted === 'all' && name === 'marketing') return 'all';
  if (shows.some(show => show.url === wanted)) return wanted;
  return name === 'marketing' ? 'all' : (shows[0] && shows[0].url) || 'all';
}
function visibleItems(name) {
  const shows = group(name).shows || [];
  const picked = selectedShow(name);
  const chosen = picked === 'all' ? shows : shows.filter(show => show.url === picked);
  const items = [];
  chosen.forEach(show => (show.episodes || []).forEach((item, index) => {
    if (item.kind === 'speech' ? (Boolean(item.script) || safe(item.url)) : safe(item.audio)) items.push({ show, item, index });
  }));
  return items;
}
function renderChips(name, host) {
  host.replaceChildren();
  const shows = group(name).shows || [];
  const picked = selectedShow(name);
  const options = name === 'marketing' ? [{ title: '全部', url: 'all' }, ...shows] : shows;
  options.forEach(show => {
    const button = el('button', show.title);
    button.type = 'button';
    button.setAttribute('aria-pressed', String(show.url === picked));
    button.onclick = () => {
      showKey = { ...showKey, [name]: show.url };
      save('showKey', showKey);
      render();
    };
    host.append(button);
  });
}
function renderList(name, host) {
  host.replaceChildren();
  const items = visibleItems(name);
  if (!items.length) {
    host.append(el('p', '这一类还没有可听的内容。'));
    return;
  }
  items.forEach(({ show, item, index }) => host.append(card(show, item, index)));
}
function render() {
  const followedOn = category !== 'marketing';
  $('#tab-followed').setAttribute('aria-selected', String(followedOn));
  $('#tab-marketing').setAttribute('aria-selected', String(!followedOn));
  $('#panel-followed').hidden = !followedOn;
  $('#panel-marketing').hidden = followedOn;
  const missing = (data.unavailable || []).map(item => item.name + '：' + item.reason).join('');
  $('#followed-note').textContent = missing;
  renderChips('followed', $('#followed-chips'));
  renderChips('marketing', $('#marketing-chips'));
  renderList('followed', $('#followed-list'));
  renderList('marketing', $('#marketing-list'));
  const followedSub = (group('followed').shows || []).map(show => show.title.split('|')[0].trim()).slice(0, 2).join(' · ') || '半拿铁';
  $('#tab-followed .cat-sub').textContent = followedSub;
  const marketingShows = group('marketing').shows || [];
  const audioN = marketingShows.filter(show => show.kind === 'audio').length;
  const speechN = marketingShows.filter(show => show.kind === 'speech').length;
  $('#tab-marketing .cat-sub').textContent = audioN + ' 个音频 · ' + speechN + ' 个朗读';
  renderPages();
}
function selectCategory(next) {
  category = next;
  save('category', category);
  render();
}
$('#tab-followed').onclick = () => selectCategory('followed');
$('#tab-marketing').onclick = () => selectCategory('marketing');

async function loadRss(url) {
  if (!safe(url)) throw new Error('只支持 HTTPS 公开 RSS');
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error('来源返回错误');
  const xml = new DOMParser().parseFromString(await response.text(), 'text/xml');
  if (xml.querySelector('parsererror')) throw new Error('RSS 格式无效');
  const episodes = [...xml.querySelectorAll('item')].slice(0, 20).map(item => ({
    title: (item.querySelector('title')?.textContent || '未命名').trim(),
    audio: item.querySelector('enclosure')?.getAttribute('url'),
    date: (item.querySelector('pubDate')?.textContent || '').trim(),
    kind: 'audio'
  })).filter(item => safe(item.audio));
  if (!episodes.length) throw new Error('未发现可播放音频');
  return {
    title: xml.querySelector('channel > title')?.textContent?.trim() || '订阅',
    url,
    kind: 'audio',
    episodes
  };
}
function upsertShow(show) {
  const shows = data.followed.shows || [];
  const index = shows.findIndex(item => item.url === show.url);
  if (index >= 0) shows[index] = show;
  else shows.push(show);
  data.followed.shows = shows;
}
$('#subscribe').onsubmit = async event => {
  event.preventDefault();
  const url = $('#rss').value.trim();
  try {
    upsertShow(await loadRss(url));
    custom = [...new Set([...custom, url])];
    save('feeds', custom);
    showKey = { ...showKey, followed: url };
    save('showKey', showKey);
    selectCategory('followed');
    note('订阅已保存在这台设备');
  } catch (error) {
    note(error.message + '。可能受跨域限制，可以把地址写入 sources.json 后更新。');
  }
};

async function init() {
  try {
    data = await (await fetch('data/content.json', { cache: 'no-store' })).json();
    data.followed = data.followed || { shows: [] };
    data.marketing = data.marketing || { shows: [] };
    note('节目库更新于 ' + localStamp(data.updated) + (data.errors?.length ? ' · 部分来源沿用上次内容' : ''));
  } catch {
    note('暂无内容，请运行更新脚本。');
  }
  render();
  for (const url of custom) {
    if ((data.followed.shows || []).some(show => show.url === url)) continue;
    try { upsertShow(await loadRss(url)); } catch { /* keep the saved address for later */ }
  }
  if (custom.length) render();
  const first = (data.followed.shows || [])[0];
  if (first?.url) {
    try {
      upsertShow(await loadRss(first.url));
      render();
    } catch { /* snapshot remains */ }
  }
}
init();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
