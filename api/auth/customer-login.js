import crypto from 'node:crypto';
import { createSession, sessionCookie } from '../../lib/auth.js';

function equal(left,right){const a=Buffer.from(left||''),b=Buffer.from(right||'');return a.length===b.length&&crypto.timingSafeEqual(a,b);}
export default function handler(request,response){
  if(request.method!=='POST')return response.status(405).json({error:'Methode nicht erlaubt.'});
  const username=process.env.CUSTOMER_USERNAME,password=process.env.CUSTOMER_PASSWORD;
  if(!username||!password||!process.env.AUTH_SECRET)return response.status(503).json({error:'Der Kunden-Login ist noch nicht konfiguriert.'});
  if(!equal(request.body?.username,username)||!equal(request.body?.password,password))return response.status(401).json({error:'Zugangsdaten sind nicht korrekt.'});
  response.setHeader('Set-Cookie',sessionCookie(createSession(username,'participant')));
  return response.status(200).json({ok:true,user:{username,role:'participant'}});
}
