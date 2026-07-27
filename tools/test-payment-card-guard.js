/*
 * Runs the shipped content.min.js payment-card guard slice and asserts:
 * - typing a card number does not warn by itself
 * - normal HTTPS checkout forms can use unknown off-site processors quietly
 * - suspicious/new checkout pages warn on submit
 * - scam-lure checkout wording warns on submit
 * - phishing/look-alike checkout pages still block card submission
 *
 * Run: node tools/test-payment-card-guard.js
 */
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const MIN = fs.readFileSync('content.min.js', 'utf8');
const START = MIN.indexOf('if(WO.paymentCardGuard)try{const currentHost=');
const END = MIN.indexOf('log("sessionshield_pro_active"', START);
if (START < 0 || END < START) {
  console.error('FATAL: payment-card guard markers not found in content.min.js');
  process.exit(2);
}
const GUARD = MIN.slice(START, END);

function validCard() {
  return '4242 4242 4242 4242';
}

function makeInput(opts = {}) {
  const attrs = opts.attrs || {};
  return {
    tagName: 'INPUT',
    type: opts.type || 'text',
    name: opts.name || '',
    id: opts.id || '',
    autocomplete: opts.autocomplete || '',
    placeholder: opts.placeholder || '',
    value: opts.value || '',
    getAttribute(name) {
      return attrs[name] || '';
    },
  };
}

function makeForm(opts = {}) {
  const attrs = opts.attrs || {};
  return {
    tagName: 'FORM',
    action: opts.action || '',
    id: opts.id || '',
    name: opts.name || '',
    textContent: opts.textContent || '',
    getAttribute(name) {
      return attrs[name] || '';
    },
    requestSubmit() {
      this.__requestSubmitCount = (this.__requestSubmitCount || 0) + 1;
    },
    submit() {
      this.__submitCount = (this.__submitCount || 0) + 1;
    },
  };
}

function makeSandbox(opts = {}) {
  const url = new URL(opts.url || 'https://shop.example/checkout');
  const inputs = opts.inputs || [];
  const forms = opts.forms || [];
  const logs = [];
  const handlers = Object.create(null);
  const confirmCalls = [];
  const alertCalls = [];

  class Element {
    setAttribute() {}
  }
  class HTMLImageElement extends Element {}
  Object.defineProperty(HTMLImageElement.prototype, 'src', {
    configurable: true,
    enumerable: true,
    get() {
      return this.__src || '';
    },
    set(v) {
      this.__src = String(v || '');
    },
  });
  class XMLHttpRequest {
    open(method, target) {
      this.__opened = { method, target };
    }
    send(body) {
      this.__sent = body;
    }
    abort() {
      this.__aborted = true;
    }
  }
  class WebSocket {
    constructor(target) {
      this.url = String(target || '');
    }
    send(data) {
      this.__sent = data;
    }
  }

  const document = {
    title: opts.title || 'Checkout',
    body: opts.bodyText == null ? null : {
      innerText: String(opts.bodyText),
      textContent: String(opts.bodyText),
    },
    forms,
    __handlers: handlers,
    querySelectorAll(selector) {
      if (selector === 'input,textarea') return inputs;
      return [];
    },
    addEventListener(type, fn) {
      (handlers[type] || (handlers[type] = [])).push(fn);
    },
  };

  const sandbox = {
    URL,
    WeakSet,
    Set,
    Array,
    String,
    Number,
    Date,
    RegExp,
    Promise,
    DOMException,
    Element,
    HTMLImageElement,
    XMLHttpRequest,
    WebSocket,
    document,
    navigator: {
      sendBeacon(target, data) {
        sandbox.__beacons.push({ target, data });
        return true;
      },
    },
    location: {
      href: url.href,
      hostname: url.hostname,
      protocol: url.protocol,
      pathname: url.pathname,
      search: url.search,
    },
    WO: Object.assign({ paymentCardGuard: true }, opts.WO || {}),
    log(type, detail) {
      logs.push({ type, detail });
    },
    alert(msg) {
      alertCalls.push(String(msg));
    },
    confirm(msg) {
      confirmCalls.push(String(msg));
      return opts.confirmResult !== false;
    },
    fetch(target, init) {
      sandbox.__fetches.push({ target, init });
      return Promise.resolve({ ok: true });
    },
    __logs: logs,
    __confirmCalls: confirmCalls,
    __alertCalls: alertCalls,
    __fetches: [],
    __beacons: [],
    __safeBrowsingCalls: [],
    __timers: [],
    setTimeout(fn) {
      sandbox.__timers.push(fn);
      return sandbox.__timers.length;
    },
  };
  if (opts.reputationResult) {
    sandbox.urlReputationOn = () => true;
    sandbox.safeBrowsingCheck = (target, context, timeoutMs) => {
      sandbox.__safeBrowsingCalls.push({ target, context, timeoutMs });
      return Promise.resolve(Object.assign({ ok: true, enabled: true }, opts.reputationResult));
    };
  }
  sandbox.window = sandbox;
  sandbox.top = sandbox;
  return sandbox;
}

function installGuard(sandbox) {
  const code = `
    (() => {
      const dataToString = data => {
        try {
          if (data == null) return "";
          if (typeof data === "string") return data;
          if (typeof URLSearchParams !== "undefined" && data instanceof URLSearchParams) return data.toString();
          if (Array.isArray(data)) return data.map(p => Array.isArray(p) ? p.join("=") : String(p)).join("&");
          if (typeof data === "object") return JSON.stringify(data);
          return data && data.toString ? data.toString() : "";
        } catch (_) {
          return "";
        }
      };
      const hayHasEncoded = () => false;
      ${GUARD}
    })();
  `;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'payment-card-guard-slice.js' });
  return sandbox;
}

function trigger(sandbox, type, target) {
  const event = {
    target,
    prevented: false,
    stopped: false,
    preventDefault() {
      this.prevented = true;
    },
    stopImmediatePropagation() {
      this.stopped = true;
    },
  };
  for (const handler of sandbox.document.__handlers[type] || []) handler(event);
  return event;
}

function hasLog(sandbox, type) {
  return sandbox.__logs.some((entry) => entry.type === type);
}

function check(name, fn) {
  try {
    fn();
    console.log('  ok  - ' + name);
    check.pass++;
  } catch (e) {
    console.error('FAIL - ' + name);
    console.error(e && e.stack || e);
    check.fail++;
  }
}
check.pass = 0;
check.fail = 0;

async function checkAsync(name, fn) {
  try {
    await fn();
    console.log('  ok  - ' + name);
    check.pass++;
  } catch (e) {
    console.error('FAIL - ' + name);
    console.error(e && e.stack || e);
    check.fail++;
  }
}

function finish() {
  if (check.fail) {
    console.error('\n' + check.pass + ' passed, ' + check.fail + ' failed');
    process.exit(1);
  }
  console.log('\n' + check.pass + ' passed, 0 failed');
}

check('typing a card value does not warn by itself', () => {
  const field = makeInput({ autocomplete: 'cc-number', value: validCard() });
  const form = makeForm({ action: 'https://shop.example/pay' });
  const s = installGuard(makeSandbox({ inputs: [field], forms: [form] }));
  trigger(s, 'input', field);
  assert.strictEqual(hasLog(s, 'warned_payment_card_entry'), false);
  assert.strictEqual(s.__confirmCalls.length, 0);
});

check('normal HTTPS checkout can submit to an unknown off-site processor quietly', () => {
  const field = makeInput({ autocomplete: 'cc-number', value: validCard() });
  const form = makeForm({ action: 'https://processor.example/charge', textContent: 'Pay now' });
  const s = installGuard(makeSandbox({
    url: 'https://shop.example/checkout',
    inputs: [field],
    forms: [form],
  }));
  const event = trigger(s, 'submit', form);
  assert.strictEqual(event.prevented, false);
  assert.strictEqual(hasLog(s, 'warned_payment_card_entry'), false);
  assert.strictEqual(hasLog(s, 'blocked_payment_card_submit'), false);
  assert.strictEqual(s.__confirmCalls.length, 0);
});

check('suspicious or new checkout warns on submit instead of firing everywhere', () => {
  const field = makeInput({ autocomplete: 'cc-number', value: validCard() });
  const form = makeForm({ action: 'https://secure-pay-deal.xyz/checkout', textContent: 'Payment' });
  const s = installGuard(makeSandbox({
    url: 'https://secure-pay-deal.xyz/checkout',
    inputs: [field],
    forms: [form],
    WO: { __pageRisk: { newDomain: true } },
  }));
  const event = trigger(s, 'submit', form);
  assert.strictEqual(event.prevented, false);
  assert.strictEqual(hasLog(s, 'warned_payment_card_entry'), true);
  assert.strictEqual(hasLog(s, 'blocked_payment_card_submit'), false);
  assert.strictEqual(s.__confirmCalls.length, 1);
});

check('common payment scam wording warns on submit', () => {
  const field = makeInput({ autocomplete: 'cc-number', value: validCard() });
  const form = makeForm({ action: 'https://promo.example/pay', textContent: 'Claim your reward. Pay the refundable verification fee by card.' });
  const s = installGuard(makeSandbox({
    url: 'https://promo.example/pay',
    title: 'Claim reward',
    bodyText: 'Winner reward claim. Pay the refundable verification fee by card to release your prize.',
    inputs: [field],
    forms: [form],
  }));
  const event = trigger(s, 'submit', form);
  assert.strictEqual(event.prevented, false);
  assert.strictEqual(hasLog(s, 'warned_payment_card_entry'), true);
  assert.strictEqual(hasLog(s, 'blocked_payment_card_submit'), false);
  assert.strictEqual(s.__confirmCalls.length, 1);
});

check('single delivery-fee wording on an established checkout stays quiet', () => {
  const field = makeInput({ autocomplete: 'cc-number', value: validCard() });
  const form = makeForm({ action: 'https://delivery.example/redelivery', textContent: 'Pay the redelivery fee by card.' });
  const s = installGuard(makeSandbox({
    url: 'https://delivery.example/redelivery',
    title: 'Redelivery payment',
    bodyText: 'Your parcel redelivery is ready. Pay the delivery fee by card.',
    inputs: [field],
    forms: [form],
  }));
  const event = trigger(s, 'submit', form);
  assert.strictEqual(event.prevented, false);
  assert.strictEqual(hasLog(s, 'warned_payment_card_entry'), false);
  assert.strictEqual(hasLog(s, 'blocked_payment_card_submit'), false);
});

check('young domain alone stays quiet until another payment risk appears', () => {
  const field = makeInput({ autocomplete: 'cc-number', value: validCard() });
  const form = makeForm({ action: 'https://shop.example/checkout', textContent: 'Checkout' });
  const s = installGuard(makeSandbox({
    url: 'https://shop.example/checkout',
    inputs: [field],
    forms: [form],
    WO: { __pageRisk: { youngDomain: true } },
  }));
  const event = trigger(s, 'submit', form);
  assert.strictEqual(event.prevented, false);
  assert.strictEqual(hasLog(s, 'warned_payment_card_entry'), false);
  assert.strictEqual(hasLog(s, 'blocked_payment_card_submit'), false);
});

check('phishing checkout still blocks card submission', () => {
  const field = makeInput({ autocomplete: 'cc-number', value: validCard() });
  const form = makeForm({ action: 'https://paypa1-login.example/checkout', textContent: 'Payment' });
  const s = installGuard(makeSandbox({
    url: 'https://paypa1-login.example/checkout',
    inputs: [field],
    forms: [form],
    WO: { __pageRisk: { phishing: true, brand: 'paypal' } },
  }));
  const event = trigger(s, 'submit', form);
  assert.strictEqual(event.prevented, true);
  assert.strictEqual(hasLog(s, 'blocked_payment_card_submit'), true);
  assert.strictEqual(s.__alertCalls.length, 1);
});

check('non-payment page with a Luhn-looking number stays silent', () => {
  const field = makeInput({ name: 'reference', value: validCard() });
  const form = makeForm({ action: 'https://example.com/profile', textContent: 'Save profile' });
  const s = installGuard(makeSandbox({
    url: 'https://example.com/profile',
    title: 'Profile',
    inputs: [field],
    forms: [form],
  }));
  const event = trigger(s, 'submit', form);
  assert.strictEqual(event.prevented, false);
  assert.strictEqual(hasLog(s, 'warned_payment_card_entry'), false);
  assert.strictEqual(hasLog(s, 'blocked_payment_card_submit'), false);
});

check('a new/young domain on a clean host no longer warns by itself', () => {
  // A legitimate but recently-registered store using an off-site processor, with no
  // scam-domain / scam-wording / reputation signal, must stay silent. Soft signals
  // (new domain, unknown off-site processor) are no longer enough to flag on their own.
  const field = makeInput({ autocomplete: 'cc-number', value: validCard() });
  const form = makeForm({ action: 'https://processor.example/charge', textContent: 'Pay now' });
  const s = installGuard(makeSandbox({
    url: 'https://newstore.example/checkout',
    inputs: [field],
    forms: [form],
    WO: { __pageRisk: { newDomain: true } },
  }));
  const event = trigger(s, 'submit', form);
  assert.strictEqual(event.prevented, false);
  assert.strictEqual(hasLog(s, 'warned_payment_card_entry'), false);
  assert.strictEqual(hasLog(s, 'blocked_payment_card_submit'), false);
  assert.strictEqual(s.__confirmCalls.length, 0);
});

check('a Luhn value in a non-card field never counts as a payment screen (even on a scam-looking host)', () => {
  // An order/reference number that happens to be Luhn-valid, in a field with no card hint,
  // must NOT be treated as card entry -- so a normal page never flags, even if the host
  // pattern looks scammy. This is the "only on the actual payment screen" guarantee.
  const field = makeInput({ name: 'order_ref', value: validCard() });
  const form = makeForm({ action: 'https://secure-pay-deal.xyz/save', textContent: 'Save order' });
  const s = installGuard(makeSandbox({
    url: 'https://secure-pay-deal.xyz/orders',
    title: 'My orders',
    inputs: [field],
    forms: [form],
  }));
  const event = trigger(s, 'submit', form);
  assert.strictEqual(event.prevented, false);
  assert.strictEqual(hasLog(s, 'warned_payment_card_entry'), false);
  assert.strictEqual(hasLog(s, 'blocked_payment_card_submit'), false);
  assert.strictEqual(s.__confirmCalls.length, 0);
});

check('streaming page with periodic beacons never fires the card guard (ITV/BBC report)', () => {
  // A media page like itv.com/bbc iPlayer while watching a video: no card entry field at all,
  // just a search box, but a video player emits analytics/heartbeat traffic every few seconds
  // whose ids can be Luhn-valid 16-digit numbers. This must never surface a card dialog.
  const s = installGuard(makeSandbox({
    url: 'https://www.itv.com/watch/itv1/some-series',
    title: 'ITVX',
    bodyText: 'Watch live and on demand. In order to subscribe, pay monthly for Premium. Add to My List. Continue your order and checkout later.',
    inputs: [makeInput({ type: 'search', name: 'q', placeholder: 'Search shows' })],
    forms: [makeForm({ action: 'https://www.itv.com/search', textContent: 'Search' })],
    // Reputation available and even hostile: proves we short-circuit before any reputation lookup.
    reputationResult: { hit: true, warning: true, provider: 'Unit reputation', threats: ['SOCIAL_ENGINEERING'] },
  }));
  const okBeacon = s.navigator.sendBeacon('https://analytics.example/collect', 'e=heartbeat&sid=' + validCard());
  s.fetch('https://analytics.example/collect', { body: 'ping=' + validCard() + '&pos=42' });
  const xhr = new s.XMLHttpRequest();
  xhr.open('POST', 'https://analytics.example/collect');
  xhr.send('t=' + validCard());
  assert.strictEqual(okBeacon, true);
  assert.strictEqual(s.__beacons.length, 1);
  assert.strictEqual(s.__fetches.length, 1);
  assert.strictEqual(xhr.__sent !== undefined, true);
  assert.strictEqual(xhr.__aborted, undefined);
  assert.strictEqual(s.__safeBrowsingCalls.length, 0);
  assert.strictEqual(s.__confirmCalls.length, 0);
  assert.strictEqual(s.__alertCalls.length, 0);
  assert.strictEqual(hasLog(s, 'warned_payment_card_entry'), false);
  assert.strictEqual(hasLog(s, 'blocked_payment_card_submit'), false);
});

check('analytics traffic on a real checkout does not fire unless it carries the entered card', () => {
  const field = makeInput({ autocomplete: 'cc-number', value: validCard() });
  const s = installGuard(makeSandbox({
    url: 'https://shop.example/checkout',
    title: 'Checkout',
    inputs: [field],
    forms: [makeForm({ action: 'https://shop.example/pay', textContent: 'Pay now' })],
    reputationResult: { hit: true, warning: true, provider: 'Unit reputation', threats: ['SOCIAL_ENGINEERING'] },
  }));
  // A different Luhn-valid number in analytics (not the shopper's card) must be ignored: the old
  // guard matched any card-shaped number and fired; the new guard only reacts to the entered card.
  s.navigator.sendBeacon('https://metrics.example/collect', 'pv=1&aid=4111111111111111');
  s.fetch('https://metrics.example/collect', { body: 'session=abc&exp=4111111111111111' });
  assert.strictEqual(s.__beacons.length, 1);
  assert.strictEqual(s.__fetches.length, 1);
  assert.strictEqual(s.__safeBrowsingCalls.length, 0);
  assert.strictEqual(s.__confirmCalls.length, 0);
  assert.strictEqual(hasLog(s, 'warned_payment_card_entry'), false);
  assert.strictEqual(hasLog(s, 'blocked_payment_card_submit'), false);
});

(async () => {
  await checkAsync('clean reputation check silently continues normal unknown processor checkout', async () => {
    const field = makeInput({ autocomplete: 'cc-number', value: validCard() });
    const form = makeForm({ action: 'https://processor.example/charge', textContent: 'Payment' });
    const s = installGuard(makeSandbox({
      url: 'https://shop.example/checkout',
      inputs: [field],
      forms: [form],
      reputationResult: {
        hit: false,
        warning: false,
        provider: 'Unit reputation',
      },
    }));
    const event = trigger(s, 'submit', form);
    assert.strictEqual(event.prevented, true);
    await Promise.resolve();
    await Promise.resolve();
    assert.strictEqual(hasLog(s, 'warned_payment_card_entry'), false);
    assert.strictEqual(hasLog(s, 'blocked_payment_card_submit'), false);
    assert.strictEqual(s.__confirmCalls.length, 0);
    assert.strictEqual(form.__requestSubmitCount || 0, 1);
    assert.strictEqual(s.__safeBrowsingCalls.length, 2);
  });

  await checkAsync('remote payment processor hint skips unnecessary reputation lookup', async () => {
    const field = makeInput({ autocomplete: 'cc-number', value: validCard() });
    const form = makeForm({ action: 'https://processor.example/charge', textContent: 'Payment' });
    const s = installGuard(makeSandbox({
      url: 'https://shop.example/checkout',
      inputs: [field],
      forms: [form],
      WO: { trustedPaymentHostsExtra: ['processor.example'] },
      reputationResult: {
        hit: false,
        warning: false,
        provider: 'Unit reputation',
      },
    }));
    const event = trigger(s, 'submit', form);
    assert.strictEqual(event.prevented, false);
    await Promise.resolve();
    assert.strictEqual(hasLog(s, 'warned_payment_card_entry'), false);
    assert.strictEqual(hasLog(s, 'blocked_payment_card_submit'), false);
    assert.strictEqual(s.__confirmCalls.length, 0);
    assert.strictEqual(s.__safeBrowsingCalls.length, 0);
  });

  await checkAsync('remote payment processor hint cannot override phishing block', async () => {
    const field = makeInput({ autocomplete: 'cc-number', value: validCard() });
    const form = makeForm({ action: 'https://processor.example/charge', textContent: 'Payment' });
    const s = installGuard(makeSandbox({
      url: 'https://shop.example/checkout',
      inputs: [field],
      forms: [form],
      WO: {
        trustedPaymentHostsExtra: ['processor.example'],
        __pageRisk: { phishing: true, brand: 'paypal' },
      },
      reputationResult: {
        hit: false,
        warning: false,
        provider: 'Unit reputation',
      },
    }));
    const event = trigger(s, 'submit', form);
    assert.strictEqual(event.prevented, true);
    assert.strictEqual(hasLog(s, 'blocked_payment_card_submit'), true);
    assert.strictEqual(s.__safeBrowsingCalls.length, 0);
  });

  await checkAsync('reputation hit blocks a polished unknown payment destination', async () => {
    const field = makeInput({ autocomplete: 'cc-number', value: validCard() });
    const form = makeForm({ action: 'https://processor.example/charge', textContent: 'Payment' });
    const s = installGuard(makeSandbox({
      url: 'https://shop.example/checkout',
      inputs: [field],
      forms: [form],
      reputationResult: {
        hit: true,
        warning: true,
        provider: 'Unit reputation',
        threats: ['SOCIAL_ENGINEERING'],
      },
    }));
    const event = trigger(s, 'submit', form);
    assert.strictEqual(event.prevented, true);
    await Promise.resolve();
    await Promise.resolve();
    assert.strictEqual(hasLog(s, 'blocked_payment_card_submit'), true);
    assert.strictEqual(s.__alertCalls.length, 1);
    assert.strictEqual(form.__requestSubmitCount || 0, 0);
    assert.strictEqual(s.__safeBrowsingCalls.length, 2);
  });

  await checkAsync('warn-level fetch card send asks before network and blocks when declined', async () => {
    const field = makeInput({ autocomplete: 'cc-number', value: validCard() });
    const s = installGuard(makeSandbox({
      url: 'https://secure-pay-deal.xyz/checkout',
      title: 'Payment',
      bodyText: 'Payment card checkout',
      inputs: [field],
      WO: { __pageRisk: { newDomain: true } },
      confirmResult: false,
    }));
    await assert.rejects(
      s.fetch('https://secure-pay-deal.xyz/charge', { body: 'card=' + validCard() }),
      /Blocked by WardenOne Payment Card Guard/
    );
    assert.strictEqual(hasLog(s, 'warned_payment_card_entry'), true);
    assert.strictEqual(s.__confirmCalls.length, 1);
    assert.strictEqual(s.__fetches.length, 0);
  });

  await checkAsync('fetch card send uses reputation before network and blocks hits', async () => {
    const field = makeInput({ autocomplete: 'cc-number', value: validCard() });
    const s = installGuard(makeSandbox({
      url: 'https://shop.example/checkout',
      title: 'Payment',
      bodyText: 'Payment card checkout',
      inputs: [field],
      reputationResult: {
        hit: true,
        warning: true,
        provider: 'Unit reputation',
        threats: ['SOCIAL_ENGINEERING'],
      },
    }));
    await assert.rejects(
      s.fetch('https://processor.example/charge', { body: 'card=' + validCard() }),
      /Blocked by WardenOne Payment Card Guard/
    );
    assert.strictEqual(hasLog(s, 'blocked_payment_card_submit'), true);
    assert.strictEqual(s.__fetches.length, 0);
    assert.strictEqual(s.__safeBrowsingCalls.length, 2);
  });

  await checkAsync('warn-level XHR card send asks before send and aborts when declined', async () => {
    const field = makeInput({ autocomplete: 'cc-number', value: validCard() });
    const s = installGuard(makeSandbox({
      url: 'https://secure-pay-deal.xyz/checkout',
      title: 'Payment',
      bodyText: 'Payment card checkout',
      inputs: [field],
      WO: { __pageRisk: { newDomain: true } },
      confirmResult: false,
    }));
    const xhr = new s.XMLHttpRequest();
    xhr.open('POST', 'https://secure-pay-deal.xyz/charge');
    xhr.send('card=' + validCard());
    assert.strictEqual(hasLog(s, 'warned_payment_card_entry'), true);
    assert.strictEqual(s.__confirmCalls.length, 1);
    assert.strictEqual(xhr.__aborted, true);
    assert.strictEqual(xhr.__sent, undefined);
  });
  finish();
})();
