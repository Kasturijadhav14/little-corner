const API = import.meta.env.VITE_API_URL || '';
export function token(){ return localStorage.getItem('ak_token'); }
export async function api(path, options={}) {
  const headers = new Headers(options.headers || {});
  const t=token();
  if(t) headers.set('Authorization',`Bearer ${t}`);
  if(!(options.body instanceof FormData) && options.body && !headers.has('Content-Type')) headers.set('Content-Type','application/json');
  const res=await fetch(`${API}/api${path}`,{...options,headers});
  const data=await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.message||'Request failed');
  return data;
}
export const mediaUrl=(stored)=>`${API}/uploads/${stored}`;
