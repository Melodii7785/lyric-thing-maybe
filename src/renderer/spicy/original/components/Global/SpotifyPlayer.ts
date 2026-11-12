let position = 0; let seekHandler: ((ms: number) => void) | null = null;
export const SpotifyPlayer = { GetPosition: () => position, Seek: (ms: number) => { position = ms; seekHandler?.(ms); }, setPosition: (ms: number) => { position = ms; }, onSeek: (handler: (ms: number) => void) => { seekHandler = handler; } };
