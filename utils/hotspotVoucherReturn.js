function allowedHotspotHosts(settings = {}, routerHosts = []) {
  const configured = settings.hotspot_login_hosts;
  const extraHosts = Array.isArray(configured) ? configured : String(configured || '').split(',');
  return new Set([
    settings.mikrotik_host,
    ...routerHosts,
    ...extraHosts
  ].map((host) => String(host || '').trim().toLowerCase()).filter(Boolean));
}

function validateHotspotLoginUrl(value, settings = {}, routerHosts = []) {
  if (typeof value !== 'string' || value.length > 512) return '';
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    if (url.username || url.password || url.search || url.hash) return '';
    if (url.pathname !== '/login') return '';
    if (url.port && !['80', '443'].includes(url.port)) return '';
    if (!allowedHotspotHosts(settings, routerHosts).has(url.hostname.toLowerCase())) return '';
    return url.origin + url.pathname;
  } catch {
    return '';
  }
}

function resolveHotspotContext(value, settings = {}, routers = []) {
  const loginUrl = validateHotspotLoginUrl(value, settings, routers.map((router) => router.host));
  if (!loginUrl) return null;

  const host = new URL(loginUrl).hostname.toLowerCase();
  const matchedRouter = routers.find((router) => String(router.host || '').trim().toLowerCase() === host);
  if (matchedRouter) return { loginUrl, routerId: matchedRouter.id };

  if (routers.length === 1) return { loginUrl, routerId: routers[0].id };
  if (routers.length === 0 && String(settings.mikrotik_host || '').trim().toLowerCase() === host) {
    return { loginUrl, routerId: null };
  }
  return null;
}

module.exports = { validateHotspotLoginUrl, resolveHotspotContext };
