const $ = selector => document.querySelector(selector);
const audio = $('#audio');
let current = null;
const read = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};
const save = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
};
let progress = read('progress', {});
let custom = read('feeds', []);

function safe(url) {
  try { return new URL(url).protocol === 'https:'; } catch { return false; }
}
function el(tag, text) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  return node;
}
function note(text) { $('#status').textContent = text; }
function isLatte(feed) {
  return (feed.url || '').includes('caffebreve') || (feed.title || '').includes('半拿铁');
}
function setHeading(heading, title, count) {
  heading.replaceChildren(document.createTextNode(title + ' '));
  const badge = el('span', count ? count + ' 条' : '');
  badge.className = 'count';
  heading.append(badge);
}
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

function play(episode) {
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  current = episode;
  audio.src = episode.audio;
  $('#now').textContent = episode.title;
  save('last', episode);
  audio.onloadedmetadata = () => {
    audio.currentTime = Math.min(progress[episode.audio] || 0, Math.max(0, (audio.duration || Infinity) - 1));
  };
  audio.play().catch(() => note('播放失败：请检查浏览器是否允许音频播放。'));
}
audio.ontimeupdate = () => {
  if (current) {
    progress[current.audio] = audio.currentTime;
    save('progress', progress);
  }
};
audio.onerror = () => note('音频暂时无法加载，请稍后重试。');
$('#back').onclick = () => { audio.currentTime = Math.max(0, audio.currentTime - 15); };
$('#forward').onclick = () => { audio.currentTime = Math.min(audio.duration || Infinity, audio.currentTime + 30); };
$('#speed').onchange = event => { audio.playbackRate = Number(event.target.value); };

async function downloadAudio(episode, button) {
  const filename = safeName(episode.title, fileExt(episode.audio));
  button.disabled = true;
  note('正在下载「' + episode.title + '」…');
  try {
    const response = await fetch(episode.audio, { signal: AbortSignal.timeout(180000) });
    if (!response.ok) throw new Error('http');
    const blob = await response.blob();
    if (!blob.size) throw new Error('empty');
    saveBlob(blob, filename);
    note('已下载到本机：' + filename);
  } catch {
    fallbackDownload(episode.audio, filename);
    note('浏览器未能直接保存该音频，已尝试打开原文件。部分音频站点会拒绝桌面浏览器下载。');
  } finally {
    button.disabled = false;
  }
}
function downloadCase(item) {
  const lines = [
    item.title,
    '',
    item.summary || '（来源未提供摘要）',
    '',
    '原文：' + item.url,
    '来源：' + (item.source || '商业与营销案例'),
    item.date ? '日期：' + item.date : '',
    '',
    '声间只保存标题、短摘要和原文链接，未转载全文。'
  ];
  saveBlob(new Blob(['\ufeff' + lines.join('\n')], { type: 'text/plain;charset=utf-8' }), safeName(item.title, '.txt'));
  note('已下载案例摘要到本机。全文请打开原文链接阅读。');
}

function episodeRow(episode) {
  const row = document.createElement('article');
  row.className = 'episode';
  const cover = el('div', '♫');
  cover.className = 'cover';
  const info = document.createElement('div');
  info.className = 'info';
  info.append(el('h3', episode.title), el('p', episode.date || '播客'));
  const actions = document.createElement('div');
  actions.className = 'actions';
  const playButton = el('button', '播放');
  playButton.type = 'button';
  playButton.onclick = () => play(episode);
  const download = el('button', '下载');
  download.type = 'button';
  download.className = 'download';
  download.setAttribute('aria-label', '下载 ' + episode.title);
  download.onclick = () => downloadAudio(episode, download);
  actions.append(playButton, download);
  row.append(cover, info, actions);
  return row;
}
function caseRow(item) {
  const row = document.createElement('article');
  row.className = 'episode';
  const cover = el('div', '案');
  cover.className = 'cover case';
  const info = document.createElement('div');
  info.className = 'info';
  const title = document.createElement('h3');
  const link = document.createElement('a');
  link.textContent = item.title;
  link.href = item.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  title.append(link);
  info.append(title);
  if (item.summary) {
    const summary = el('p', item.summary);
    summary.className = 'summary';
    info.append(summary);
  }
  info.append(el('p', [item.source, item.date].filter(Boolean).join(' · ') || '案例'));
  const actions = document.createElement('div');
  actions.className = 'actions';
  const download = el('button', '下载');
  download.type = 'button';
  download.className = 'download';
  download.setAttribute('aria-label', '下载 ' + item.title);
  download.onclick = () => downloadCase(item);
  actions.append(download);
  row.append(cover, info, actions);
  return row;
}
function fillRows(container, episodes) {
  container.replaceChildren();
  for (const episode of episodes) {
    if (!safe(episode.audio)) continue;
    container.append(episodeRow(episode));
  }
}
function renderLatte(feed) {
  const episodes = (feed.episodes || []).filter(episode => safe(episode.audio));
  setHeading($('#latte-heading'), feed.title || '半拿铁 | 商业沉浮录', episodes.length);
  fillRows($('#latte-rows'), episodes);
}
function renderExtra(feed) {
  const host = $('#extra-shows');
  let box = [...host.children].find(node => node.dataset.url === feed.url);
  if (!box) {
    box = document.createElement('section');
    box.className = 'category';
    box.dataset.url = feed.url;
    host.append(box);
  }
  const episodes = (feed.episodes || []).filter(episode => safe(episode.audio));
  box.replaceChildren();
  const heading = document.createElement('h2');
  setHeading(heading, feed.title || '订阅', episodes.length);
  const rows = document.createElement('div');
  fillRows(rows, episodes);
  box.append(heading, rows);
}
function renderCases(cases) {
  const items = (cases.items || []).filter(item => safe(item.url) && item.title);
  setHeading($('#case-heading'), cases.title || '商业与营销案例', items.length);
  const sources = [...new Set(items.map(item => item.source).filter(Boolean))];
  $('#case-dek').textContent = sources.length
    ? '来自' + sources.join('、') + '的公开 RSS。只保留标题、短摘要和原文链接，不转载全文。'
    : '每天整理公开的商业与营销案例，只保留标题、短摘要和原文链接。';
  const rows = $('#case-rows');
  rows.replaceChildren();
  if (!items.length) {
    rows.append(el('p', '暂时没有新的案例。每日更新会继续从公开来源整理。'));
    return;
  }
  for (const item of items) rows.append(caseRow(item));
}

async function loadRss(url) {
  if (!safe(url)) throw new Error('只支持 HTTPS 公开 RSS');
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error('来源返回错误');
  const xml = new DOMParser().parseFromString(await response.text(), 'text/xml');
  if (xml.querySelector('parsererror')) throw new Error('RSS 格式无效');
  const episodes = [...xml.querySelectorAll('item')].slice(0, 40).map(item => ({
    title: (item.querySelector('title')?.textContent || '未命名').trim(),
    audio: item.querySelector('enclosure')?.getAttribute('url'),
    date: item.querySelector('pubDate')?.textContent || ''
  })).filter(episode => safe(episode.audio));
  if (!episodes.length) throw new Error('未发现可播放音频');
  return {
    title: xml.querySelector('channel > title')?.textContent?.trim() || '订阅',
    url,
    episodes
  };
}
async function add(url) {
  const feed = await loadRss(url);
  if (isLatte(feed)) renderLatte(feed);
  else renderExtra(feed);
}

$('#subscribe').onsubmit = async event => {
  event.preventDefault();
  const url = $('#rss').value.trim();
  try {
    await add(url);
    custom = [...new Set([...custom, url])];
    save('feeds', custom);
    note('订阅已保存在本机');
  } catch (error) {
    note(error.message + '。可能受跨域限制，可将地址加入 sources.json 后运行更新。');
  }
};

async function init() {
  let data = { podcasts: [], cases: { items: [] }, errors: [], updated: '' };
  try {
    data = await (await fetch('data/content.json', { cache: 'no-store' })).json();
    note('快照更新于 ' + (data.updated || '') + (data.errors?.length ? ' · 部分来源失败，保留上次内容' : ''));
  } catch {
    note('暂无内容，请运行更新脚本。');
  }
  const podcasts = data.podcasts || [];
  const latte = podcasts.find(isLatte) || podcasts[0];
  if (latte) renderLatte(latte);
  for (const feed of podcasts) {
    if (feed !== latte) renderExtra(feed);
  }
  renderCases(data.cases || {});
  if (latte?.url) {
    const snapshotNote = $('#status').textContent;
    try {
      renderLatte(await loadRss(latte.url));
      if ($('#status').textContent === snapshotNote) note('RSS 已同步 · ' + new Date().toLocaleString('zh-CN'));
    } catch {
      if ($('#status').textContent === snapshotNote) note('正在显示上次保存的节目；实时 RSS 暂不可用。');
    }
  }
  for (const url of custom) {
    try { await add(url); } catch { /* keep the saved list; this device can retry later */ }
  }
  const last = read('last', null);
  if (last && safe(last.audio)) {
    const resume = el('button', '继续：' + last.title);
    resume.type = 'button';
    resume.className = 'resume';
    resume.onclick = () => play(last);
    $('#latte-rows').prepend(resume);
  }
}
init();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
