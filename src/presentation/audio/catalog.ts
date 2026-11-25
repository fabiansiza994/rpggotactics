export const AUDIO_CUES = {
 ui_confirm:{category:'ui',duration:.38,gain:.64,limit:2,priority:1},
 ui_cancel:{category:'ui',duration:.32,gain:.52,limit:2,priority:1},
 card_hover:{category:'cards',duration:.14,gain:.32,limit:1,priority:0},
 ranked_search_loop:{category:'matchmaking',duration:10,gain:.48,limit:1,priority:0},
 ranked_match_found:{category:'matchmaking',duration:2.6,gain:.85,limit:1,priority:3},
 card_activate:{category:'combat',duration:.72,gain:.64,limit:3,priority:2},
} as const;
export type AudioCue=keyof typeof AUDIO_CUES;
export type AudioCategory='master'|'ui'|'cards'|'matchmaking'|'combat'|'music';
export type AudioVariant='A'|'B'|'C';
export const AUDIO_DIRECTIONS={A:'Arcana ancestral',B:'Fantasía heroica cinematográfica',C:'Fantasía oscura profunda'};
export function audioFiles(cue:AudioCue,variant:AudioVariant){const root=`/audio/arcane-v1/${cue}_${variant}`;return cue==='ranked_search_loop'?[root+'.wav']:[root+'.m4a',root+'.wav'];}
