import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {CLOUD_CONFIG} from '../cloud/config';
import {mountTurnstile,verificationMessage,type VerificationState} from './turnstile';

export function TurnstileWidget({onToken,action,siteKey}:{onToken(token:string|null):void;action?:string;siteKey?:string}) {
  const container = useRef<HTMLDivElement>(null);
  const latestToken = useRef(onToken);
  const [state,setState] = useState<VerificationState>({kind:'loading'});
  const [attempt,setAttempt] = useState(0);
  // Callback identity changes must not destroy a valid widget/token while fields are typed.
  useLayoutEffect(() => { latestToken.current = onToken; },[onToken]);
  useEffect(() => {
    if (!container.current) return;
    return mountTurnstile(container.current,{
      siteKey:siteKey ?? CLOUD_CONFIG.turnstileSiteKey,
      action,
      onToken:token => latestToken.current(token),
      onState:setState,
    });
  },[attempt,action,siteKey]);
  const message = verificationMessage(state);
  return <div className="turnstile-slot" data-verification-state={state.kind} data-verification-code={state.kind==='challenge-error'?state.code:undefined}>
    <div ref={container}/>
    {state.kind==='loading'&&<p role="status">Conectando con la verificación de seguridad…</p>}
    {message&&<><p className="account-error" role="alert">{message}</p><button type="button" onClick={()=>{latestToken.current(null);setState({kind:'loading'});setAttempt(n=>n+1);}}>Reintentar verificación</button></>}
  </div>;
}
