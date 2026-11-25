import {createContext,useContext,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
export type RailSlot='hero'|'preview'|'piles'|'altar'|'enemy'|'map'|'turn'|'pause'|'log'|'end'|'opponent'|'terrain'|'camera'|'header'|'aim';
export const BattleRailContext=createContext<Partial<Record<RailSlot,HTMLElement>>>({});
/** Same live component and state; only presentation placement changes at the desktop breakpoint. */
export function BattleRail({slot,children}:{slot:RailSlot;children:ReactNode}) {
  const target=useContext(BattleRailContext)[slot];
  return target?createPortal(children,target):<>{children}</>;
}
