import '@fontsource-variable/inter';
import '@braccato/core/element';
import '@braccato/core/styles/variables.css';
import '@braccato/core/styles/lyrics.css';
import '@braccato/core/styles/instrumental.css';
import { TTMLParser } from '@braccato/parsers';

const $ = id => document.getElementById(id);
let poller = null;
let currentTrackId = null;
let lyricRequestId = 0;
let lyricLines = [];
let lyricsAreSynced = false;
let renderedLyricNodes = [];
let braccatoLyrics = null;
let activeLyricIndex = -1;
let latestProgressMs = 0;
let latestDurationMs = 0;
let progressObservedAt = Date.now();
let isPlaying = false;
let ambientLayerIndex = 0;
let dynamicBackgroundEnabled = true;
let ambientImageUrl = '';
let ambientRequestId = 0;
let beatAnalysis = null;
let beatAnalysisTrackId = null;
let beatPulse = 0;
const fallbackMeshColors = [[255, 91, 164], [107, 78, 255], [30, 190, 220], [255, 166, 72], [110, 218, 143]];
function rgbString(rgb, alpha = 1){
  return 'rgba(' + rgb.map(value => Math.round(value)).join(',') + ',' + alpha + ')';
}
function makeMeshGradient(colors){
  const positions = [[18, 22], [78, 20], [52, 78], [8, 76], [91, 68]];
  return colors.map((color, index) =>
    'radial-gradient(ellipse at ' + positions[index][0] + '% ' + positions[index][1] + '%, ' +
    rgbString(color, 0.95) + ' 0%, ' + rgbString(color, 0.48) + ' 22%, transparent 62%)'
  ).join(',');
}
function extractArtworkColors(imageUrl, requestId){
  return new Promise(resolve => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      if(requestId !== ambientRequestId) return resolve(null);
      try {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if(!context) return resolve(null);
        const size = 48;
        canvas.width = size;
        canvas.height = size;
        context.drawImage(image, 0, 0, size, size);
        const pixels = context.getImageData(0, 0, size, size).data;
        const bins = new Map();
        for(let i = 0; i < pixels.length; i += 4 * 3){
          const alpha = pixels[i + 3] / 255;
          if(alpha < 0.6) continue;
          let r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
          const max = Math.max(r, g, b), min = Math.min(r, g, b);
          if(max < 28 || max - min < 12) continue;
          const key = [r, g, b].map(value => Math.round(value / 32)).join(',');
          const bin = bins.get(key) || { count: 0, r: 0, g: 0, b: 0 };
          bin.count++;
          bin.r += r; bin.g += g; bin.b += b;
          bins.set(key, bin);
        }
        const ranked = Array.from(bins.values()).sort((a, b) => b.count - a.count);
        const colors = [];
        for(const bin of ranked){
          const color = [bin.r / bin.count, bin.g / bin.count, bin.b / bin.count];
          if(colors.every(existing => Math.sqrt(existing.reduce((sum, value, index) => sum + (value - color[index]) ** 2, 0)) > 55)){
            colors.push(color);
          }
          if(colors.length === 5) break;
        }
        while(colors.length < 5){
          colors.push(fallbackMeshColors[colors.length]);
        }
        resolve(colors);
      } catch {
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = imageUrl;
  });
}
async function setAmbientBackground(imageUrl, force = false){
  if(!imageUrl || (!force && imageUrl === ambientImageUrl)) return;
  ambientImageUrl = imageUrl;
  const requestId = ++ambientRequestId;
  const colors = await extractArtworkColors(imageUrl, requestId);
  if(requestId !== ambientRequestId || !dynamicBackgroundEnabled) return;
  const layers = Array.from(document.querySelectorAll('.ambient-layer'));
  if(layers.length !== 2) return;
  const nextIndex = 1 - ambientLayerIndex;
  layers[nextIndex].style.backgroundImage = makeMeshGradient(colors || fallbackMeshColors);
  layers[nextIndex].classList.add('active');
  layers[ambientLayerIndex].classList.remove('active');
  ambientLayerIndex = nextIndex;
}
function loadBeatAnalysis(trackId){
  if(!trackId || !/^[A-Za-z0-9]{22}$/.test(trackId)){
    beatAnalysis = null;
    beatAnalysisTrackId = trackId;
    return;
  }
  if(beatAnalysisTrackId === trackId) return;
  beatAnalysisTrackId = trackId;
  beatAnalysis = null;
  api('/api/spotify/analysis?trackId=' + encodeURIComponent(trackId))
    .then(data => {
      if(currentTrackId !== trackId || beatAnalysisTrackId !== trackId) return;
      const beats = Array.isArray(data.beats) ? data.beats
        .filter(beat => Number.isFinite(beat.start) && Number.isFinite(beat.duration) && beat.duration > 0)
        .sort((a,b) => a.start - b.start) : [];
      beatAnalysis = beats.length ? beats : null;
    })
    .catch(() => {
      // Audio analysis is optional; keep the ordinary ambient gradient working.
      if(beatAnalysisTrackId === trackId) beatAnalysis = null;
    });
}
function updateBeatPulse(){
  const background = $('dynamic-background');
  if(!dynamicBackgroundEnabled || !isPlaying || !beatAnalysis?.length){
    beatPulse *= 0.82;
  } else {
    const time = currentPlaybackSeconds();
    let low = 0, high = beatAnalysis.length - 1;
    while(low < high){
      const mid = Math.ceil((low + high) / 2);
      if(beatAnalysis[mid].start <= time) low = mid;
      else high = mid - 1;
    }
    const beat = beatAnalysis[low];
    if(beat && time >= beat.start){
      const elapsed = time - beat.start;
      const decay = Math.max(0, 1 - elapsed / Math.min(beat.duration, 0.65));
      const confidence = Number.isFinite(beat.confidence) ? Math.max(0.35, Math.min(1, beat.confidence)) : 0.8;
      beatPulse = Math.max(beatPulse * 0.72, decay * confidence);
    } else {
      beatPulse *= 0.82;
    }
  }
  background.style.setProperty('--beat-brightness', (1 + beatPulse * 0.16).toFixed(3));
  background.style.setProperty('--beat-background-size', (150 + beatPulse * 4).toFixed(2) + '%');
}
function setDynamicBackgroundEnabled(enabled){
  dynamicBackgroundEnabled = enabled;
  $('dynamic-background').classList.toggle('off', !enabled);
  const button = $('dynamic-background-toggle');
  button.textContent = 'Dynamic background: ' + (enabled ? 'On' : 'Off');
  button.setAttribute('aria-pressed', String(enabled));
  if(enabled && ambientImageUrl) void setAmbientBackground(ambientImageUrl, true);
}
function say(message){ $('status').textContent = message; }
async function api(path, options={}) {
  const response = await fetch(path, { credentials:'same-origin', cache:'no-store', ...options });
  const data = response.status === 204 ? {} : await response.json().catch(()=>({}));
  if (!response.ok) throw new Error(data.error || 'Request failed ('+response.status+')');
  return data;
}
function clearTrack(){
  $('track').hidden=true;
  $('cover').style.display='none';
  $('mobile-progress').hidden=true;
}
function formatClock(milliseconds){
  const seconds=Math.max(0,Math.floor((Number(milliseconds)||0)/1000));
  return Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');
}
function updateMobileProgress(){
  const duration=latestDurationMs;
  const progress=Math.min(duration||0,Math.max(0,currentPlaybackSeconds()*1000));
  $('progress-fill').style.width=(duration?Math.min(100,progress/duration*100):0)+'%';
  $('progress-current').textContent=formatClock(progress);
  $('progress-duration').textContent=formatClock(duration);
}
function clearLyrics(){
  lyricLines=[];
  braccatoLyrics=null;
  $('lyrics').replaceChildren();
  renderedLyricNodes = [];
  activeLyricIndex = -1;
  $('lyrics-panel').hidden=true;
  $('lyrics-attribution').replaceChildren();
}
function setAttribution(source, uploadAttribution){
  const target=$('lyrics-attribution');
  target.replaceChildren();
  const names={spicy_lyrics:'Spicy Lyrics',apple_music:'Apple Music',spotify:'Spotify','lrc.red':'lrc.red'};
  const provider=names[source] || 'Unknown source';
  target.append('Lyrics provided by ');
  const providerLink=document.createElement('a');
  providerLink.href=source==='lrc.red'?'https://lrc.red/':source==='spicy_lyrics'?'https://spicylyrics.org/': 'https://developers.spicylyrics.org/';
  providerLink.target='_blank'; providerLink.rel='noreferrer'; providerLink.style.color='#f49ac2'; providerLink.textContent=provider;
  target.append(providerLink);
  if(source==='spicy_lyrics' && uploadAttribution){
    const addCredit=(label,person)=>{
      if(!person || !person.username) return;
      target.append(' · '+label+' ');
      const link=document.createElement('a');
      link.textContent=person.username;
      link.href=typeof person.url==='string' && person.url.startsWith('https://') ? person.url : 'https://spicylyrics.org/';
      link.target='_blank'; link.rel='noreferrer'; link.style.color='#f49ac2';
      target.append(link);
    };
    addCredit('uploaded by',uploadAttribution.Uploader);
    addCredit('made by',uploadAttribution.Maker);
  }
}
function getBraccatoElement(){
  if(!braccatoLyrics){
    braccatoLyrics=document.createElement('braccato-lyrics');
    braccatoLyrics.setAttribute('aria-label','Synchronized lyrics');
    braccatoLyrics.style.display='block';
    braccatoLyrics.style.width='100%';
    $('lyrics').replaceChildren(braccatoLyrics);
  }
  return braccatoLyrics;
}
function renderBraccatoLyrics(lines){
  const element=getBraccatoElement();
  element.lyrics=lines;
  element.currentTime=currentPlaybackSeconds();
  element.playing=isPlaying;
}
function renderSpicyLyrics(data){
  clearLyrics();
  $('lyrics-panel').hidden=false;
  const body=data.spicyLyrics||{};
  const content=Array.isArray(body.Content)?body.Content:[];
  lyricLines=content.map(entry=>{
    const lead=entry?.Lead||{};
    const syllables=Array.isArray(lead.Syllables)?lead.Syllables.map(s=>({
      text:typeof s.Text==='string'?s.Text:'',
      time:Number.isFinite(s.StartTime)?s.StartTime:null,
      endTime:Number.isFinite(s.EndTime)?s.EndTime:null,
      isPartOfWord:s.IsPartOfWord===true
    })).filter(s=>s.text):[];
    const text=syllables.length
      ? syllables.map((s,i)=>s.text+(!s.isPartOfWord&&i<syllables.length-1?' ':'')).join('')
      : (lead.Text||lead.TransliteratedText||lead.TranslatedText||entry?.Text||'');
    const candidateTimes=[lead.StartTime,entry?.StartTime,syllables[0]?.time,body.StartTime];
    const time=candidateTimes.find(t=>typeof t==='number'&&Number.isFinite(t));
    return {time:time??0,text,words:syllables};
  }).filter(line=>line.text.trim());
  setAttribution(body.source,body.UploadAttribution);
  if(!lyricLines.length){
    $('lyrics-meta').textContent='Spicy Lyrics returned a response, but it contained no renderable lyric lines.';
    $('lyrics').replaceChildren();
    return;
  }
  const hasSyllableTiming=lyricLines.some(line=>line.words.some(word=>word.time!==null&&word.endTime!==null));
  $('lyrics-meta').textContent=body.Type==='Syllable'&&hasSyllableTiming
    ? 'Spicy Lyrics · word-synced lyrics.'
    : body.Type==='Line'
      ? 'Spicy Lyrics · line-synced lyrics.'
      : 'Spicy Lyrics · lyrics loaded.';
  const braccatoLines=lyricLines.map(line=>{
    const parts=(line.words||[]).filter(word=>Number.isFinite(word.time)).map(word=>({
      startTimeMs:word.time*1000,
      words:word.text,
      durationMs:Number.isFinite(word.endTime)&&word.endTime>word.time
        ? (word.endTime-word.time)*1000 : 180,
    }));
    const startMs=(Number(line.time)||0)*1000;
    const lastPartEnd=parts.reduce((max,part)=>Math.max(max,part.startTimeMs+part.durationMs),startMs);
    return {
      startTimeMs:startMs,
      words:line.text,
      durationMs:Math.max(500,parts.length?lastPartEnd-startMs:3000),
      ...(parts.length?{parts}:{})
    };
  });
  renderBraccatoLyrics(braccatoLines);
}
function timeSeconds(value){
  if(!value) return null;
  const parts=value.trim().split(':');
  if(parts.length===3) return Number(parts[0])*3600+Number(parts[1])*60+Number(parts[2]);
  if(parts.length===2) return Number(parts[0])*60+Number(parts[1]);
  return null;
}
function parseTtml(value){
  const xml=new DOMParser().parseFromString(value,'application/xml');
  if(xml.querySelector('parsererror')) throw new Error('invalid_ttml');
  return Array.from(xml.getElementsByTagNameNS('*','p')).map(p=>{
    const time=timeSeconds(p.getAttribute('begin'));
    const spans=Array.from(p.getElementsByTagNameNS('*','span')).map(span=>({
      text:span.textContent||'',
      time:timeSeconds(span.getAttribute('begin')),
      end:timeSeconds(span.getAttribute('end'))
    })).filter(word=>word.text);
    const text=spans.length ? spans.map(word=>word.text).join('') : (p.textContent||'').trim();
    return {time:time??0,text,words:spans};
  }).filter(line=>line.text.trim()).sort((a,b)=>a.time-b.time);
}
function renderLyrics(data){
  clearLyrics();
  $('lyrics-panel').hidden=false;
  setAttribution('lrc.red');
  let parsed;
  try {
    parsed=TTMLParser.parse(data.ttml||'');
    lyricLines=parsed.map(line=>({
      time:(Number(line.startTimeMs)||0)/1000,
      text:line.words||'',
      words:(line.parts||[]).map(part=>({
        text:part.words||'',
        time:Number.isFinite(part.startTimeMs)?part.startTimeMs/1000:null,
        endTime:Number.isFinite(part.startTimeMs)&&Number.isFinite(part.durationMs)
          ? (part.startTimeMs+part.durationMs)/1000:null
      }))
    }));
  } catch {
    lyricLines=parseTtml(data.ttml||'');
  }
  lyricsAreSynced=lyricLines.some(line=>line.words.some(word=>word.time!==null));
  if(!lyricLines.length){
    $('lyrics-meta').textContent='lrc.red returned a TTML file, but it did not contain readable lyric lines.';
    return;
  }
  $('lyrics-meta').textContent=lyricsAreSynced
    ? 'TTML lyrics loaded · synced highlighting enabled.'
    : 'TTML lyrics loaded · line timing only.';
  if(parsed) renderBraccatoLyrics(parsed);
  else renderPlainLyrics();
}
function renderPlainLyrics(){
  const host = $('lyrics');
  host.replaceChildren();
  renderedLyricNodes = lyricLines.map((line, index) => {
    const row = document.createElement('div');
    row.className = 'lyric-line';
    row.dataset.index = String(index);
    row.dataset.time = String(Number.isFinite(line.time) ? line.time : 0);
    const words = Array.isArray(line.words) ? line.words : [];
    if(words.length && words.some(word => Number.isFinite(word.time))){
      for(const word of words){
        const span = document.createElement('span');
        span.className = 'lyric-word';
        span.textContent = word.text || '';
        if(Number.isFinite(word.time)) span.dataset.time = String(word.time);
        if(Number.isFinite(word.endTime)) span.dataset.end = String(word.endTime);
        else if(Number.isFinite(word.end)) span.dataset.end = String(word.end);
        row.append(span);
      }
    } else {
      row.textContent = line.text;
    }
    host.append(row);
    return row;
  });
  activeLyricIndex = -1;
  updateActiveLyric();
}
function currentPlaybackSeconds(){
  return latestProgressMs/1000+(isPlaying?(Date.now()-progressObservedAt)/1000:0);
}
function updateActiveLyric(){
  if($('lyrics-panel').hidden) return;
  if(braccatoLyrics){
    braccatoLyrics.currentTime=currentPlaybackSeconds();
    braccatoLyrics.playing=isPlaying;
    return;
  }
  if(!renderedLyricNodes.length) return;
  const time = currentPlaybackSeconds();
  let nextIndex = -1;
  for(let i=0; i<lyricLines.length; i++){
    if((Number(lyricLines[i].time) || 0) <= time) nextIndex = i;
    else break;
  }
  if(nextIndex < 0) nextIndex = 0;
  if(nextIndex !== activeLyricIndex){
    if(activeLyricIndex >= 0) renderedLyricNodes[activeLyricIndex]?.classList.remove('active');
    activeLyricIndex = nextIndex;
    const active = renderedLyricNodes[activeLyricIndex];
    active?.classList.add('active');
    active?.scrollIntoView({behavior:'smooth',block:'center'});
  }
  const activeNode = renderedLyricNodes[activeLyricIndex];
  if(!activeNode) return;
  activeNode.querySelectorAll('.lyric-word').forEach(node => {
    const start = Number(node.dataset.time), end = Number(node.dataset.end);
    const hasStart = node.dataset.time !== undefined && Number.isFinite(start);
    const hasEnd = node.dataset.end !== undefined && Number.isFinite(end);
    node.classList.toggle('active', hasStart && start <= time && (!hasEnd || time < end));
  });
}
async function connection(){
  try {
    const data = await api('/api/session');
    $('connection').textContent = data.connected ? 'Spotify connected' : 'not connected';
    $('connect').hidden = data.connected;
    $('find-lyrics').hidden = !data.connected;
    $('disconnect').hidden = !data.connected;
    if (!data.connected) { clearTrack(); clearLyrics(); say('Connect Spotify to detect the track currently playing.'); stopPolling(); }
    else { say('Connected'+(data.user?.displayName ? ' as '+data.user.displayName : '')+'. Checking playback…'); await playback(); startPolling(); }
  } catch(e){ say('Could not check connection: '+e.message+'\nThe Worker may not be configured yet.'); }
}
async function playback(){
  try {
    const data = await api('/api/spotify/playback');
    if (!data.track) {
      if (currentTrackId !== null) {
        currentTrackId = null;
        lyricRequestId++;
        clearLyrics();
      }
      clearTrack();
      say('Spotify is connected, but nothing is currently playing. Start a track in Spotify and check again.');
      return;
    }
    const nextTrackId = data.track.id || `${data.track.title}::${(data.track.artists || []).join(', ')}`;
    const trackChanged = nextTrackId !== currentTrackId;
    currentTrackId = nextTrackId;
    if(trackChanged){ beatAnalysis = null; beatAnalysisTrackId = null; beatPulse = 0; }
    loadBeatAnalysis(data.track.id);
    $('track').hidden=false;
    $('title').textContent=data.track.title;
    $('artist').textContent=(data.track.artists||[]).join(', ') || 'Unknown artist';
    $('album').textContent=data.track.album || '';
    $('playstate').textContent=data.playing ? '▶ Playing' : 'Ⅱ Paused';
    if(data.track.image){ $('cover').src=data.track.image; $('cover').style.display='block'; setAmbientBackground(data.track.image); } else $('cover').style.display='none';
    latestProgressMs=Number(data.progressMs||0);
    latestDurationMs=Number(data.track.durationMs||0);
    $('mobile-progress').hidden=!latestDurationMs;
    progressObservedAt=Date.now();
    isPlaying=!!data.playing;
    if (trackChanged) {
      clearLyrics();
      $('lyrics-panel').hidden = false;
      $('lyrics-meta').textContent = 'New track detected. Loading lyrics…';
      void findLyrics({ automatic: true, trackId: nextTrackId });
    } else {
      updateActiveLyric();
    }
    say('Playback detected successfully.');
  } catch(e) {
    clearTrack();
    if(e.message==='not_connected'||e.message==='spotify_reconnect_required'){ say('Spotify needs to be connected again.'); stopPolling(); $('connection').textContent='not connected'; $('connect').hidden=false; $('find-lyrics').hidden=true; $('disconnect').hidden=true; }
    else if(e.message==='spotify_access_denied') say('Spotify denied playback access. Check the app permissions in Spotify Developer Dashboard.');
    else say('Could not read playback: '+e.message);
  }
}
async function findLyrics({ automatic = false, trackId = currentTrackId } = {}){
  const requestId = ++lyricRequestId;
  if (!automatic) {
    $('find-lyrics').disabled = true;
    $('find-lyrics').textContent = 'Looking…';
  }
  $('lyrics-panel').hidden = false;
  $('lyrics-meta').textContent = automatic
    ? 'New track detected. Asking Spicy Lyrics for the best available sync…'
    : 'Asking Spicy Lyrics for the best available sync…';
  try {
    const data = await api('/api/lyrics');
    if (requestId !== lyricRequestId || trackId !== currentTrackId) return;
    if (data.spicyLyrics) renderSpicyLyrics(data);
    else renderLyrics(data);
  } catch (e) {
    if (requestId !== lyricRequestId || trackId !== currentTrackId) return;
    $('lyrics-panel').hidden = false;
    $('lyrics-meta').textContent = e.message === 'lyrics_not_found'
      ? 'No synced lyrics found for this track yet.'
      : e.message === 'nothing_playing'
        ? 'Start playing a track in Spotify first, then try again.'
        : e.message === 'lyrics_provider_failed'
          ? 'The lyrics provider could not return lyrics right now. Try again in a moment.'
          : 'Could not fetch lyrics: ' + e.message;
  } finally {
    if (requestId === lyricRequestId) {
      $('find-lyrics').disabled = false;
      $('find-lyrics').textContent = 'Find lyrics';
    }
  }
}
function startPolling(){
  stopPolling();
  poller=setInterval(playback,1000);
}
function stopPolling(){
  if(poller) clearInterval(poller);
  poller=null;
}
$('connect').onclick=()=>location.href='/auth/login';
$('check').onclick=playback;
$('find-lyrics').onclick=()=>findLyrics();
$('dynamic-background-toggle').onclick=()=>setDynamicBackgroundEnabled(!dynamicBackgroundEnabled);
$('disconnect').onclick=async()=>{stopPolling();try{await api('/auth/logout',{method:'POST'});clearTrack();clearLyrics();$('connection').textContent='not connected';$('connect').hidden=false;$('find-lyrics').hidden=true;$('disconnect').hidden=true;say('Disconnected from Spotify.')}catch(e){say('Could not disconnect: '+e.message)}};
function animatePlayer(){
  updateActiveLyric();
  updateBeatPulse();
  updateMobileProgress();
  requestAnimationFrame(animatePlayer);
}
requestAnimationFrame(animatePlayer);
const queryError=new URLSearchParams(location.search).get('spotify_error');
if(queryError) say('Spotify connection error: '+queryError.replaceAll('_',' ')+'. Check the app settings and try again.');
connection();