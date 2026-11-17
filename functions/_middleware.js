// Preserve legacy files and browser data without exposing retired screens.
export async function onRequest(context){
 const path=new URL(context.request.url).pathname;
 if(/^\/(?:legacy(?:\.html)?|(?:pet-)?video-studio(?:\.html)?)(?:\/|$)/.test(path))return Response.redirect(new URL('/',context.request.url),302);
 return context.next();
}
