import '@fontsource-variable/inter';
import Hls from 'hls.js';
// Keep the verified app.js fix on a fresh commit so CI can run again.
import { LyricPlayer } from '@applemusic-like-lyrics/core';
import '@applemusic-like-lyrics/core/style.css';
import { OriginalSpicyLyricsEngine } from './renderer/spicy/OriginalSpicyLyricsEngine.ts';
import './renderer/spicy/original/css/Lyrics/Mixed.css';
import { Animate as animateOriginalSpicyLyrics } from './renderer/spicy/original/utils/Lyrics/Animator/Lyrics/LyricsAnimator.ts';
import { TimeSetter as setOriginalSpicyLyricsTime } from './renderer/spicy/original/utils/Lyrics/Animator/Lyrics/LyricsSetter.ts';
import { QueueForceScroll } from './renderer/spicy/original/utils/Scrolling/ScrollToActiveLine.ts';
import { $simpleLyricsMode } from './renderer/spicy/original/utils/stores.ts';

const $ = id => document.getElementById(id);
let poller = null;
let currentTrackId = null;
let currentAppleTrack = null;
let lyricRequestId = 0;
let lyricLines = [];
let lyricsAreSynced = false;
let amllPlayer = new LyricPlayer();
let originalSpicyEngine = null;
let currentSpicyLyricsData = null;
let lyricRendererMode = 'port';
const LYRICS_ZOOM_KEY = 'lyricthing.spicyLyricsZoom';
const LYRICS_ZOOM_STEP = 0.1;
const LYRICS_ZOOM_MIN = 0.6;
const LYRICS_ZOOM_MAX = 2.2;
let lyricsZoom = 1;
let savedLyricsZoom = 1;
function readLyricsZoom(){
  try {
    const value=Number(localStorage.getItem(LYRICS_ZOOM_KEY));
    return Number.isFinite(value)&&value>=LYRICS_ZOOM_MIN&&value<=LYRICS_ZOOM_MAX?value:1;
  } catch { return 1; }
}
function applyLyricsZoom(){
  const page=lyricHost.querySelector('.SpicyLyricsPage');
  if(page) page.style.setProperty('--SL-LyricsZoom',String(lyricsZoom));
  $('lyrics-zoom-save').textContent=Math.abs(lyricsZoom-savedLyricsZoom)<0.001
    ? "that's it. saved for the future. ✓"
    : "that's it. save it for the future.";
  $('lyrics-zoom-in').disabled=lyricsZoom>=LYRICS_ZOOM_MAX;
  $('lyrics-zoom-out').disabled=lyricsZoom<=LYRICS_ZOOM_MIN;
}

const APPEARANCE_KEY = 'lyricthing.originalAppearance';
const APPEARANCE_DEFAULTS = { font: 'sf', simple: false, blur: true, animations: true };
function readAppearance(){
  try { return { ...APPEARANCE_DEFAULTS, ...JSON.parse(localStorage.getItem(APPEARANCE_KEY)||'{}') }; }
  catch { return { ...APPEARANCE_DEFAULTS }; }
}
let appearance = readAppearance();
function applyOriginalAppearance(){
  const page = lyricHost.querySelector('.SpicyLyricsPage');
  if(!page) return;
  page.dataset.lyricFont = appearance.font;
  page.classList.toggle('SimpleLyricsMode', appearance.simple);
  page.classList.toggle('NoAnimations', !appearance.animations);
  page.querySelector('.LyricsContent')?.classList.toggle('HideLineBlur', !appearance.blur);
  $simpleLyricsMode.set(appearance.simple);
}
function syncAppearanceControls(){
  $('appearance-font').value = appearance.font;
  $('appearance-simple').checked = appearance.simple;
  $('appearance-blur').checked = appearance.blur;
  $('appearance-animations').checked = appearance.animations;
}
function saveAppearance(){
  try { localStorage.setItem(APPEARANCE_KEY, JSON.stringify(appearance)); }
  catch(error) { console.warn('[Appearance] Could not save settings', error); }
  applyOriginalAppearance();
}

function changeLyricsZoom(amount){
  lyricsZoom=Math.min(LYRICS_ZOOM_MAX,Math.max(LYRICS_ZOOM_MIN,Math.round((lyricsZoom+amount)*100)/100));
  applyLyricsZoom();
}

let lastFrameTime = null;
const lyricHost = $('lyrics');
lyricHost.appendChild(amllPlayer.getElement());
originalSpicyEngine = new OriginalSpicyLyricsEngine(lyricHost);
lyricsZoom=readLyricsZoom();
savedLyricsZoom=lyricsZoom;
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
async function loadNowbarMotion(fallbackImageUrl=''){
  const video=$('nowbar-motion');
  const trackAtStart=currentTrackId;
  const restoreStaticBackground=async()=>{
    if(trackAtStart!==currentTrackId) return;
    try{
      const renderer=await getKawarp();
      if(trackAtStart!==currentTrackId || !dynamicBackgroundEnabled) return;
      if(fallbackImageUrl) await renderer.loadImage(fallbackImageUrl);
    }catch(error){
      console.warn('[Kawarp motion fallback failed]',error);
    }
  };

  // A new song starts with a clean slate. Otherwise the previous HLS stream
  // happily keeps playing when the new song has no Album Motion. Rude.
  if(nowbarMotionHls){
    nowbarMotionHls.destroy();
    nowbarMotionHls=null;
  }
  video.pause();
  video.crossOrigin='anonymous';
  video.onloadeddata=null;
  video.onerror=null;
  video.removeAttribute('src');
  video.load();
  video.style.display='none';
  $('nowbar-cover').style.display='block';
  void restoreStaticBackground();

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
          void restoreStaticBackground();
        }
      });
      nowbarMotionHls.loadSource(motion.square);
      nowbarMotionHls.attachMedia(video);
    }else if(video.canPlayType('application/vnd.apple.mpegurl')){
      video.src=motion.square;
    }else throw new Error('HLS not supported');

    video.muted=true; video.loop=true; video.playsInline=true;
    // Keep the normal cover visible until we have an actual video frame.
    video.onloadeddata=async()=>{
      if(trackAtStart!==currentTrackId) return;
      video.style.display='block';
      $('nowbar-cover').style.display='none';
      try{
        if(!('requestVideoFrameCallback' in HTMLVideoElement.prototype)){
          throw new Error('requestVideoFrameCallback is not supported in this browser');
        }
        if(dynamicBackgroundEnabled){
          const renderer=await getKawarp();
          if(trackAtStart!==currentTrackId) return;
          renderer.loadVideo(video,{
            frameRate:12,
            smoothing:120,
            onError:error=>{
              console.warn('[Kawarp could not sample Album Motion]',error);
              void restoreStaticBackground();
            }
          });
        }
      }catch(error){
        console.warn('[Kawarp Album Motion sync unavailable]',error);
        void restoreStaticBackground();
      }
      video.play().catch(()=>{});
    };
    video.onerror=()=>{
      video.style.display='none';
      $('nowbar-cover').style.display='block';
      void restoreStaticBackground();
    };
  }catch{
    // No Album Motion for this song: the static cover we restored above stays.
    video.pause();
    video.style.display='none';
    $('nowbar-cover').style.display='block';
    void restoreStaticBackground();
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
function searchAppleCatalog(track, entity, term = [track.title, (track.artists || [])[0], track.album].filter(Boolean).join(' ')){
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
      resolve(Array.isArray(data?.results) ? data.results : []);
    };
    script.onerror = () => {
      clearTimeout(timeout);
      cleanup();
      reject(new Error('apple_cover_load_failed'));
    };
    const params = new URLSearchParams({
      term,
      country: 'BR',
      media: 'music',
      entity,
      limit: '10',
      callback
    });
    script.src = 'https://itunes.apple.com/search?' + params;
    document.head.appendChild(script);
  });
}
function lookupAppleId(collectionId){
  return new Promise((resolve, reject) => {
    if(!/^\d+$/.test(String(collectionId))) return reject(new Error('invalid_collection_id'));
    const callback = '__appleLookup_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    const script = document.createElement('script');
    const cleanup = () => { script.remove(); try { delete window[callback]; } catch {} };
    const timeout = setTimeout(() => { cleanup(); reject(new Error('apple_lookup_timeout')); }, 10000);
    window[callback] = data => {
      clearTimeout(timeout); cleanup();
      resolve(Array.isArray(data?.results) ? data.results : []);
    };
    script.onerror = () => { clearTimeout(timeout); cleanup(); reject(new Error('apple_lookup_load_failed')); };
    const params = new URLSearchParams({ id: String(collectionId), country: 'BR', callback });
    script.src = 'https://itunes.apple.com/lookup?' + params;
    document.head.appendChild(script);
  });
}
async function searchAppleCoverDirect(track){
  const normalize = value => String(value || '').toLowerCase().normalize('NFD')
    .replace(/[\\u0300-\\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const wantedArtist = normalize((track.artists || [])[0]);
  const wantedAlbum = normalize(track.album);
  const wantedTitle = normalize(track.title);
  const artistQuery = (track.artists || [])[0] || '';

  // Search all three catalog entity types. The song verifies the recording;
  // the album search determines the artwork release; the artist search
  // disambiguates artists with similar names.
  const [songResults, albumResults, artistResults] = await Promise.all([
    searchAppleCatalog(track, 'song', [track.title, artistQuery].filter(Boolean).join(' ')),
    searchAppleCatalog(track, 'album', [track.album, artistQuery].filter(Boolean).join(' ')).catch(error => {
      console.warn('[Apple album search failed]', error);
      return [];
    }),
    artistQuery
      ? searchAppleCatalog(track, 'musicArtist', artistQuery).catch(error => {
          console.warn('[Apple artist search failed]', error);
          return [];
        })
      : Promise.resolve([])
  ]);

  const artistMatch = artistResults
    .map(item => {
      const name = normalize(item.artistName);
      let score = 0;
      if (name === wantedArtist) score += 100;
      else if (name && wantedArtist && (name.includes(wantedArtist) || wantedArtist.includes(name))) score += 50;
      return { item, score };
    })
    .sort((a,b) => b.score-a.score)
    .find(entry => entry.score >= 50)?.item || null;
  const matchedArtistId = artistMatch?.artistId || null;

  const songMatch = songResults
    .map(item => {
      const title = normalize(item.trackName);
      const artist = normalize(item.artistName);
      let score = 0;
      if (title === wantedTitle) score += 100;
      else if (title && wantedTitle && (title.includes(wantedTitle) || wantedTitle.includes(title))) score += 40;
      if (wantedArtist && (artist === wantedArtist || artist.includes(wantedArtist) || wantedArtist.includes(artist))) score += 50;
      if (matchedArtistId && item.artistId === matchedArtistId) score += 25;
      return { item, score };
    })
    .sort((a,b) => b.score-a.score)
    .find(entry => entry.score >= 150)?.item || null;

  // Spotify's album field is the release the user is listening to. Match that
  // release directly instead of trusting the song result's collectionId:
  // a song search can legitimately return a single (e.g. "K.O. - Single").
  const albumMatch = albumResults
    .map(item => {
      const artist = normalize(item.artistName);
      const album = normalize(item.collectionName || item.trackName);
      let score = 0;
      if (album === wantedAlbum) score += 100;
      else if (album && wantedAlbum && (album.includes(wantedAlbum) || wantedAlbum.includes(album))) score += 45;
      if (wantedArtist && (artist === wantedArtist || artist.includes(wantedArtist) || wantedArtist.includes(artist))) score += 50;
      if (matchedArtistId && item.artistId === matchedArtistId) score += 25;
      return { item, score };
    })
    .sort((a,b) => b.score-a.score)
    .find(entry => entry.score >= 150)?.item || null;

  // Resolve the selected album's own ID for canonical collection artwork.
  let exactAlbum = null;
  if (albumMatch?.collectionId) {
    try {
      const lookupResults = await lookupAppleId(albumMatch.collectionId);
      exactAlbum = lookupResults.find(item =>
        (item.wrapperType === 'collection' || item.collectionId) &&
        normalize(item.collectionName) === wantedAlbum &&
        (!matchedArtistId || item.artistId === matchedArtistId)
      ) || lookupResults.find(item => item.wrapperType === 'collection') || null;
    } catch(error) {
      console.warn('[Apple album collection lookup failed]', error);
    }
  }

  const best = songMatch || albumMatch;
  if (!best) return null;

  // Prefer the exact Spotify-album match, then its ID lookup, and only then
  // fall back to the song result's artwork.
  const artworkSource = exactAlbum?.artworkUrl100 ? exactAlbum
    : albumMatch?.artworkUrl100 ? albumMatch
    : best;
  if (artworkSource?.artworkUrl100) {
    best.artworkUrlLarge = artworkSource.artworkUrl100.replace(/\d+x\d+(bb)?/i, '3000x3000bb');
  }
  best.albumArtworkSource = exactAlbum?.artworkUrl100 ? 'spotify-album-collection-id'
    : albumMatch?.artworkUrl100 ? 'spotify-album-search'
    : 'song-fallback';
  best.albumArtworkName = exactAlbum?.collectionName || albumMatch?.collectionName || null;
  best.artistLookupName = artistMatch?.artistName || null;
  best.artistLookupId = matchedArtistId;
  best.songCollectionName = songMatch?.collectionName || null;
  best.songCollectionId = songMatch?.collectionId || null;
  best.albumCollectionId = albumMatch?.collectionId || null;
  return best;
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
  originalSpicyEngine?.clear();
  const originalPage=lyricHost.querySelector('.SpicyLyricsPage');
  if(originalPage) originalPage.style.display='none';
  amllPlayer.getElement().style.display='';
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

  // lrc.red lyrics also get a direct link to the matching Apple Music track.
  if(source==='lrc.red' && currentAppleTrack?.trackViewUrl){
    target.append(' · ');
    const appleLink=document.createElement('a');
    appleLink.href=currentAppleTrack.trackViewUrl;
    appleLink.target='_blank'; appleLink.rel='noreferrer';
    appleLink.style.color='#f49ac2';
    appleLink.textContent='View on Apple Music';
    target.append(appleLink);
  }

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
function spicyVocalWords(vocal, fallbackTime=0){
  const syllables=Array.isArray(vocal?.Syllables)?vocal.Syllables.map(s=>({
    text:typeof s.Text==='string'?s.Text:'',
    time:Number.isFinite(s.StartTime)?s.StartTime:null,
    endTime:Number.isFinite(s.EndTime)?s.EndTime:null,
    isPartOfWord:s.IsPartOfWord===true
  })).filter(s=>s.text):[];
  const text=syllables.length
    ? syllables.map((s,i)=>s.text+(!s.isPartOfWord&&i<syllables.length-1?' ':'')).join('')
    : (vocal?.Text||vocal?.TransliteratedText||vocal?.TranslatedText||'');
  const candidateTimes=[vocal?.StartTime,syllables[0]?.time,fallbackTime];
  const time=candidateTimes.find(t=>typeof t==='number'&&Number.isFinite(t));
  return {time:time??0,text,words:syllables};
}
function renderSpicyLyrics(data){
  lyricRendererMode='port';
  currentSpicyLyricsData=data;
  clearLyrics();
  $('lyrics-panel').hidden=false;
  const body=data.spicyLyrics||{};
  const content=Array.isArray(body.Content)?body.Content:[];
  lyricLines=content.flatMap(entry=>{
    const lead=spicyVocalWords(entry?.Lead,entry?.StartTime??body.StartTime??0);
    const lines=[];
    // Spicy Lyrics marks opposite-side duet vocals explicitly. AMLL's
    // isDuet flag applies the opposite/right-side lyric alignment.
    const oppositeAligned=entry?.OppositeAligned===true;
    if(lead.text.trim()) lines.push({...lead,isBG:false,isDuet:oppositeAligned});
    // Spicy Lyrics exposes backing vocals as a separate Background[] array.
    // Keep each backing part as its own AMLL line instead of flattening it
    // into the lead vocal (which loses the background-vocal styling).
    const backgrounds=Array.isArray(entry?.Background)?entry.Background:[];
    for(const vocal of backgrounds){
      const background=spicyVocalWords(vocal,entry?.StartTime??lead.time);
      if(background.text.trim()) lines.push({...background,isBG:true,isDuet:false});
    }
    return lines;
  }).sort((a,b)=>a.time-b.time);
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
  renderSpicyLyricsWithSelectedRenderer();
}
function updateRendererToggle(){
  const button=$('renderer-toggle-button');
  if(!button) return;
  button.disabled=!currentSpicyLyricsData;
  button.textContent=lyricRendererMode==='amll'
    ? "okay let's try ✨ le port ✨"
    : "port's broken we're AMLLing this bitch";
  button.setAttribute('aria-label',button.textContent);
  button.title=currentSpicyLyricsData?'Switch renderer for the current Spicy Lyrics response':'Find Spicy Lyrics first to switch renderers';
}
function renderSpicyLyricsWithSelectedRenderer(){
  if(!currentSpicyLyricsData) return;
  originalSpicyEngine?.clear();
  const originalPage=lyricHost.querySelector('.SpicyLyricsPage');
  if(originalPage) originalPage.style.display='none';
  amllPlayer.setLyricLines([]);
  amllPlayer.setCurrentTime(0,true);
  const amllElement=amllPlayer.getElement();
  if(lyricRendererMode==='port'){
    amllElement.style.display='none';
    try{
      const applied=originalSpicyEngine.apply(currentSpicyLyricsData.spicyLyrics||currentSpicyLyricsData);
      const page=lyricHost.querySelector('.SpicyLyricsPage');
      if(!applied || !page) throw new Error('Original Spicy renderer did not create lyric content.');
      page.style.display='';
      // A newly-created Spicy Lyrics page has no zoom property yet.
      // Re-read the user's saved preference and apply it to every new track.
      lyricsZoom=readLyricsZoom();
      savedLyricsZoom=lyricsZoom;
      applyLyricsZoom();
      applyOriginalAppearance();
      originalSpicyEngine.setPosition(Math.round(currentPlaybackSeconds()*1000));
      $('lyrics-meta').textContent+=' · rendered by ✨ le port ✨';
    }catch(error){
      console.error('[Original Spicy renderer failed]',error);
      $('lyrics-meta').textContent='le port did not worky: '+(error?.message||String(error))+' · switch back to AMLL';
      amllElement.style.display='';
      lyricRendererMode='amll';
      loadIntoAMLL();
    }
  }else{
    amllElement.style.display='';
    loadIntoAMLL();
    $('lyrics-meta').textContent+=' · rendered by AMLL';
  }
  updateRendererToggle();
}
function timeSeconds(value){
  if(!value) return null;
  const input=value.trim();
  if(/^\d+(?:\.\d+)?s$/.test(input)) return Number(input.slice(0,-1));
  const parts=input.split(':');
  if(parts.length===3) return Number(parts[0])*3600+Number(parts[1])*60+Number(parts[2]);
  if(parts.length===2) return Number(parts[0])*60+Number(parts[1]);
  return null;
}
function parseTtml(value){
  const xml=new DOMParser().parseFromString(value,'application/xml');
  if(xml.querySelector('parsererror')) throw new Error('invalid_ttml');
  const ttmNamespace='http://www.w3.org/ns/ttml#metadata';
  const xmlNamespace='http://www.w3.org/XML/1998/namespace';
  const agentIds=Array.from(xml.getElementsByTagNameNS(ttmNamespace,'agent'))
    .map(agent=>agent.getAttributeNS(xmlNamespace,'id')||agent.getAttribute('xml:id'))
    .filter(Boolean);
  const distinctAgents=[...new Set(Array.from(xml.getElementsByTagNameNS('*','p'))
    .map(p=>p.getAttributeNS(ttmNamespace,'agent')||p.getAttribute('ttm:agent'))
    .filter(Boolean))];
  const hasMultipleSingers=distinctAgents.length>1;
  const firstAgent=distinctAgents[0]||agentIds[0]||null;
  const getRole=element=>element.getAttributeNS(ttmNamespace,'role')||element.getAttribute('ttm:role')||'';
  // TTML begin/end values on nested elements are relative to their parent.
  // Accumulate those offsets instead of treating every span timestamp as song time.
  const parseWords=(nodes,parentOffset=0,inheritedSpanTiming=false)=>{
    const words=[];
    for(const node of nodes){
      if(node.nodeType===Node.TEXT_NODE){
        if(node.textContent) words.push({text:node.textContent,time:null,endTime:null});
        continue;
      }
      if(node.nodeType!==Node.ELEMENT_NODE) continue;
      const element=node;
      if(getRole(element)) continue;
      const localBegin=timeSeconds(element.getAttribute('begin'));
      const localEnd=timeSeconds(element.getAttribute('end'));
      const elementStart=parentOffset+(localBegin??0);
      const hasSpanTiming=inheritedSpanTiming||localBegin!==null;
      if(element.localName==='span'){
        const nested=Array.from(element.childNodes).filter(child=>
          !(child.nodeType===Node.ELEMENT_NODE && getRole(child)==='x-bg'));
        if(nested.some(child=>child.nodeType===Node.ELEMENT_NODE)){
          words.push(...parseWords(nested,elementStart,hasSpanTiming));
        }else{
          const text=element.textContent||'';
          if(text) words.push({
            text,
            time:localBegin!==null||inheritedSpanTiming?elementStart:null,
            endTime:localEnd!==null?parentOffset+localEnd:null
          });
        }
      }else{
        words.push(...parseWords(Array.from(element.childNodes),elementStart,hasSpanTiming));
      }
    }
    return words.filter(word=>word.text);
  };
  const parseBackgroundWords=(element,parentOffset=0)=>{
    const words=[];
    const visit=(node,offset=parentOffset,inheritedTiming=false)=>{
      for(const child of Array.from(node.childNodes||[])){
        if(child.nodeType===Node.TEXT_NODE){
          if(child.textContent) words.push({text:child.textContent,time:null,endTime:null});
        }else if(child.nodeType===Node.ELEMENT_NODE){
          const role=getRole(child);
          if(role==='x-translation'||role==='x-roman') continue;
          const localBegin=timeSeconds(child.getAttribute('begin'));
          const localEnd=timeSeconds(child.getAttribute('end'));
          const childStart=offset+(localBegin??0);
          const hasTiming=inheritedTiming||localBegin!==null;
          if(child.localName==='span'){
            const nested=Array.from(child.childNodes).some(n=>n.nodeType===Node.ELEMENT_NODE);
            if(nested) visit(child,childStart,hasTiming);
            else if(child.textContent) words.push({
              text:child.textContent,
              time:localBegin!==null||inheritedTiming?childStart:null,
              endTime:localEnd!==null?offset+localEnd:null
            });
          }else visit(child,childStart,hasTiming);
        }
      }
    };
    const localBegin=timeSeconds(element.getAttribute('begin'));
    visit(element,parentOffset+(localBegin??0),localBegin!==null);
    return words.filter(word=>word.text);
  };
  const parsed=[];
  for(const p of Array.from(xml.getElementsByTagNameNS('*','p'))){
    const ancestorTimes=[];
    for(let ancestor=p.parentElement;ancestor;ancestor=ancestor.parentElement) ancestorTimes.push(timeSeconds(ancestor.getAttribute('begin'))??0);
    const ancestorOffset=ancestorTimes.reverse().reduce((total,value)=>total+value,0);
    const lineTime=ancestorOffset+(timeSeconds(p.getAttribute('begin'))??0);
    const explicitEnd=timeSeconds(p.getAttribute('end'));
    const lineEnd=explicitEnd===null?null:ancestorOffset+explicitEnd;
    const agent=p.getAttributeNS(ttmNamespace,'agent')||p.getAttribute('ttm:agent')||null;
    const isDuet=hasMultipleSingers && !!agent && agent!==firstAgent;
    const directChildren=Array.from(p.childNodes);
    const mainWords=parseWords(directChildren,lineTime);
    const mainText=mainWords.map(word=>word.text).join('').trim();
    if(mainText){
      parsed.push({time:lineTime,endTime:lineEnd,text:mainText,words:mainWords,isBG:false,isDuet});
    }
    const backgrounds=[];
    const collectBackgrounds=node=>{
      for(const child of Array.from(node.childNodes||[])){
        if(child.nodeType!==Node.ELEMENT_NODE) continue;
        if(getRole(child)==='x-bg') backgrounds.push(child);
        else collectBackgrounds(child);
      }
    };
    collectBackgrounds(p);
    for(const background of backgrounds){
      const words=parseBackgroundWords(background,lineTime);
      const text=words.map(word=>word.text).join('').trim();
      if(!text) continue;
      const bgTime=words.find(word=>word.time!==null)?.time??lineTime;
      parsed.push({time:bgTime,endTime:lineEnd,text,words,isBG:true,isDuet:false});
    }
  }
  return parsed.sort((a,b)=>a.time-b.time);
}
function ttmlToSpicyPayload(lines){
  const hasWordTiming=lines.some(line=>line.words.some(word=>Number.isFinite(word.time)));
  const hasLineTiming=lines.some(line=>line.time>0);
  if(!hasWordTiming && !hasLineTiming){
    return {Type:'Static',StartTime:0,Lines:lines.map(line=>({Text:line.text}))};
  }
  if(!hasWordTiming){
    const mainLines=lines.filter(line=>!line.isBG).sort((a,b)=>a.time-b.time);
    const lineEnds=new Map();
    mainLines.forEach((line,index)=>{
      const nextStart=mainLines[index+1]?.time;
      const inferredEnd=Number.isFinite(nextStart)
        ? nextStart
        : Math.max(line.time+3,...line.words.map(word=>Number.isFinite(word.endTime)?word.endTime:0));
      const explicitEnd=Number.isFinite(line.endTime)&&line.endTime>line.time
        ? line.endTime
        : inferredEnd;
      lineEnds.set(line,Number.isFinite(nextStart)
        ? Math.min(explicitEnd,nextStart)
        : explicitEnd);
    });
    const content=lines.map(line=>{
      const nextMain=mainLines.find(main=>main.time>line.time);
      const inferredEnd=nextMain?.time ??
        Math.max(line.time+3,...line.words.map(word=>Number.isFinite(word.endTime)?word.endTime:0));
      const endTime=Number.isFinite(line.endTime)&&line.endTime>line.time
        ? Math.min(line.endTime,inferredEnd)
        : inferredEnd;
      return {
        Text:line.text,
        StartTime:line.time,
        EndTime:Math.max(line.time+0.1,line.isBG?endTime:(lineEnds.get(line)??endTime))
      };
    }).sort((a,b)=>a.StartTime-b.StartTime);
    return {
      Type:'Line',
      StartTime:mainLines[0]?.time||0,
      Content:content
    };
  }

  const mainLines=lines.filter(line=>!line.isBG);
  const backgroundLines=lines.filter(line=>line.isBG);
  const toSyllables=(words,lineStart,lineEnd)=>words.map((word,wordIndex)=>{
    const nextWordStart=words.slice(wordIndex+1).find(next=>Number.isFinite(next.time))?.time;
    const start=Number.isFinite(word.time)?word.time:lineStart;
    const end=Number.isFinite(word.endTime)?word.endTime:
      Number.isFinite(nextWordStart)?nextWordStart:Math.max(start+0.1,lineEnd);
    return {
      Text:word.text,
      StartTime:start,
      EndTime:Math.max(start+0.01,end),
      IsPartOfWord:word.isPartOfWord===true
    };
  });
  const content=mainLines.map((line,index)=>{
    const nextStart=mainLines[index+1]?.time??Infinity;
    const endTime=Math.max(
      line.time+0.1,
      ...line.words.map(word=>Number.isFinite(word.endTime)?word.endTime:0)
    );
    const backgrounds=backgroundLines
      .filter(bg=>bg.time>=line.time && bg.time<nextStart)
      .map(bg=>{
        const bgEnd=Math.max(bg.time+0.1,...bg.words.map(word=>Number.isFinite(word.endTime)?word.endTime:0));
        return {
          StartTime:bg.time,
          EndTime:bgEnd,
          Syllables:toSyllables(bg.words,bg.time,bgEnd)
        };
      });
    return {
      Lead:{
        StartTime:line.time,
        EndTime:endTime,
        Syllables:toSyllables(line.words,line.time,endTime)
      },
      ...(backgrounds.length?{Background:backgrounds}:{}),
      OppositeAligned:line.isDuet===true
    };
  });
  // A background-only TTML passage still needs to be visible. If it could not
  // be attached to a lead line, render it as its own timed lyric line.
  for(const bg of backgroundLines){
    if(content.some(entry=>entry.Background?.some(item=>item.StartTime===bg.time))) continue;
    const endTime=Math.max(bg.time+0.1,...bg.words.map(word=>Number.isFinite(word.endTime)?word.endTime:0));
    content.push({
      Lead:{
        StartTime:bg.time,
        EndTime:endTime,
        Syllables:toSyllables(bg.words,bg.time,endTime)
      }
    });
  }
  content.sort((a,b)=>a.Lead.StartTime-b.Lead.StartTime);
  return {Type:'Syllable',StartTime:content[0]?.Lead.StartTime||0,Content:content};
}
function renderLyrics(data){
  clearLyrics();
  $('lyrics-panel').hidden=false;
  setAttribution('lrc.red');
  lyricLines=parseTtml(data.ttml||'');
  lyricsAreSynced=lyricLines.some(line=>line.words.some(word=>word.time!==null));
  if(!lyricLines.length){
    currentSpicyLyricsData=null;
    updateRendererToggle();
    $('lyrics-meta').textContent='lrc.red returned a TTML file, but it did not contain readable lyric lines.';
    return;
  }
  const spicyPayload=ttmlToSpicyPayload(lyricLines);
  currentSpicyLyricsData={spicyLyrics:spicyPayload,source:'lrc.red'};
  lyricRendererMode='port';
  $('lyrics-meta').textContent=lyricsAreSynced
    ? 'TTML lyrics loaded · word timing preserved.'
    : spicyPayload.Type==='Line'
      ? 'TTML lyrics loaded · line timing.'
      : 'TTML lyrics loaded · static lyrics.';
  updateRendererToggle();
  renderSpicyLyricsWithSelectedRenderer();
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
      isBG:line.isBG===true,
      isDuet:line.isDuet===true
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
let spotifyPlaylists = [];
let queueRefreshInFlight = false;
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
function renderQueueItem(item,current=false){
  const li=document.createElement('li'),button=document.createElement('button');
  button.type='button';button.className='queue-track';button.disabled=!item.uri;
  const image=document.createElement('img');image.alt='';image.src=item.image||'';image.hidden=!item.image;
  const text=document.createElement('span'),title=document.createElement('strong'),subtitle=document.createElement('small');
  title.textContent=(current?'▶ ':'')+item.title;
  subtitle.textContent=(item.artists||[]).join(', ')||item.album||item.type||'some song, probably';
  text.append(title,subtitle);button.append(image,text);
  if(!current&&item.uri)button.addEventListener('click',()=>playQueueItem(item.uri));
  li.append(button);return li;
}
async function loadPlaylists(){
  const select=$('playlist-select'),button=$('play-playlist');
  select.disabled=true;button.disabled=true;select.replaceChildren(new Option('fetching your playlists. hold on…',''));
  try{
    const data=await api('/api/spotify/playlists');spotifyPlaylists=Array.isArray(data.playlists)?data.playlists:[];
    select.replaceChildren();
    if(!spotifyPlaylists.length){select.append(new Option('no playlists. not even one. tragic.',''));$('device-status').textContent='spotify came back empty-handed. how rude.';return;}
    select.append(new Option('pick your poison…',''));
    for(const playlist of spotifyPlaylists)select.append(new Option(playlist.name+' · '+playlist.tracksTotal+' tracks',playlist.uri));
    $('device-status').textContent='found '+spotifyPlaylists.length+' playlists!! go on, pick one.';
  }catch(error){select.replaceChildren(new Option('playlist loading went kaput',''));$('device-status').textContent='could not fetch your playlists. spotify, explain yourself: '+error.message;}
  finally{select.disabled=false;button.disabled=!spotifyPlaylists.length;}
}
async function playSelectedPlaylist(){
  const uri=$('playlist-select').value;if(!uri){$("device-status").textContent="you gotta pick a playlist first. i can't read minds.";return;}
  const button=$('play-playlist');button.disabled=true;$('device-status').textContent='putting your playlist on. one moment…';
  try{
    await api('/api/spotify/player/play',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({context_uri:uri,device_id:selectedDevice()||undefined})});
    $('device-status').textContent='there we go!! playlist time.';await playback();if(!$('queue-panel').hidden)await refreshQueue();
  }catch(error){$('device-status').textContent='that playlist refused to start. rude. ('+error.message+')';}
  finally{button.disabled=!spotifyPlaylists.length;}
}
async function playQueueItem(uri){
  $('queue-status').textContent='OHOHO. skipping straight to that one…';
  try{
    await api('/api/spotify/player/play',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({uris:[uri],device_id:selectedDevice()||undefined})});
    await playback();await refreshQueue();
  }catch(error){$('queue-status').textContent='could not play that song. spotify said no. ('+error.message+')';}
}
async function refreshQueue(){
  if(queueRefreshInFlight)return;queueRefreshInFlight=true;$('queue-status').textContent="asking spotify what's next…";
  try{
    const data=await api('/api/spotify/queue'),list=$('queue-list');list.replaceChildren();
    if(data.current)list.append(renderQueueItem(data.current,true));
    (data.queue||[]).forEach(item=>list.append(renderQueueItem(item,false)));
    $('queue-status').textContent=(data.queue||[]).length+' thing(s) coming up. click one to play it right now!!';
    if(!data.current&&!(data.queue||[]).length)$('queue-status').textContent='nothing in the queue. the future is unwritten.';
  }catch(error){$('queue-status').textContent="the queue wouldn't load. spotify is being difficult: "+error.message;}
  finally{queueRefreshInFlight=false;}
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
    if(!$('queue-panel').hidden)await refreshQueue();
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
    else { say('WE ARE IN'+(data.user?.displayName ? ' as '+data.user.displayName : '')+'!! checking what is playing…'); await loadDevices(); await loadPlaylists(); await playback(); startPolling(); }
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
        loadNowbarMotion(data.track.image || '');
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
  poller=setInterval(playback,2000);
}
function stopPolling(){
  if(poller) clearInterval(poller);
  poller=null;
}

$('appearance-font').addEventListener('change',()=>{appearance.font=$('appearance-font').value;saveAppearance();});
$('appearance-simple').addEventListener('change',()=>{appearance.simple=$('appearance-simple').checked;saveAppearance();});
$('appearance-blur').addEventListener('change',()=>{appearance.blur=$('appearance-blur').checked;saveAppearance();});
$('appearance-animations').addEventListener('change',()=>{appearance.animations=$('appearance-animations').checked;saveAppearance();});
syncAppearanceControls();
$('lyrics-zoom-in').addEventListener('click',()=>changeLyricsZoom(LYRICS_ZOOM_STEP));
$('lyrics-zoom-out').addEventListener('click',()=>changeLyricsZoom(-LYRICS_ZOOM_STEP));
$('lyrics-zoom-save').addEventListener('click',()=>{
  try {
    localStorage.setItem(LYRICS_ZOOM_KEY,String(lyricsZoom));
    savedLyricsZoom=lyricsZoom;
    applyLyricsZoom();
  } catch(error) {
    console.warn('[Lyrics zoom] Could not save preference',error);
    $('lyrics-zoom-save').textContent='could not save. storage said no.';
  }
});
$('renderer-toggle-button').addEventListener('click',()=>{
  if(!currentSpicyLyricsData) return;
  lyricRendererMode=lyricRendererMode==='amll'?'port':'amll';
  renderSpicyLyricsWithSelectedRenderer();
});
updateRendererToggle();
$('connect').onclick=()=>location.href='/auth/login';
$('check').onclick=playback;
$('refresh-devices').onclick=loadDevices;
$('refresh-playlists').onclick=loadPlaylists;
$('play-playlist').onclick=playSelectedPlaylist;
$('queue-refresh').onclick=refreshQueue;
$('queue-toggle').onclick=async()=>{
  const panel=$('queue-panel');panel.hidden=!panel.hidden;
  $('queue-toggle').setAttribute('aria-expanded',String(!panel.hidden));
  $('queue-toggle').textContent=panel.hidden?'show queue':'hide queue';
  if(!panel.hidden)await refreshQueue();
};
$('spotify-device').onchange=()=>{selectedDeviceId=$('spotify-device').value;const device=availableDevices.find(item=>item.id===selectedDeviceId);if(device)$('device-status').textContent='Selected '+device.name+'.';};
$('play-pause').onclick=()=>playerCommand(isPlaying?'pause':'play');
$('previous-track').onclick=async()=>{
  if(currentPlaybackSeconds()>3){
    try{await api('/api/spotify/player/seek',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({position_ms:0,device_id:selectedDevice()||undefined})});latestProgressMs=0;progressObservedAt=Date.now();renderProgress();await playback();}
    catch(error){$('device-status').textContent='could not restart this song: '+error.message;}
  }else playerCommand('previous');
};
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
  if(lyricRendererMode==='port' && originalSpicyEngine){
    const position=Math.round(currentPlaybackSeconds()*1000);
    originalSpicyEngine.setPosition(position);
    setOriginalSpicyLyricsTime(position);
    animateOriginalSpicyLyrics(position);
    QueueForceScroll();
  }
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
