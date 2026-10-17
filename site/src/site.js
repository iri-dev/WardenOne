(() => {
  const root = document.documentElement;
  root.classList.add('js');
  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

  /* Opened straight from dist/ (file://), a link to a folder shows a directory listing.
     Point folder routes at their index.html and the Jekyll-rendered documents at GitHub. */
  if (location.protocol === 'file:') {
    const documents = ['PRIVACY', 'CHANGELOG', 'CREDITS', 'SUPPORT'];
    for (const link of $$('a[href]')) {
      const href = link.getAttribute('href');
      if (/^(?:[a-z][a-z\d+.-]*:|#|\/)/i.test(href)) continue;
      const hashAt = href.indexOf('#');
      const route = hashAt === -1 ? href : href.slice(0, hashAt);
      const hash = hashAt === -1 ? '' : href.slice(hashAt);
      const name = route.split('/').pop();
      let target;
      if (route.endsWith('/')) target = `${route}index.html`;
      else if (name === 'stolen') target = `${route}.html`;
      else if (documents.includes(name)) target = `https://github.com/iri-dev/WardenOne/blob/main/${name}.md`;
      else continue;
      link.setAttribute('href', target + hash);
    }
  }

  const store = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch { /* Works for this page only. */ } }
  };
  const themeButton = $('[data-theme-toggle]');
  const themeColor = $('meta[name="theme-color"]');
  const setTheme = theme => {
    root.dataset.theme = theme;
    themeColor?.setAttribute('content', theme === 'dark' ? '#110a16' : '#fbf8fd');
    themeButton?.setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`);
  };
  /* A page restored from the back/forward cache or activated from a prerender may predate the last toggle. */
  const syncTheme = () => {
    const saved = store.get('wardenone-site-theme');
    setTheme(saved === 'dark' || saved === 'light' ? saved : root.dataset.theme);
  };
  syncTheme();
  addEventListener('pageshow', syncTheme);
  document.addEventListener('prerenderingchange', syncTheme);
  themeButton?.addEventListener('click', () => {
    setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark');
    store.set('wardenone-site-theme', root.dataset.theme);
  });

  const menuButton = $('[data-menu-toggle]');
  const nav = $('#primary-nav');
  const setMenu = open => { menuButton?.setAttribute('aria-expanded', String(open)); nav?.classList.toggle('is-open', open); };
  menuButton?.addEventListener('click', () => setMenu(menuButton.getAttribute('aria-expanded') !== 'true'));
  nav?.addEventListener('click', event => { if (event.target.closest('a')) setMenu(false); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') setMenu(false); });

  const header = $('.site-header');
  const onScroll = () => header?.classList.toggle('is-scrolled', scrollY > 8);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* Product tour: a real tablist; without JavaScript every panel simply stays visible. */
  for (const tabs of $$('[data-tabs]')) {
    const buttons = $$('[role="tab"]', tabs);
    const select = (button, focus) => {
      for (const other of buttons) {
        const active = other === button;
        other.setAttribute('aria-selected', String(active));
        other.tabIndex = active ? 0 : -1;
        const panel = document.getElementById(other.getAttribute('aria-controls'));
        panel.hidden = !active;
        if (active) { panel.classList.remove('is-entering'); void panel.offsetWidth; panel.classList.add('is-entering'); }
      }
      if (focus) button.focus({ preventScroll: true });
      const strip = button.parentElement.getBoundingClientRect();
      const chosen = button.getBoundingClientRect();
      button.parentElement.scrollLeft += chosen.left - strip.left - (strip.width - chosen.width) / 2;
    };
    buttons.forEach((button, index) => {
      button.addEventListener('click', () => select(button, false));
      button.addEventListener('keydown', event => {
        const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
        let next = step ? buttons[(index + step + buttons.length) % buttons.length] : null;
        if (event.key === 'Home') next = buttons[0];
        if (event.key === 'End') next = buttons[buttons.length - 1];
        if (next) { event.preventDefault(); select(next, true); }
      });
    });
    buttons.forEach(button => {
      const panel = document.getElementById(button.getAttribute('aria-controls'));
      panel.hidden = button.getAttribute('aria-selected') !== 'true';
    });
  }

  for (const compare of $$('[data-compare]')) {
    const range = $('input[type="range"]', compare);
    const update = () => compare.style.setProperty('--pos', `${range.value}%`);
    range.addEventListener('input', update);
    update();
  }

  const showcase = $('[data-showcase]');
  if (showcase) {
    const image = $('[data-showcase-image]', showcase);
    const caption = $('[data-showcase-caption]', showcase);
    const label = $('[data-showcase-label]', showcase);
    for (const button of $$('[data-showcase-choice]', showcase)) {
      button.addEventListener('click', () => {
        for (const choice of $$('[data-showcase-choice]', showcase)) choice.setAttribute('aria-pressed', String(choice === button));
        image.src = button.dataset.image;
        image.alt = button.dataset.alt;
        caption.textContent = button.dataset.caption;
        if (label) label.textContent = button.dataset.label;
      });
    }
  }

  /* Shared search: FAQ answers and the feature catalogue filter the same way. */
  function filterList({ input, items, groups, status, empty, chips, describe }) {
    let category = 'all';
    const run = () => {
      const terms = input.value.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
      let visible = 0;
      for (const item of items) {
        const inCategory = category === 'all' || item.closest('[data-category]')?.dataset.category === category;
        const text = item.dataset.search || (item.dataset.search = item.textContent.toLocaleLowerCase());
        item.hidden = !inCategory || !terms.every(term => text.includes(term));
        if (!item.hidden) visible++;
      }
      for (const group of groups) group.hidden = !$$('[data-item]', group).some(item => !item.hidden);
      if (status) status.textContent = describe(visible, terms.length > 0 || category !== 'all');
      if (empty) empty.hidden = visible !== 0;
    };
    input.addEventListener('input', run);
    for (const chip of chips) {
      chip.addEventListener('click', () => {
        category = chip.dataset.filter;
        for (const other of chips) other.setAttribute('aria-pressed', String(other === chip));
        run();
      });
    }
    run();
  }
  const faqSearch = $('[data-faq-search]');
  if (faqSearch) {
    const total = $$('[data-faq-group] [data-item]').length;
    filterList({ input: faqSearch, items: $$('[data-faq-group] [data-item]'), groups: $$('[data-faq-group]'), status: $('[data-faq-status]'), empty: $('[data-faq-empty]'), chips: [],
      describe: (count, filtered) => filtered ? `${count} answer${count === 1 ? '' : 's'} found` : `${total} questions` });
  }
  const catalogue = $('[data-catalogue]');
  if (catalogue) {
    const total = $$('[data-item]', catalogue).length;
    filterList({ input: $('[data-catalogue-search]'), items: $$('[data-item]', catalogue), groups: $$('[data-group], [data-category]', catalogue), status: $('[data-catalogue-status]'),
      empty: $('[data-catalogue-empty]'), chips: $$('[data-filter]'),
      describe: (count, filtered) => filtered ? `Showing ${count} of ${total}` : `All ${total} features, controls and tools` });
  }

  for (const button of $$('[data-copy]')) {
    button.addEventListener('click', async () => {
      const text = document.getElementById(button.dataset.copy).dataset.command;
      const label = $('span', button);
      try { await navigator.clipboard.writeText(text); label.textContent = 'Copied'; } catch { label.textContent = 'Select to copy'; }
      setTimeout(() => { label.textContent = 'Copy'; }, 1800);
    });
  }

  /* "On this page" for long articles and documents, built from their section headings. */
  const doc = $('[data-doc]');
  const toc = $('[data-doc-toc]');
  const headings = doc ? $$('h2[id]', doc) : [];
  if (toc && headings.length >= 3) {
    const title = document.createElement('strong');
    title.textContent = 'On this page';
    toc.append(title);
    const links = headings.map(heading => {
      const link = document.createElement('a');
      link.href = `#${heading.id}`;
      link.textContent = heading.dataset.toc || heading.textContent.replace(/^[^\p{L}\p{N}]+/u, '').trim();
      toc.append(link);
      return link;
    });
    toc.hidden = false;
    if ('IntersectionObserver' in window) {
      const spy = new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          links.forEach(link => link.setAttribute('aria-current', String(link.hash === `#${entry.target.id}`)));
        }
      }, { rootMargin: '-90px 0px -70% 0px' });
      headings.forEach(heading => spy.observe(heading));
    }
  }

  const reveals = $$('.reveal');
  if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) { entry.target.classList.add('is-visible'); observer.unobserve(entry.target); }
    }, { rootMargin: '0px 0px -8% 0px' });
    reveals.forEach(element => observer.observe(element));
  } else {
    reveals.forEach(element => element.classList.add('is-visible'));
  }
})();
