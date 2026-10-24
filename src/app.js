import '@fontsource-variable/inter';
import { LyricPlayer } from '@applemusic-like-lyrics/core';
import '@applemusic-like-lyrics/core/style.css';

const $ = id => document.getElementById(id);
let poller = null;
let currentTrackId = null;
let lyricRequestId = 0;
let lyricLines = [];
let lyricsAreSynced = false;
let amllPlayer = new LyricPlayer();
let lastFrameTime = null;
const lyricHost = $('lyrics');
lyricHost.appendChild(amllPlayer.getElement());
amllPlayer.setOptimizeOptions({
  normalizeSpaces: false,
  resetLineTimestamps: false,
  cleanUnintentionalOverlaps: false,
  tryAdvanceStartTime: false
});
let latestProgressMs = 0;
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
  button.textContent = 'fancy background: ' + (enabled ? 'on' : 'off');
  button.setAttribute('aria-pressed', String(enabled));
  if(enabled && ambientImageUrl) void setAmbientBackground(ambientImageUrl, true);
}
function say(message){ $('status').textContent = message; }
async function api(path, options={}) {
  const response = await fetch(path, { credentials:'same-origin', cache:'no-store', ...options });
  const data = response.status === 204 ? {} : await response.json().catch(()=>({}));
  if (!response.ok) { const error = new Error(data.error || 'Request failed ('+response.status+')'); error.details = data.details || ''; error.status = response.status; throw error; }
  return data;
}
function clearTrack(){ $('track').hidden=true; $('cover').style.display='none'; }
function clearLyrics(){
  lyricLines=[];
  if(amllPlayer){
    amllPlayer.setLyricLines([]);
    amllPlayer.setCurrentTime(0, true);
    amllPlayer.pause();
  }
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
    amllPlayer.setLyricLines([]);
    return;
  }
  const hasSyllableTiming=lyricLines.some(line=>line.words.some(word=>word.time!==null&&word.endTime!==null));
  $('lyrics-meta').textContent=body.Type==='Syllable'&&hasSyllableTiming
    ? 'SPICY LYRICS BROUGHT THE WORDS and AMLL is doing the little karaoke dance. look at them go.'
    : body.Type==='Line'
      ? 'the words are synced to the song!! AMLL is keeping up. somehow.'
      : 'here are the words. AMLL put them on the screen. we did it everybody.';
  loadIntoAMLL();
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
  lyricLines=parseTtml(data.ttml||'');
  lyricsAreSynced=lyricLines.some(line=>line.words.some(word=>word.time!==null));
  if(!lyricLines.length){
    $('lyrics-meta').textContent='lrc.red returned a TTML file, but it did not contain readable lyric lines.';
    return;
  }
  $('lyrics-meta').textContent=lyricsAreSynced
    ? 'TTML lyrics loaded · AMLL rendering enabled.'
    : 'TTML lyrics loaded · line timing only.';
  loadIntoAMLL();
}
function loadIntoAMLL(){
  const amllLines=lyricLines.map((line,index)=>{
    const nextLineTime=lyricLines[index+1]?.time;
    const lineStart=Math.round((line.time||0)*1000);
    const words=(line.words||[]).map((word,wordIndex,array)=>{
      const hasWordTiming=Number.isFinite(word.time);
      const startTime=hasWordTiming?Math.round(word.time*1000):lineStart;
      const endSeconds=Number.isFinite(word.endTime)?word.endTime:
        Number.isFinite(word.end)?word.end:
        (Number.isFinite(nextLineTime)?nextLineTime:(line.time||0)+2);
      const text=String(word.text||'');
      const needsSpace=typeof word.isPartOfWord==='boolean'
        ? !word.isPartOfWord && wordIndex<array.length-1
        : false;
      return {
        word:text+(needsSpace?' ':''),
        startTime,
        endTime:Math.max(startTime+1,Math.round(endSeconds*1000))
      };
    });
    if(!words.length){
      words.push({
        word:line.text,
        startTime:lineStart,
        endTime:Math.max(lineStart+1,Math.round((Number.isFinite(nextLineTime)?nextLineTime:(line.time||0)+3)*1000))
      });
    }
    const startTime=Number.isFinite(lineStart)?lineStart:0;
    const inferredEnd=Math.max(...words.map(word=>word.endTime),startTime+1);
    return {
      words,
      translatedLyric:'',
      romanLyric:'',
      startTime,
      endTime:Math.max(inferredEnd,Number.isFinite(nextLineTime)?Math.round(nextLineTime*1000):0),
      isBG:false,
      isDuet:false
    };
  });
  const currentTime=Math.round(currentPlaybackSeconds()*1000);
  amllPlayer.setLyricLines(amllLines,currentTime);
  amllPlayer.setCurrentTime(currentTime,true);
  if(isPlaying) amllPlayer.resume(); else amllPlayer.pause();
}
function currentPlaybackSeconds(){
  return latestProgressMs/1000+(isPlaying?(Date.now()-progressObservedAt)/1000:0);
}
function updateActiveLyric(){
  if(!amllPlayer || $('lyrics-panel').hidden) return;
  amllPlayer.setCurrentTime(Math.round(currentPlaybackSeconds()*1000));
}
let availableDevices = [];
let selectedDeviceId = '';
let shuffleEnabled = false;
let repeatState = 'off';
let trackDurationMs = 0;
let seekingProgress = false;
function formatTime(ms){const s=Math.max(0,Math.floor((Number(ms)||0)/1000));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');}
function renderProgress(){const bar=$('progress-bar');if(!bar)return;const p=Math.min(trackDurationMs,Math.max(0,currentPlaybackSeconds()*1000));if(!seekingProgress)bar.value=trackDurationMs?String(Math.round(p/trackDurationMs*1000)):'0';bar.disabled=!trackDurationMs;$('progress-current').textContent=formatTime(p);$('progress-duration').textContent=formatTime(trackDurationMs);}
function selectedDevice(){
  return $('spotify-device').value || selectedDeviceId || '';
}
async function loadDevices(){
  const select=$('spotify-device');
  const status=$('device-status');
  $('connect-controls').hidden=false;
  status.textContent='looking for your Spotify devices. come out come out wherever you are…';
  try{
    const data=await api('/api/spotify/devices');
    availableDevices=Array.isArray(data.devices)?data.devices:[];
    const previous=select.value || selectedDeviceId;
    select.replaceChildren();
    if(!availableDevices.length){
      const option=document.createElement('option');
      option.value=''; option.textContent='no devices found. open Spotify first pls';
      select.append(option);
      selectedDeviceId='';
      status.textContent='open Spotify on your phone/computer/console/whatever and press look again. i believe in you';
      return;
    }
    for(const device of availableDevices){
      const option=document.createElement('option');
      option.value=device.id || '';
      option.textContent=device.name+(device.isActive?' · Active':'')+(device.isRestricted?' · Unavailable':'');
      option.disabled=!device.id || device.isRestricted;
      select.append(option);
    }
    const preferred=availableDevices.find(device=>device.id===previous&&!device.isRestricted)
      || availableDevices.find(device=>device.isActive&&!device.isRestricted)
      || availableDevices.find(device=>device.id&&!device.isRestricted);
    if(preferred){select.value=preferred.id;selectedDeviceId=preferred.id;}
    status.textContent=preferred
      ? 'found '+preferred.name+'!! we can try controlling it. Spotify Premium is required for playback controls.'
      : 'devices exist but apparently none of them want to cooperate.';
  }catch(error){
    status.textContent='could not find the devices. rude. ('+error.message+')';
  }
}
async function playerCommand(action, extra={}){
  const deviceId=selectedDevice();
  if(!deviceId && action!=='shuffle'){
    $('device-status').textContent='pick a device first bestie';
    return;
  }
  const buttons=['previous-track','play-pause','next-track','shuffle-toggle','repeat-toggle','refresh-devices'];
  buttons.forEach(id=>$(id).disabled=true);
  $('device-status').textContent='asking Spotify nicely…';
  try{
    await api('/api/spotify/player/'+action,{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({...extra,device_id:['previous','next'].includes(action)?undefined:(deviceId||undefined)})
    });
    if(action==='shuffle'){
      shuffleEnabled=!!extra.state;
      $('shuffle-toggle').setAttribute('aria-pressed',String(shuffleEnabled));
      $('shuffle-toggle').setAttribute('aria-label',shuffleEnabled?'Shuffle on':'Shuffle off');
    }
    $('device-status').textContent='sent!! checking if Spotify listened…';
    await playback();
    await loadDevices();
  }catch(error){
    $('device-status').textContent=error.message==='spotify_no_active_device'
      ? 'Spotify has no active device. open Spotify somewhere and try again pls.'
      : error.message==='spotify_access_denied'
        ? 'Spotify said NO to '+action+' (HTTP '+(error.status||403)+')'+(error.details?' · '+error.details:'')+'. check the active device/context. why are you like this Spotify.'
        : error.message==='spotify_rate_limited'
          ? 'Spotify is telling us to calm down. wait a sec and try again.'
          : 'could not control Spotify: '+error.message+' (i am looking at you, Spotify)';
  }finally{
    buttons.forEach(id=>$(id).disabled=false);
  }
}
async function connection(){
  try {
    const data = await api('/api/session');
    $('connection').textContent = data.connected ? 'Spotify connected' : 'not connected';
    $('connect').hidden = data.connected;
    $('find-lyrics').hidden = !data.connected;
    $('disconnect').hidden = !data.connected;
    if (!data.connected) { $('connect-controls').hidden=true; clearTrack(); clearLyrics(); say('hi!! connect Spotify so i can see what you are playing. i promise to be normal about it'); stopPolling(); }
    else { say('WE ARE IN'+(data.user?.displayName ? ' as '+data.user.displayName : '')+'!! checking what is playing…'); await loadDevices(); await playback(); startPolling(); }
  } catch(e){ say('uh oh. connection check failed: '+e.message+'\nthe Worker may be having a moment.'); }
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
      say('Spotify is connected but it is SILENT in here. play something and come back.');
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
    $('playstate').textContent=data.playing ? 'Playing' : 'Paused';
    $('play-pause').innerHTML=data.playing?'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5h3v14H8zM15 5h3v14h-3z" fill="currentColor"/></svg>':'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v16l13-8z" fill="currentColor"/></svg>';
    $('play-pause').setAttribute('aria-label',data.playing?'Pause':'Play');
    if(data.track.image){ $('cover').src=data.track.image; $('cover').style.display='block'; setAmbientBackground(data.track.image); } else $('cover').style.display='none';
    latestProgressMs=Number(data.progressMs||0);
    trackDurationMs=Number(data.track.durationMs||0);
    progressObservedAt=Date.now();
    if(typeof data.shuffleState==='boolean'){shuffleEnabled=data.shuffleState;$('shuffle-toggle').setAttribute('aria-pressed',String(shuffleEnabled));}
    if(['off','context','track'].includes(data.repeatState)){repeatState=data.repeatState;$('repeat-toggle').setAttribute('aria-pressed',String(repeatState!=='off'));$('repeat-toggle').setAttribute('aria-label','Repeat '+repeatState);$('repeat-toggle').title='Repeat '+repeatState;}
    renderProgress();
    isPlaying=!!data.playing;
    if(amllPlayer){
      amllPlayer.setCurrentTime(Math.round(latestProgressMs),true);
      if(isPlaying) amllPlayer.resume(); else amllPlayer.pause();
    }
    if (trackChanged) {
      clearLyrics();
      $('lyrics-panel').hidden = false;
      $('lyrics-meta').textContent = 'New track detected. Loading lyrics…';
      void findLyrics({ automatic: true, trackId: nextTrackId });
    } else {
      updateActiveLyric();
    }
    say('PLAYBACK DETECTED. WE ARE SO BACK.');
  } catch(e) {
    clearTrack();
    if(e.message==='not_connected'||e.message==='spotify_reconnect_required'){ say('Spotify forgot who we are. reconnect and try again pls.'); stopPolling(); $('connection').textContent='not connected'; $('connect').hidden=false; $('find-lyrics').hidden=true; $('disconnect').hidden=true; }
    else if(e.message==='spotify_access_denied') say('Spotify said we cannot look at playback. check the app permissions. Spotify please i am begging');
    else say('i could not read playback: '+e.message+' :(');
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
    ? 'NEW SONG!! asking Spicy Lyrics to find the words…'
    : 'asking Spicy Lyrics for the words. do your thing…';
  if (amllPlayer) amllPlayer.setLyricLines([]);
  try {
    const data = await api('/api/lyrics');
    if (requestId !== lyricRequestId || trackId !== currentTrackId) return;
    if (data.spicyLyrics) renderSpicyLyrics(data);
    else renderLyrics(data);
  } catch (e) {
    if (requestId !== lyricRequestId || trackId !== currentTrackId) return;
    $('lyrics-panel').hidden = false;
    $('lyrics-meta').textContent = e.message === 'lyrics_not_found'
      ? 'no lyrics found for this one yet. devastating. tragic. call the authorities.'
      : e.message === 'nothing_playing'
        ? 'play a song on Spotify first and then ask me for the words. i am not a wizard.'
        : e.message === 'lyrics_provider_failed'
          ? 'the lyrics people are not answering right now. try again in a sec.'
          : 'could not get the words: ' + e.message+' :(';
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
$('refresh-devices').onclick=loadDevices;
$('spotify-device').onchange=()=>{selectedDeviceId=$('spotify-device').value;const device=availableDevices.find(item=>item.id===selectedDeviceId);if(device)$('device-status').textContent='Selected '+device.name+'.';};
$('play-pause').onclick=()=>playerCommand(isPlaying?'pause':'play');
$('previous-track').onclick=()=>playerCommand('previous');
$('next-track').onclick=()=>playerCommand('next');
$('shuffle-toggle').onclick=()=>playerCommand('shuffle',{state:!shuffleEnabled});
$('repeat-toggle').onclick=()=>{const next=repeatState==='off'?'context':repeatState==='context'?'track':'off';playerCommand('repeat',{state:next});};
$('progress-bar').addEventListener('input',()=>{seekingProgress=true;$('progress-current').textContent=formatTime(Number($('progress-bar').value)/1000*trackDurationMs);});
$('progress-bar').addEventListener('change',async()=>{const position=Math.round(Number($('progress-bar').value)/1000*trackDurationMs);seekingProgress=false;try{await api('/api/spotify/player/seek',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({position_ms:position,device_id:selectedDevice()||undefined})});latestProgressMs=position;progressObservedAt=Date.now();renderProgress();}catch(error){$('device-status').textContent='could not skip to that bit: '+error.message+' :(';await playback();}});
$('find-lyrics').onclick=()=>findLyrics();
$('dynamic-background-toggle').onclick=()=>setDynamicBackgroundEnabled(!dynamicBackgroundEnabled);
$('disconnect').onclick=async()=>{stopPolling();try{await api('/auth/logout',{method:'POST'});clearTrack();clearLyrics();$('connection').textContent='not connected';$('connect').hidden=false;$('find-lyrics').hidden=true;$('disconnect').hidden=true;say('okay bye Spotify. see you later i guess.')}catch(e){say('Spotify would not let me leave. '+e.message)}};
function animateAMLL(frameTime){
  const delta=lastFrameTime===null?0:frameTime-lastFrameTime;
  lastFrameTime=frameTime;
  if(amllPlayer){
    amllPlayer.setCurrentTime(Math.round(currentPlaybackSeconds()*1000));
    renderProgress();
    amllPlayer.update(delta);
  }
  updateBeatPulse();
  requestAnimationFrame(animateAMLL);
}
requestAnimationFrame(animateAMLL);
const queryError=new URLSearchParams(location.search).get('spotify_error');
if(queryError) say('Spotify connection error: '+queryError.replaceAll('_',' ')+'. something went wrong. check the app settings pls :(');
connection();