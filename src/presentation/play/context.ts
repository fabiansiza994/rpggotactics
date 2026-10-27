/** Adapt the existing campaign cursor to the canonical profile selection. Stories are temporary. */
export function syncCampaignContext(state:{screen:string;campaignHeroId:string;profile:{selectedChampionId:string};selectCampaignHero(id:string):void;selectWorld(id:string):void},story?:{hero:string;id:string}){
 if(state.screen==='BATTLE')return;
 const id=story?.hero??state.profile.selectedChampionId;
 if(state.campaignHeroId!==id)state.selectCampaignHero(id);
 if(story)state.selectWorld(story.id);
}
