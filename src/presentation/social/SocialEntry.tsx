import {lazy,Suspense,useEffect} from 'react';
import {useBattleStore} from '../store/battleStore';
import {useSocialStore} from './socialStore';
const Notifications=lazy(()=>import('./SocialNotifications').then(m=>({default:m.SocialNotifications})));

/** Starts/stops the social connection with the signed-in account (cloud READY only). */
export function SocialRuntime() {
  const ready = useBattleStore((s) => s.account.status === 'READY');
  const user = useBattleStore((s) => (s.account.status === 'READY' ? s.account.userId : null));
  useEffect(() => {
    if (!ready) return;
    useSocialStore.getState().start();
    return () => useSocialStore.getState().stop();
  }, [ready, user]);
  return null;
}

/** Notification presentation (and its CSS) is needed only when something can be shown. */
export function SocialNotifications(props:{suppressInvites?:boolean;quiet?:boolean}) {
 const present=useSocialStore(s=>s.toasts.length>0||!!s.overview?.invites.incoming.length);
 return present?<Suspense fallback={null}><Notifications {...props}/></Suspense>:null;
}
