// Provider list for the Usage page.
//
// Two sources, deduped by provider id:
//   1. Active LLM connections (one entry per provider).
//   2. noAuth free providers that need no connection (e.g. opencode).
//
// Hidden providers are excluded — the Providers page filters `hidden`, so a
// hidden noAuth provider (devin-cli, mimo-free) must not leak into Usage with
// zero connections and zero traffic.
export function buildUsageProviderList({
  connections = [],
  freeProviders = {},
  nodeNameMap = {},
  isLLMProvider = () => true,
} = {}) {
  const seen = new Set();
  const unique = connections
    .filter((c) => {
      if (c.isActive === false) return false;
      if (!isLLMProvider(c.provider)) return false;
      if (seen.has(c.provider)) return false;
      seen.add(c.provider);
      return true;
    })
    .map((c) => ({
      ...c,
      nodeName: nodeNameMap[c.provider] || null,
    }));

  const noAuthProviders = Object.values(freeProviders)
    .filter((p) => p.noAuth && !p.hidden && !seen.has(p.id) && isLLMProvider(p.id))
    .map((p) => ({ provider: p.id, name: p.name }));

  return [...unique, ...noAuthProviders];
}
