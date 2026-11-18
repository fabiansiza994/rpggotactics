/** Proportional corner crops of an existing transparent material, never an aspect-ratio stretch. */
export function ScreenEdgeMaterial(){return <>{['tl','tr','br','bl'].map(corner=><i key={corner} className="screen-material-corner" data-corner={corner}/>)}</>;}
