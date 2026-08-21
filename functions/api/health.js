export function onRequest({ request }) {
  return new Response(JSON.stringify({
    ok: true,
    app: 'PMG Vehicle Intake',
    route: '/api/health',
    method: request.method,
    message: 'PMG Vehicle Intake Pages Functions are running.'
  }), {
    status: 200,
    headers: {'Content-Type':'application/json','Cache-Control':'no-store'}
  });
}
