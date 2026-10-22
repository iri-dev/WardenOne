/* WardenOne — Copyright (C) 2026 iri · GNU GPL v3 or later, see LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
'use strict';

const WONetworkPolicy = (() => {
  const automaticExceptionMax = 1999;
  const securityMin = 2000;
  const explicitOwners = Object.freeze([
    { store: 'dynamic', base: 750000, size: 500, max: 98000, name: 'userFilter' },
    { store: 'dynamic', base: 720000, size: 1000, max: 2600, name: 'trackerSiteControl' },
    { store: 'dynamic', base: 950000, size: 250, max: 97001, name: 'firewall' },
    { store: 'session', base: 960000, size: 50, max: 97003, name: 'firewallOnce' },
    { store: 'session', base: 800000, size: 1000, max: 100000, name: 'sitePause' },
  ].map(Object.freeze));

  function validate(change, store) {
    if (!['dynamic', 'session', 'static'].includes(store)) throw new Error('Unknown DNR rule store');
    for (const rule of change.addRules || []) {
      const action = rule.action && rule.action.type;
      if (action !== 'allow' && action !== 'allowAllRequests') continue;
      const owner = explicitOwners.find(entry => entry.store === store && rule.id >= entry.base && rule.id < entry.base + entry.size);
      const priority = rule.priority === undefined ? 1 : rule.priority;
      if (!Number.isSafeInteger(priority) || priority < 1 || priority > (owner ? owner.max : automaticExceptionMax)) {
        throw new Error('DNR exception exceeds its authority: ' + rule.id);
      }
      if (action === 'allowAllRequests') {
        const condition = rule.condition || {};
        const anchored = /^\|\|([a-z0-9.-]+)(?:\^|\/|$)/i.exec(condition.urlFilter || '');
        const hosts = condition.requestDomains || (anchored ? [anchored[1]] : []);
        if ((owner && owner.name !== 'sitePause') || !hosts.length
            || !condition.resourceTypes?.length || condition.resourceTypes.some(type => type !== 'main_frame' && type !== 'sub_frame')
            || hosts.some(host => normalizeSiteHost(host) !== host)) {
          throw new Error('Unbounded DNR document exception: ' + rule.id);
        }
      }
    }
    return change;
  }

  return Object.freeze({ automaticExceptionMax, securityMin, explicitOwners, validate });
})();
