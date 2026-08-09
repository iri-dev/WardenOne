/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // ---- stepper state -------------------------------------------------------
  const STEPS = ['welcome', 'pin', 'protect', 'explore'];
  const scenes = {};
  document.querySelectorAll('.scene').forEach((el) => { scenes[el.dataset.scene] = el; });

  const dots = Array.from(document.querySelectorAll('.dot'));
  const backBtn = $('back');
  const nextBtn = $('next');
  const footNote = $('foot-note');
  const status = $('status');
  const coverFrame = document.querySelector('.cover-frame');
  const coverWrap = document.querySelector('.cover-wrap');
  let index = 0;
  let phase = 'wizard'; // 'wizard' | 'done' | 'closed'

  // show the top/bottom fades only when there's more to scroll in that direction
  function updateCoverFades() {
    if (!coverFrame || !coverWrap) return;
    const moreAbove = coverWrap.scrollTop > 2;
    const moreBelow = coverWrap.scrollTop + coverWrap.clientHeight < coverWrap.scrollHeight - 2;
    coverFrame.classList.toggle('has-top', moreAbove);
    coverFrame.classList.toggle('has-bottom', moreBelow);
  }

  const FOOT = {
    welcome: 'Takes about a minute. You can change anything later.',
    pin: 'Pinning is optional, but it keeps WardenOne one click away.',
    protect: 'Recommended is the safe default. Tweak any switch later from the popup.',
    explore: 'That\'s everything. Hit Finish whenever you\'re ready.',
    done: 'One last step — then you\'re free to go.',
    closed: 'Setup complete. It\'s safe to close this tab.',
  };

  function showScene(name) {
    Object.keys(scenes).forEach((key) => {
      const on = key === name;
      scenes[key].hidden = !on;
      scenes[key].classList.toggle('enter', on);
    });
    const scene = scenes[name];
    if (scene) { try { scene.focus({ preventScroll: true }); } catch (_) { try { scene.focus(); } catch (__) {} } }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Set the footer buttons in one place so they can never be left half-updated.
  function setFooter(opts) {
    backBtn.hidden = !opts.back;
    if (!opts.next) {
      nextBtn.hidden = true;
      return;
    }
    nextBtn.hidden = false;
    nextBtn.disabled = false;
    nextBtn.textContent = '';
    nextBtn.appendChild(document.createTextNode(opts.next.label || ''));
    if (opts.next.arrow) {
      const arrow = document.createElement('span');
      arrow.className = 'ar';
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = '\u2192';
      nextBtn.appendChild(arrow);
    }
    nextBtn.classList.toggle('done', !!opts.next.done);
  }

  function render() {
    phase = 'wizard';
    const name = STEPS[index];
    document.body.dataset.step = name;
    showScene(name);

    dots.forEach((d, i) => {
      d.classList.toggle('active', i === index);
      d.classList.toggle('done', i < index);
      d.setAttribute('aria-selected', i === index ? 'true' : 'false');
    });

    const last = index === STEPS.length - 1;
    setFooter({
      back: index > 0,
      next: { label: last ? 'Finish setup' : 'Next', arrow: !last, done: last },
    });
    if (footNote) footNote.textContent = FOOT[name] || '';
    updateCoverFades();
  }

  function showDone() {
    phase = 'done';
    document.body.dataset.step = 'done';
    showScene('done');
    dots.forEach((d) => { d.classList.add('done'); d.classList.remove('active'); });
    setFooter({ back: true, next: { label: 'Finish', arrow: true, done: true } });
    if (footNote) footNote.textContent = FOOT.done;
  }

  function showClosed() {
    phase = 'closed';
    document.body.dataset.step = 'closed';
    showScene('closed');
    setFooter({ back: true, next: null });
    if (footNote) footNote.textContent = FOOT.closed;
  }

  function goTo(i) {
    index = Math.max(0, Math.min(STEPS.length - 1, i));
    render();
  }

  async function next() {
    if (phase === 'done') { showClosed(); return; }
    if (phase === 'closed') { closeTab(); return; }
    if (index < STEPS.length - 1) { goTo(index + 1); return; }
    await finishSetup();
  }

  function back() {
    if (phase === 'closed') { showDone(); return; }
    if (phase === 'done') { goTo(STEPS.length - 1); return; }
    goTo(index - 1);
  }

  // ---- chrome plumbing -----------------------------------------------------
  function hasChromeApi() {
    return typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id;
  }

  function setStatus(text, tone) {
    if (!status) return;
    status.textContent = text || '';
    status.className = 'status' + (tone ? ' ' + tone : '');
  }

  function setButtonBusy(btn, busy, text) {
    if (!btn) return;
    btn.disabled = !!busy;
    if (text) btn.textContent = text;
  }

  function sendMessage(message) {
    return new Promise((resolve) => {
      if (!hasChromeApi() || !chrome.runtime.sendMessage) {
        resolve({ ok: false, error: 'Chrome extension APIs are not available on this page.' });
        return;
      }
      try {
        chrome.runtime.sendMessage(message, (res) => {
          const err = chrome.runtime.lastError;
          if (err) resolve({ ok: false, error: err.message || String(err) });
          else resolve(res || { ok: false, error: 'No response from WardenOne.' });
        });
      } catch (e) {
        resolve({ ok: false, error: String(e && e.message || e) });
      }
    });
  }

  function storageGet(key) {
    return new Promise((resolve) => {
      if (!hasChromeApi() || !chrome.storage || !chrome.storage.local) { resolve({}); return; }
      try { chrome.storage.local.get(key, (res) => resolve(res || {})); } catch (_) { resolve({}); }
    });
  }

  function storageSet(value) {
    return new Promise((resolve) => {
      if (!hasChromeApi() || !chrome.storage || !chrome.storage.local) { resolve(false); return; }
      try { chrome.storage.local.set(value, () => resolve(!chrome.runtime.lastError)); } catch (_) { resolve(false); }
    });
  }

  // ---- apply recommended ---------------------------------------------------
  const applyBtn = $('apply');

  function markApplyDone() {
    if (!applyBtn) return;
    applyBtn.disabled = false;
    applyBtn.textContent = 'Recommended protection is on';
    applyBtn.classList.remove('primary');
    applyBtn.classList.add('done');
  }

  async function applyRecommended() {
    setButtonBusy(applyBtn, true, 'Turning it on...');
    setStatus('');
    const res = await sendMessage({ kind: 'apply-onboarding-recommended' });
    if (!res || res.ok === false) {
      setButtonBusy(applyBtn, false, 'Turn on recommended protection');
      setStatus((res && res.error) || 'Could not apply the recommended settings.', 'bad');
      return;
    }
    await storageSet({ wardenone_onboarding_recommended_at: Date.now() });
    markApplyDone();
    setStatus('Recommended protection is on. Pin WardenOne next to keep controls one click away.', 'good');
  }

  // ---- apply maximum privacy (opt-in, superset of recommended) -------------
  const applyMaxBtn = $('apply-max');

  function markMaxApplyDone() {
    if (applyMaxBtn) {
      applyMaxBtn.disabled = false;
      applyMaxBtn.textContent = 'Maximum privacy is on';
      applyMaxBtn.classList.add('done');
    }
    // Maximum privacy includes everything Recommended does, so reflect that too.
    markApplyDone();
  }

  async function applyMaxPrivacy() {
    setButtonBusy(applyMaxBtn, true, 'Turning it on...');
    setStatus('');
    const res = await sendMessage({ kind: 'apply-onboarding-max-privacy' });
    if (!res || res.ok === false) {
      setButtonBusy(applyMaxBtn, false, 'Maximum privacy');
      setStatus((res && res.error) || 'Could not apply the maximum-privacy settings.', 'bad');
      return;
    }
    await storageSet({ wardenone_onboarding_recommended_at: Date.now(), wardenone_onboarding_maxprivacy_at: Date.now() });
    markMaxApplyDone();
    setStatus('Maximum privacy is on. If a site ever looks off, allowlist it from the popup — every part of this is reversible there.', 'good');
  }

  // ---- open controls -------------------------------------------------------
  // Open the real popup as the anchored toolbar dropdown (top-right) via
  // chrome.action.openPopup(). We never open a separate pop-out window. When the
  // browser won't anchor the popup (commonly before the icon is pinned), we point
  // the pin arrow at the toolbar instead of spawning a window. A short debounce
  // makes sure a double-press can't trigger two opens.
  let lastOpenAt = 0;
  let pinFlashTimer = 0;

  function currentStepName() {
    return phase === 'wizard' ? STEPS[index] : phase; // 'done' | 'closed'
  }

  function flashPinArrow() {
    // briefly resurface the "pin it here" arrow toward the toolbar as a visual cue
    document.body.dataset.step = 'pin';
    if (pinFlashTimer) window.clearTimeout(pinFlashTimer);
    pinFlashTimer = window.setTimeout(() => {
      document.body.dataset.step = currentStepName();
    }, 2800);
  }

  function guideToToolbar() {
    setStatus('Click the WardenOne shield in your toolbar to open the controls — pin it first if you don\'t see it.', 'good');
    flashPinArrow();
  }

  function openControls() {
    if (!hasChromeApi()) {
      setStatus('Open this page from the installed extension to use the buttons.', 'bad');
      return;
    }
    const now = Date.now();
    if (now - lastOpenAt < 600) return; // never trigger two opens from one double-press
    lastOpenAt = now;

    if (!chrome.action || !chrome.action.openPopup) { guideToToolbar(); return; }

    let result;
    try {
      result = chrome.action.openPopup(); // MV3: returns a Promise
    } catch (_) {
      guideToToolbar();
      return;
    }

    if (result && typeof result.then === 'function') {
      result.then(() => setStatus('Controls opened in the toolbar.', 'good')).catch(() => guideToToolbar());
    } else if (chrome.runtime.lastError) {
      guideToToolbar();
    } else {
      setStatus('Controls opened in the toolbar.', 'good');
    }
  }

  // ---- close this tab ------------------------------------------------------
  function manualCloseHint() {
    setStatus('Your settings are saved. You can close this tab manually.', 'good');
  }

  function closeTab() {
    if (hasChromeApi() && chrome.tabs && chrome.tabs.getCurrent) {
      try {
        chrome.tabs.getCurrent((tab) => {
          if (chrome.runtime.lastError || !tab || tab.id == null || !chrome.tabs.remove) {
            manualCloseHint();
            return;
          }
          chrome.tabs.remove(tab.id, () => {
            if (chrome.runtime.lastError) {
              try { window.close(); } catch (_) {}
              manualCloseHint();
            }
          });
        });
        return;
      } catch (_) {}
    }
    try { window.close(); } catch (_) {}
    manualCloseHint();
  }

  // ---- notification mode ---------------------------------------------------
  const normalMode = $('normal-mode');
  const silentMode = $('silent-mode');
  const modeNote = $('mode-note');

  function paintMode(isSilent) {
    if (silentMode) { silentMode.classList.toggle('active', !!isSilent); silentMode.setAttribute('aria-checked', isSilent ? 'true' : 'false'); }
    if (normalMode) { normalMode.classList.toggle('active', !isSilent); normalMode.setAttribute('aria-checked', !isSilent ? 'true' : 'false'); }
    if (modeNote) {
      modeNote.textContent = isSilent
        ? 'Silent Mode is on. Protection keeps running; non-critical popups, badges, and notifications stay hidden.'
        : 'Login compatibility stays on and your saved keys, allowlists, and trusted download sites are left untouched. You can change any of this later from the popup.';
    }
  }

  async function setSilentMode(isSilent) {
    setStatus('');
    const store = await storageGet('wardenone_config');
    const current = (store && store.wardenone_config && typeof store.wardenone_config === 'object') ? store.wardenone_config : {};
    const next = Object.assign({}, current, { silentMode: !!isSilent, showDownloadBar: true });
    const ok = await storageSet({ wardenone_config: next });
    if (!ok) { setStatus('Could not save your notification choice.', 'bad'); return; }
    paintMode(!!isSilent);
    setStatus(isSilent ? 'Silent Mode saved.' : 'Normal notifications saved.', 'good');
  }

  // ---- finish --------------------------------------------------------------
  async function finishSetup() {
    if (phase !== 'wizard') { showClosed(); return; }
    setButtonBusy(nextBtn, true, 'Saving...');
    const ok = await storageSet({ wardenone_onboarding_done_at: Date.now() });
    if (!ok) {
      setButtonBusy(nextBtn, false);
      nextBtn.textContent = 'Finish setup';
      setStatus('Could not save your setup state, but protection is still active.', 'bad');
      return;
    }
    setStatus('Setup complete.', 'good');
    showDone();
  }

  // ---- wiring --------------------------------------------------------------
  function init() {
    $('start')?.addEventListener('click', () => goTo(1));
    backBtn?.addEventListener('click', back);
    nextBtn?.addEventListener('click', next);
    $('skip')?.addEventListener('click', () => {
      if (phase === 'closed') { closeTab(); return; }
      if (phase === 'done') { showClosed(); return; }
      finishSetup();
    });

    dots.forEach((d) => d.addEventListener('click', () => goTo(parseInt(d.dataset.go, 10) || 0)));

    [$('open-popup-welcome'), $('open-popup-pin'), $('open-popup-explore'), $('open-popup-done'), $('open-popup-closed')]
      .filter(Boolean)
      .forEach((btn) => btn.addEventListener('click', openControls));

    $('close-tab')?.addEventListener('click', closeTab);

    if (coverWrap) {
      coverWrap.addEventListener('scroll', updateCoverFades, { passive: true });
      window.addEventListener('resize', updateCoverFades);
    }

    applyBtn?.addEventListener('click', applyRecommended);
    applyMaxBtn?.addEventListener('click', applyMaxPrivacy);
    normalMode?.addEventListener('click', () => setSilentMode(false));
    silentMode?.addEventListener('click', () => setSilentMode(true));

    // keyboard: left/right arrows move through the flow
    document.addEventListener('keydown', (e) => {
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); back(); }
    });

    // restore prior state
    storageGet(['wardenone_config', 'wardenone_onboarding_recommended_at', 'wardenone_onboarding_maxprivacy_at', 'wardenone_onboarding_done_at'])
      .then((store) => {
        const cfg = (store && store.wardenone_config) || {};
        paintMode(cfg.silentMode === true);
        if (store && store.wardenone_onboarding_maxprivacy_at) markMaxApplyDone();
        else if (store && store.wardenone_onboarding_recommended_at) markApplyDone();
      });

    render();
  }

  init();
}());
