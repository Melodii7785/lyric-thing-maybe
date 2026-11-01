import '@fontsource-variable/inter';
import Hls from 'hls.js';
// Keep the verified app.js fix on a fresh commit so CI can run again.
import { LyricPlayer } from '@applemusic-like-lyrics/core';
import '@applemusic-like-lyrics/core/style.css';

const $ = id => document.getElementById(id);
let poller = null;
let currentTrackId = null;
let currentAppleTrack = null;
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
let kawarp = null;
let kawarpLoading = null;
let kawarpSourceUrl = '';
let dynamicBackgroundEnabled = true;
let ambientImageUrl = '';
let nowbarMotionHls = null;
let ambientRequestId = 0;
let beatAnalysis = null;
let beatAnalysisTrackId = null;
let beatPulse = 0;
async function getKawarp(){
  if(kawarp) return kawarp;
  if(!kawarpLoading){
    kawarpLoading = import('https://cdn.jsdelivr.net/npm/@kawarp/core@1.3.0/+esm')
      .then(({ Kawarp }) => {
        const canvas = $('kawarp-background');
        kawarp = new Kawarp(canvas, {
          warpIntensity: 1.0,
          blurPasses: 6,
          animationSpeed: 1.0,
          transitionDuration: 1000,
          saturation: 3.0,
          tintColor: [40 / 255, 40 / 255, 60 / 255],
          tintIntensity: 0.0,
          ditherStrength: 0.0,
          scale: 1.0
        });
        kawarp.start();
        return kawarp;
      });
  }
  return kawarpLoading;
}
function setLyricsContrastFromCover(imageUrl){
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => {
    try {
      const canvas = document.createElement('canvas');
      const size = 32;
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(image, 0, 0, size, size);
      const pixels = ctx.getImageData(0, 0, size, size).data;
      let luminance = 0;
      for(let i = 0; i < pixels.length; i += 4){
        // Relative luminance: good enough to decide whether black or white survives.
        luminance += (0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]);
      }
      luminance /= (pixels.length / 4);
      document.documentElement.style.setProperty('--amll-unfocused', luminance > 150 ? '#000' : '#fff');
      console.log('[Lyric contrast]', luminance > 150 ? 'black lyrics' : 'white lyrics', luminance);
    } catch(error) {
      console.warn('[Lyric contrast sampling failed]', error);
    }
  };
  image.onerror = () => console.warn('[Lyric contrast image failed]');
  image.src = imageUrl;
}

async function setAmbientBackground(imageUrl, force = false){
  if(!imageUrl || (!force && imageUrl === kawarpSourceUrl)) return;
  kawarpSourceUrl = imageUrl;
  ambientImageUrl = imageUrl;
  setLyricsContrastFromCover('/api/cover-proxy?url=' + encodeURIComponent(imageUrl));
  if(!dynamicBackgroundEnabled) return;
  try {
    const renderer = await getKawarp();
    if(imageUrl !== kawarpSourceUrl || !dynamicBackgroundEnabled) return;
    await renderer.loadImage(imageUrl);
  } catch(error) {
    console.warn('[Kawarp background failed]', error);
  }
}
async function loadNowbarMotion(){
  const video=$('nowbar-motion');

  // A new song starts with a clean slate. Otherwise the previous HLS stream
  // happily keeps playing when the new song has no Album Motion. Rude.
  if(nowbarMotionHls){
    nowbarMotionHls.destroy();
    nowbarMotionHls=null;
  }
  video.pause();
  video.removeAttribute('src');
  video.load();
  video.style.display='none';
  $('nowbar-cover').style.display='block';

  try{
    const response=await fetch('/api/apple-motion',{credentials:'same-origin'});
    if(!response.ok) throw new Error('no motion artwork');
    const motion=await response.json();
    if(!motion.square) throw new Error('no square motion artwork');
    if(nowbarMotionHls){ nowbarMotionHls.destroy(); nowbarMotionHls=null; }
    // Prefer hls.js where possible. Some Chromium browsers say they "maybe"
    // support HLS natively, then proceed to display absolutely nothing. Rude.
    if(Hls.isSupported()){
      nowbarMotionHls=new Hls();
      nowbarMotionHls.on(Hls.Events.ERROR, (_event, data)=>{
        if(data.fatal){
          nowbarMotionHls?.destroy();
          nowbarMotionHls=null;
          video.style.display='none';
          $('nowbar-cover').style.display='block';
        }
      });
      nowbarMotionHls.loadSource(motion.square);
      nowbarMotionHls.attachMedia(video);
    }else if(video.canPlayType('application/vnd.apple.mpegurl')){
      video.src=motion.square;
    }else throw new Error('HLS not supported');

    video.muted=true; video.loop=true; video.playsInline=true;
    // Keep the normal cover visible until we have an actual video frame.
    video.onloadeddata=()=>{
      video.style.display='block';
      $('nowbar-cover').style.display='none';
      video.play().catch(()=>{});
    };
    video.onerror=()=>{
      video.style.display='none';
      $('nowbar-cover').style.display='block';
    };
  }catch{
    // No Album Motion for this song: the static cover we restored above stays.
    video.pause();
    video.style.display='none';
    $('nowbar-cover').style.display='block';
  }
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
    .catch(() => { if(beatAnalysisTrackId === trackId) beatAnalysis = null; });
}
function updateBeatPulse(){}
function setDynamicBackgroundEnabled(enabled){
  dynamicBackgroundEnabled = enabled;
  $('dynamic-background').classList.toggle('off', !enabled);
  const button = $('dynamic-background-toggle');
  button.textContent = 'fancy background: ' + (enabled ? 'on' : 'off');
  button.setAttribute('aria-pressed', String(enabled));
  if(enabled && ambientImageUrl) void setAmbientBackground(ambientImageUrl, true);
}
// Tiny Apple-cover experiment: Apple documents JSONP callbacks for cross-site Search API requests.
function searchAppleCoverDirect(track){
  return new Promise((resolve, reject) => {
    const callback = '__appleCover_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    const script = document.createElement('script');
    const cleanup = () => {
      script.remove();
      try { delete window[callback]; } catch {}
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('apple_cover_timeout'));
    }, 10000);
    window[callback] = data => {
      clearTimeout(timeout);
      cleanup();
      const results = Array.isArray(data?.results) ? data.results : [];
      const wantedTitle = String(track.title || '').toLowerCase();
      const wantedArtist = String((track.artists || [])[0] || '').toLowerCase();
      const best = results.find(item =>
        String(item.trackName || '').toLowerCase() === wantedTitle &&
        String(item.artistName || '').toLowerCase().includes(wantedArtist)
      ) || results[0] || null;
      if (best?.artworkUrl100) {
        best.artworkUrlLarge = best.artworkUrl100.replace(/\d+x\d+(bb)?/i, '3000x3000bb');
      }
      resolve(best);
    };
    script.onerror = () => {
      clearTimeout(timeout);
      cleanup();
      reject(new Error('apple_cover_load_failed'));
    };
    const params = new URLSearchParams({
      term: [track.title, (track.artists || [])[0], track.album].filter(Boolean).join(' '),
      country: 'BR',
      media: 'music',
      entity: 'song',
      limit: '5',
      callback
    });
    script.src = 'https://itunes.apple.com/search?' + params;
    document.head.appendChild(script);
  });
}
window.testAppleCover = searchAppleCoverDirect;
function say(message){ $('status').textContent = message; }
async function api(path, options={}) {
  const response = await fetch(path, { credentials:'same-origin', cache:'no-store', ...options });
  const data = response.status === 204 ? {} : await response.json().catch(()=>({}));
  if (!response.ok) { const error = new Error(data.error || 'Request failed ('+response.status+')'); error.details = data.details || ''; error.status = response.status; throw error; }
  return data;
}
function clearTrack(){ $('track').hidden=true; $('nowbar').hidden=true; $('cover').style.display='none'; }
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
  // Apple Music attribution should lead to the actual track we already found
  // through the iTunes lookup, not the generic developer site.
  providerLink.href=source==='apple_music'
    ? (currentAppleTrack?.trackViewUrl || 'https://music.apple.com/')
    : source==='lrc.red'
      ? 'https://lrc.red/'
      : source==='spicy_lyrics'
        ? 'https://spicylyrics.org/'
        : 'https://developers.spicylyrics.org/';
  providerLink.target='_blank'; providerLink.rel='noreferrer'; providerLink.style.color='#f49ac2'; providerLink.textContent=provider;
  target.append(providerLink);

  // Community lyrics can still point people to the matched Apple Music track.
  if(source==='spicy_lyrics' && currentAppleTrack?.trackViewUrl){
    target.append(' · ');
    const appleLink=document.createElement('a');
    appleLink.href=currentAppleTrack.trackViewUrl;
    appleLink.target='_blank'; appleLink.rel='noreferrer';
    appleLink.style.color='#f49ac2';
    appleLink.textContent='View on Apple Music';
    target.append(appleLink);
  }
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
    ? 'we did it evergbkdy. the lyrics are SYLLABLE SYNCed. three cheers for tecknologi!!.'
    : body.Type==='Line'
      ? 'i guess this works idk. its like spotify but best we got for this song'
      : 'vat ze fuck is zhis bro. regular lyriks? i asked for ze FANCI lyriks';
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
      option.value=''; option.textContent='no devices found. open Spotify first you idiot';
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
      ? 'found '+preferred.name+'!! we can try controlling it. spotify premium obligatory 4 plagback you loser'
      : 'devices exist but apparently none of them want to cooperate.';
  }catch(error){
    status.textContent='could not find the devices. rude. ('+error.message+')';
  }
}
async function playerCommand(action, extra={}){
  const deviceId=selectedDevice();
  if(!deviceId && action!=='shuffle'){
    $('device-status').textContent='pick a device first idiot';
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
      ? 'spotify has no active device. open Spotify somewhere and try again pls.'
      : error.message==='spotify_access_denied'
        ? 'spotify said FUCK YOU to '+action+' (HTTP '+(error.status||403)+')'+(error.details?' · '+error.details:'')+'. check the active device/context. im crying spotify is so CRUEL'
        : error.message==='spotify_rate_limited'
          ? 'spotify is telling us to calm down. wait a sec and try again.'
          : 'could not control spotify: '+error.message+' (i am looking at you, spotify)';
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
    if (!data.connected) { $('connect-controls').hidden=true; clearTrack(); clearLyrics(); say('hi!! connect spotify so i can see what you are playing. i promise to be normal about it'); stopPolling(); }
    else { say('WE ARE IN'+(data.user?.displayName ? ' as '+data.user.displayName : '')+'!! checking what is playing…'); await loadDevices(); await playback(); startPolling(); }
  } catch(e){ say('uh oh. connection check failed: '+e.message+'\nthe Worker™ may be having a moment.'); }
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
      say('Spotify is connected but it is silENT in here. play something and come back.');
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
    $('nowbar').hidden=false;
    $('nowbar-title').textContent=data.track.title;
    $('nowbar-artist').textContent=(data.track.artists||[]).join(', ') || 'Unknown artist';
    $('album').textContent=data.track.album || '';
    $('playstate').textContent=data.playing ? 'Playing' : 'Paused';
    $('play-pause').innerHTML=data.playing?'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5h3v14H8zM15 5h3v14h-3z" fill="currentColor"/></svg>':'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v16l13-8z" fill="currentColor"/></svg>';
    $('play-pause').setAttribute('aria-label',data.playing?'Pause':'Play');
    if(data.track.image){
      $('cover').src=data.track.image;
      $('cover').style.display='block';

      // Don't re-apply Spotify's cover on every playback poll. The Apple
      // lookup may have already upgraded the NowBar artwork for this track.
      // Only give Spotify's image the initial/fallback job when the track changes.
      if(trackChanged){
        const nowbarCover=$('nowbar-cover');
        nowbarCover.classList.remove('art-changing');
        void nowbarCover.offsetWidth;
        nowbarCover.src=data.track.image;
        nowbarCover.classList.add('art-changing');
        loadNowbarMotion();
      }
    } else $('cover').style.display='none';
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
      // Test Apple directly from the browser, separately from the Worker experiment.
      searchAppleCoverDirect(data.track)
        .then(result => {
          console.log('[Apple cover test]', result);
          if(nextTrackId === currentTrackId) currentAppleTrack = result || null;
          const appleArtwork = result?.artworkUrlLarge || result?.artworkUrl100;
          if(appleArtwork){
            // One Apple lookup, two jobs: Kawarp keeps its 1500px source and
            // the static NowBar reuses that same result.
            const nowbarCover=$('nowbar-cover');
            nowbarCover.classList.remove('art-changing');
            void nowbarCover.offsetWidth;
            nowbarCover.src=appleArtwork;
            nowbarCover.classList.add('art-changing');
            setAmbientBackground(appleArtwork);
          }
          else if(data.track.image) setAmbientBackground(data.track.image);
        })
        .catch(error => {
          console.warn('[Apple cover test failed]', error);
          if(data.track.image) setAmbientBackground(data.track.image);
        });
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
    else if(e.message==='spotify_access_denied') say('spotify said fuck you and that we cannot look at playback. check the app permissions. spotify please i am begging');
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
$('refresh-fancy-background').onclick=async()=>{
  if(!ambientImageUrl){ say('there is no fancy background to refresh yet. play something first maybe'); return; }
  const button=$('refresh-fancy-background');
  button.disabled=true;
  const originalText=button.textContent;
  button.textContent='refreshing the fanciness...';
  try{
    await setAmbientBackground(ambientImageUrl,true);
    say('fancy background refreshed. hopefully Kawarp listened this time.');
  }finally{
    button.disabled=false;
    button.textContent=originalText;
  }
};
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
