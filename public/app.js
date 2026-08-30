(() => {
  'use strict';

  const APP_VERSION = '14';

  // ---------- Escaping helper (defense in depth against stored XSS) ----------
  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // ---------- Platform detection ----------
  // telegram-web-app.js / max-web-app.js are loaded async so the page itself
  // isn't blocked if one of those external domains is slow/unreachable —
  // there's no guarantee the SDK global exists the instant this script runs.
  function waitForPlatformSdk(timeoutMs) {
    return new Promise((resolve) => {
      const start = Date.now();
      (function poll() {
        if (window.Telegram?.WebApp || window.WebApp || Date.now() - start >= timeoutMs) {
          resolve();
          return;
        }
        setTimeout(poll, 50);
      })();
    });
  }

  let tg = null;
  let maxApp = null;

  function currentInitData() {
    try {
      if (tg?.initData) return tg.initData;
    } catch (e) { /* defensive: never let a bridge quirk break boot */ }
    try {
      if (maxApp && typeof maxApp.initData === 'string' && maxApp.initData) return maxApp.initData;
    } catch (e) { /* ignore */ }
    return '';
  }

  function platformMode() {
    if (tg) return 'telegram';
    if (maxApp && currentInitData()) return 'max';
    return 'web';
  }

  // ---------- Toast ----------
  function toast(message) {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, 3200);
  }

  // ---------- API helpers ----------
  function authHeader() {
    const mode = platformMode();
    if (mode === 'telegram') return { 'X-Telegram-Init-Data': currentInitData() };
    if (mode === 'max') return { 'X-Max-Init-Data': currentInitData() };
    // Plain web / cookie session: sending no init-data header at all lets the
    // backend's CSRF Origin-check treat this as a cookie-authenticated request.
    return {};
  }

  class ApiError extends Error {
    constructor(message, status, flags) {
      super(message);
      this.status = status;
      Object.assign(this, flags);
    }
  }

  async function apiFetch(path, options = {}) {
    const isForm = options.body instanceof FormData;
    const headers = { ...(isForm ? {} : { 'Content-Type': 'application/json' }), ...authHeader(), ...(options.headers || {}) };
    const res = await fetch(`/api${path}`, { ...options, headers, credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new ApiError(data.error || 'Ошибка запроса', res.status, {
        banned: !!data.banned,
        phoneRequired: !!data.phoneRequired,
        nameRequired: !!data.nameRequired,
        agreementRequired: !!data.agreementRequired,
      });
    }
    return data;
  }

  /** Raw-text GET, used for the printable rental contract HTML document. */
  async function apiFetchText(path) {
    const res = await fetch(`/api${path}`, { headers: { ...authHeader() }, credentials: 'same-origin' });
    const text = await res.text();
    if (!res.ok) {
      let msg = 'Ошибка запроса';
      try { msg = JSON.parse(text).error || msg; } catch (e) { /* not JSON */ }
      throw new ApiError(msg, res.status, {});
    }
    return text;
  }

  async function apiUpload(path, formData) {
    const res = await fetch(`/api${path}`, { method: 'POST', headers: { ...authHeader() }, credentials: 'same-origin', body: formData });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(data.error || 'Ошибка загрузки', res.status, {});
    return data;
  }

  // ---------- Confirm / prompt overlays ----------
  function askConfirm(message) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'confirm-overlay';
      const box = document.createElement('div');
      box.className = 'confirm-box';
      const p = document.createElement('p');
      p.textContent = message;
      const actions = document.createElement('div');
      actions.className = 'confirm-actions';
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn secondary';
      cancelBtn.textContent = 'Отмена';
      const okBtn = document.createElement('button');
      okBtn.type = 'button';
      okBtn.className = 'btn';
      okBtn.textContent = 'ОК';
      actions.append(cancelBtn, okBtn);
      box.append(p, actions);
      overlay.appendChild(box);
      function close(result) { overlay.remove(); resolve(result); }
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
      cancelBtn.addEventListener('click', () => close(false));
      okBtn.addEventListener('click', () => close(true));
      document.body.appendChild(overlay);
    });
  }

  /** Like askConfirm, but with an optional reason textarea. Returns null if the user backed out. */
  function askConfirmWithReason(message, okLabel) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'confirm-overlay';
      const box = document.createElement('div');
      box.className = 'confirm-box';
      const p = document.createElement('p');
      p.textContent = message;
      const textarea = document.createElement('textarea');
      textarea.className = 'cancel-reason-input';
      textarea.maxLength = 300;
      textarea.placeholder = 'Причина (необязательно)';
      const actions = document.createElement('div');
      actions.className = 'confirm-actions';
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn secondary';
      cancelBtn.textContent = 'Не отменять';
      const okBtn = document.createElement('button');
      okBtn.type = 'button';
      okBtn.className = 'btn';
      okBtn.textContent = okLabel || 'Подтвердить';
      actions.append(cancelBtn, okBtn);
      box.append(p, textarea, actions);
      overlay.appendChild(box);
      function close(result) { overlay.remove(); resolve(result); }
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
      cancelBtn.addEventListener('click', () => close(null));
      okBtn.addEventListener('click', () => close(textarea.value.trim()));
      document.body.appendChild(overlay);
    });
  }

  /** Generic modal with DOM content built by the caller (never raw innerHTML of user data). */
  function openModal(buildFn, opts = {}) {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    const box = document.createElement('div');
    box.className = 'confirm-box';
    box.style.maxWidth = opts.wide ? '480px' : '360px';
    box.style.textAlign = 'left';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn secondary small';
    closeBtn.textContent = '✕ Закрыть';
    closeBtn.style.marginBottom = '10px';
    box.appendChild(closeBtn);
    const content = document.createElement('div');
    box.appendChild(content);
    overlay.appendChild(box);
    function close() { overlay.remove(); }
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    closeBtn.addEventListener('click', close);
    document.body.appendChild(overlay);
    buildFn(content, close);
    return close;
  }

  // ---------- State ----------
  const state = {
    me: null,
    isAdmin: false,
    cities: [],
    activeTab: 'search',
    botUsername: null,
    bookingsSub: 'renter',
    adminSub: 'users',
  };

  const CAR_CLASS_LABELS = {
    economy: 'Эконом', comfort: 'Комфорт', business: 'Бизнес',
    premium: 'Премиум', suv: 'Внедорожник', minivan: 'Минивэн',
  };
  const TRANSMISSION_LABELS = { manual: 'Механика', automatic: 'Автомат' };
  const FUEL_LABELS = { petrol: 'Бензин', diesel: 'Дизель', hybrid: 'Гибрид', electric: 'Электро', gas: 'Газ' };
  const BOOKING_STATUS_LABELS = { pending: 'ожидает подтверждения', confirmed: 'подтверждена', cancelled: 'отменена', completed: 'завершена' };
  const CONTACT_STATUS_LABELS = { pending: 'ожидает подтверждения', confirmed: 'подтверждено', declined: 'отклонено' };
  const LISTING_STATUS_LABELS = { active: 'активно', paused: 'приостановлено', deleted: 'удалено' };

  function toDateStr(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr.length <= 10 ? `${dateStr}T00:00:00` : dateStr);
    if (Number.isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  function skeletonHtml(count) {
    const card = `<div class="skeleton-card">
      <div class="skeleton-line w-60"></div>
      <div class="skeleton-line w-40"></div>
      <div class="skeleton-line w-90"></div>
    </div>`;
    return card.repeat(count);
  }

  function starsHtml(avg, count) {
    if (!count) return '<span class="rating-line">Пока нет оценок</span>';
    const rounded = Math.round(Number(avg) || 0);
    let stars = '';
    for (let i = 1; i <= 5; i++) stars += `<span class="${i <= rounded ? 'filled' : ''}">★</span>`;
    return `<span class="rating-line"><span class="stars">${stars}</span> ${Number(avg).toFixed(1)} (${count})</span>`;
  }

  // Плейсхолдер для объявлений без фото — карточка не выглядит "пустой"/сломанной,
  // пока владелец не загрузил снимки. Встроенный SVG, без сетевого запроса.
  const NO_PHOTO_SVG =
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200">
        <rect width="300" height="200" fill="#e4e0cd"/>
        <g fill="none" stroke="#33472c" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" opacity="0.55">
          <path d="M55 130 L75 90 Q85 78 100 78 L200 78 Q215 78 225 92 L245 130"/>
          <rect x="45" y="130" width="210" height="34" rx="10"/>
          <circle cx="95" cy="164" r="16"/>
          <circle cx="205" cy="164" r="16"/>
        </g>
      </svg>`
    );

  function photoCarouselHtml(photos) {
    if (!photos || !photos.length) {
      return `<div class="photo-carousel single"><img class="car-photo no-photo" src="${NO_PHOTO_SVG}" alt="Фото пока не загружено" /></div>`;
    }
    const cls = photos.length === 1 ? 'photo-carousel single' : 'photo-carousel';
    return `<div class="${cls}">${photos.map((p) => {
      const src = `/uploads/${p.replace(/^\/?uploads\//, '')}`;
      return `<img class="car-photo" loading="lazy" src="${src}" alt="Фото автомобиля" />`;
    }).join('')}</div>`;
  }

  // ---------- Cities dropdowns (область → город) ----------

  /**
   * Наполняет <select> города списком, отфильтрованным по выбранной области.
   * В поиске область необязательна (пусто = все города страны), в форме
   * объявления — обязательна: пока область не выбрана, список городов
   * заблокирован с поясняющей подсказкой, а не просто пуст.
   */
  function fillCitySelect(selectEl, region, emptyRegionLabel, requireRegion) {
    const currentValue = selectEl.value;
    if (requireRegion && !region) {
      selectEl.innerHTML = '<option value="" disabled selected>Сначала выберите область</option>';
      selectEl.disabled = true;
      return;
    }
    selectEl.disabled = false;
    const list = region ? state.cities.filter((c) => c.region === region) : state.cities;
    const options = list.map((c) => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join('');
    const placeholder = requireRegion
      ? '<option value="" disabled>Выберите город</option>'
      : `<option value="">${escapeHtml(emptyRegionLabel)}</option>`;
    selectEl.innerHTML = placeholder + options;
    selectEl.value = list.some((c) => c.name === currentValue) ? currentValue : '';
  }

  async function loadCities() {
    try {
      const { cities } = await apiFetch('/cities');
      state.cities = cities;
      const regions = [...new Set(cities.map((c) => c.region).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
      const regionOptions = regions.map((r) => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('');

      const searchRegionSelect = document.getElementById('searchRegion');
      const currentSearchRegion = searchRegionSelect.value;
      searchRegionSelect.innerHTML = '<option value="">Область: любая</option>' + regionOptions;
      searchRegionSelect.value = regions.includes(currentSearchRegion) ? currentSearchRegion : '';
      fillCitySelect(document.getElementById('searchCity'), searchRegionSelect.value, 'Город: любой', false);

      const carRegionSelect = document.getElementById('carRegion');
      const currentCarRegion = carRegionSelect.value;
      carRegionSelect.innerHTML =
        '<option value="" disabled' + (currentCarRegion ? '' : ' selected') + '>Выберите область</option>' + regionOptions;
      carRegionSelect.value = regions.includes(currentCarRegion) ? currentCarRegion : '';
      fillCitySelect(document.getElementById('carCity'), carRegionSelect.value, '', true);
    } catch (err) {
      // Список городов не загрузился (например, разрыв сети при старте) —
      // не критично для загрузки самого приложения, но фильтр/форма
      // временно останутся с одним пунктом-заглушкой; повторная загрузка
      // происходит при каждом заходе на вкладки "Поиск"/"Сдать авто".
    }
  }

  document.getElementById('searchRegion').addEventListener('change', (e) => {
    fillCitySelect(document.getElementById('searchCity'), e.target.value, 'Город: любой', false);
    loadCars();
  });
  document.getElementById('carRegion').addEventListener('change', (e) => {
    fillCitySelect(document.getElementById('carCity'), e.target.value, '', true);
  });

  function isKnownCityName(name) {
    return state.cities.some((c) => c.name === name);
  }

  // ---------- Tabs ----------
  const TABS = ['search', 'lend', 'bookings', 'profile', 'admin'];
  function showTab(name) {
    state.activeTab = name;
    TABS.forEach((t) => { document.getElementById(`tab-${t}`).hidden = t !== name; });
    document.querySelectorAll('.tab-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === name));
    if (name === 'search') loadCars();
    if (name === 'lend') loadLendTab();
    if (name === 'bookings') loadBookingsTab();
    if (name === 'profile') loadProfileTab();
    if (name === 'admin') loadAdminTab();
  }
  document.querySelectorAll('.tab-btn').forEach((btn) => btn.addEventListener('click', () => showTab(btn.dataset.tab)));

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !document.getElementById('app').hidden) showTab(state.activeTab);
  });

  // ---------- Agreement modal ----------
  async function ensureAgreementThenRetry(action) {
    let agreement;
    try {
      agreement = await apiFetch('/legal/agreement');
    } catch (err) {
      toast(err.message);
      return;
    }
    openModal((content, close) => {
      const h3 = document.createElement('h3');
      h3.textContent = 'Пользовательское соглашение сервиса автодай.рф';
      const box = document.createElement('div');
      box.className = 'agreement-box';
      // Server-controlled static legal text — the one place raw HTML insertion is acceptable.
      box.innerHTML = agreement.html;
      const label = document.createElement('label');
      label.className = 'checkbox-label';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      const span = document.createElement('span');
      span.textContent = 'Согласен с Пользовательским соглашением сервиса автодай.рф';
      label.append(checkbox, span);
      const submitBtn = document.createElement('button');
      submitBtn.type = 'button';
      submitBtn.className = 'btn';
      submitBtn.style.marginTop = '12px';
      submitBtn.textContent = 'Принять и продолжить';
      submitBtn.disabled = true;
      checkbox.addEventListener('change', () => { submitBtn.disabled = !checkbox.checked; });
      submitBtn.addEventListener('click', async () => {
        submitBtn.disabled = true;
        try {
          const { user } = await apiFetch('/users/me/agreement/accept', { method: 'POST' });
          state.me = user;
          close();
          await action();
        } catch (err) {
          toast(err.message);
          submitBtn.disabled = false;
        }
      });
      content.append(h3, box, label, submitBtn);
    }, { wide: true });
  }

  /** Runs an action; if the backend says agreementRequired, shows the modal and retries once accepted. */
  async function withAgreementGate(action) {
    try {
      await action();
    } catch (err) {
      if (err.agreementRequired) {
        await ensureAgreementThenRetry(action);
        return;
      }
      throw err;
    }
  }

  // ---------- App gate (banned / phone / name) ----------
  function showAppGate(kind) {
    document.getElementById('app').hidden = true;
    document.getElementById('tabbar').hidden = true;
    document.getElementById('browserLoginGate').hidden = true;
    const gate = document.getElementById('appGate');
    gate.hidden = false;
    const title = document.getElementById('gateTitle');
    const text = document.getElementById('gateText');
    const nameForm = document.getElementById('gateNameForm');
    const actionBtn = document.getElementById('gateActionBtn');
    nameForm.hidden = true;
    actionBtn.hidden = true;

    if (kind === 'banned') {
      title.textContent = 'Аккаунт заблокирован';
      text.textContent = 'Ваш аккаунт заблокирован администратором сервиса. Если считаете это ошибкой, напишите в поддержку в чате с ботом.';
      actionBtn.hidden = state.me?.platform === 'max';
      actionBtn.textContent = 'Открыть чат с ботом';
    } else if (kind === 'phone') {
      title.textContent = 'Подтвердите телефон';
      if (state.me?.platform === 'max') {
        text.textContent = 'Чтобы пользоваться сервисом, подтвердите номер телефона в чате с ботом MAX — откройте чат и следуйте инструкциям бота.';
        actionBtn.hidden = true;
      } else {
        text.textContent = 'Чтобы пользоваться сервисом, подтвердите номер телефона в чате с ботом — это защищает пользователей от фейковых аккаунтов.';
        actionBtn.hidden = false;
        actionBtn.textContent = 'Открыть чат с ботом';
      }
    } else if (kind === 'name') {
      title.textContent = 'Укажите ФИО';
      text.textContent = 'Фамилия, имя и отчество — это нужно для договора аренды и общения с контрагентом. Без этого сервис недоступен.';
      nameForm.hidden = false;
    }
  }

  function hideAppGate() {
    document.getElementById('appGate').hidden = true;
    document.getElementById('browserLoginGate').hidden = true;
    document.getElementById('app').hidden = false;
    document.getElementById('tabbar').hidden = false;
  }

  document.getElementById('gateActionBtn').addEventListener('click', openBotChat);
  document.getElementById('gateNameSubmitBtn').addEventListener('click', async () => {
    const input = document.getElementById('gateNameInput');
    const fullName = input.value.trim().replace(/\s+/g, ' ');
    if (fullName.split(' ').length < 3) {
      toast('Укажите фамилию, имя и отчество через пробел');
      return;
    }
    try {
      const { user } = await apiFetch('/users/me/name', { method: 'POST', body: JSON.stringify({ fullName }) });
      state.me = user;
      boot();
    } catch (err) {
      toast(err.message);
    }
  });

  async function openBotChat() {
    if (!state.botUsername) {
      try {
        const cfg = await apiFetch('/config');
        state.botUsername = cfg.botUsername;
      } catch (e) { /* ignore */ }
    }
    const link = state.botUsername ? `https://t.me/${state.botUsername}` : null;
    if (tg) {
      try {
        if (link && typeof tg.openTelegramLink === 'function') { tg.openTelegramLink(link); return; }
        if (typeof tg.close === 'function') { tg.close(); return; }
      } catch (e) { /* fall through */ }
    }
    if (link) window.open(link, '_blank');
  }

  // ---------- Browser login gate (plain web / PWA) ----------
  let loginPollTimer = null;

  function showBrowserLoginGate() {
    document.getElementById('app').hidden = true;
    document.getElementById('tabbar').hidden = true;
    document.getElementById('appGate').hidden = true;
    document.getElementById('browserLoginGate').hidden = false;
  }

  document.getElementById('loginCodeStartBtn').addEventListener('click', async () => {
    try {
      const { code, pollToken } = await apiFetch('/auth/login-code/start', { method: 'POST' });
      document.getElementById('loginCodeText').textContent = code;
      document.getElementById('loginCodeBox').hidden = false;
      document.getElementById('loginCodeStartBtn').hidden = true;

      if (!state.botUsername) {
        try {
          const cfg = await apiFetch('/config');
          state.botUsername = cfg.botUsername;
        } catch (e) { /* ignore */ }
      }
      const tgLink = document.getElementById('loginOpenTelegramLink');
      if (state.botUsername) {
        tgLink.href = `https://t.me/${state.botUsername}`;
        tgLink.hidden = false;
      }

      clearInterval(loginPollTimer);
      loginPollTimer = setInterval(async () => {
        try {
          const params = new URLSearchParams({ code, pollToken });
          const res = await fetch(`/api/auth/login-code/status?${params.toString()}`, { credentials: 'same-origin' });
          const data = await res.json().catch(() => ({}));
          if (data.ok) {
            clearInterval(loginPollTimer);
            document.getElementById('loginCodeStatus').textContent = 'Готово! Загружаем приложение…';
            location.reload();
          }
        } catch (e) { /* keep polling */ }
      }, 2500);
    } catch (err) {
      toast(err.message);
    }
  });

  document.getElementById('loginCodeCopyBtn').addEventListener('click', async () => {
    const code = document.getElementById('loginCodeText').textContent;
    try {
      await navigator.clipboard.writeText(code);
      toast('Код скопирован');
    } catch (e) {
      toast('Не удалось скопировать — введите код вручную: ' + code);
    }
  });

  // ---------- Search tab ----------
  function carCardHtml(listing, opts = {}) {
    const photos = (listing.photos || []).map((p) => p.replace(/^\/?uploads\//, ''));
    const statusBadge = listing.status && listing.status !== 'active'
      ? `<span class="badge ${listing.status === 'paused' ? 'paused' : 'cancelled'}">${LISTING_STATUS_LABELS[listing.status] || listing.status}</span>`
      : '';
    const ratingLine = listing.rating_count !== undefined ? starsHtml(listing.avg_rating, listing.rating_count) : '';
    const ownerLine = listing.owner_first_name
      ? `<div class="owner">Владелец: ${escapeHtml(listing.owner_full_name || listing.owner_first_name)}${listing.owner_username ? ' · @' + escapeHtml(listing.owner_username) : ''}</div>`
      : '';
    return `
      <div class="card car-card" data-listing-id="${listing.id}">
        ${photoCarouselHtml(photos)}
        <div class="row">
          <div class="route">${escapeHtml(listing.brand)} ${escapeHtml(listing.model)} (${listing.year})</div>
          ${statusBadge || `<span class="badge ok">${escapeHtml(listing.city)}</span>`}
        </div>
        <div class="meta">
          <span>${CAR_CLASS_LABELS[listing.car_class] || listing.car_class}</span>
          <span>${TRANSMISSION_LABELS[listing.transmission] || listing.transmission}</span>
          <span>${FUEL_LABELS[listing.fuel_type] || listing.fuel_type}</span>
          <span>${listing.seats} мест</span>
        </div>
        <div class="price">${listing.price_per_day} ₽/сутки</div>
        ${ratingLine}
        ${ownerLine}
        ${opts.action || ''}
      </div>`;
  }

  const searchFilterIds = ['searchCity', 'searchCarClass', 'searchTransmission', 'searchBrand', 'searchModel', 'searchMinPrice', 'searchMaxPrice', 'searchDateFrom', 'searchDateTo', 'searchSort', 'searchHasDeposit'];
  searchFilterIds.forEach((id) => {
    const el = document.getElementById(id);
    el.addEventListener('change', loadCars);
  });

  async function loadCars() {
    const list = document.getElementById('carsList');
    const empty = document.getElementById('carsEmpty');
    empty.hidden = true;
    list.innerHTML = skeletonHtml(3);
    try {
      const params = new URLSearchParams();
      const cityVal = document.getElementById('searchCity').value.trim();
      if (cityVal && isKnownCityName(cityVal)) params.set('city', cityVal);
      const carClass = document.getElementById('searchCarClass').value;
      if (carClass) params.set('carClass', carClass);
      const transmission = document.getElementById('searchTransmission').value;
      if (transmission) params.set('transmission', transmission);
      const brand = document.getElementById('searchBrand').value.trim();
      if (brand) params.set('brand', brand);
      const model = document.getElementById('searchModel').value.trim();
      if (model) params.set('model', model);
      const minPrice = document.getElementById('searchMinPrice').value;
      if (minPrice) params.set('minPrice', minPrice);
      const maxPrice = document.getElementById('searchMaxPrice').value;
      if (maxPrice) params.set('maxPrice', maxPrice);
      const dateFrom = document.getElementById('searchDateFrom').value;
      const dateTo = document.getElementById('searchDateTo').value;
      if (dateFrom && dateTo) { params.set('dateFrom', dateFrom); params.set('dateTo', dateTo); }
      if (document.getElementById('searchHasDeposit').checked) params.set('hasDeposit', '0');
      params.set('sort', document.getElementById('searchSort').value);

      const { listings } = await apiFetch(`/cars?${params.toString()}`);
      empty.hidden = listings.length > 0;
      list.innerHTML = listings.map((l) => carCardHtml(l, {
        action: `<button type="button" class="btn small" data-listing-detail="${l.id}">Подробнее</button>`,
      })).join('');
    } catch (err) {
      list.innerHTML = '';
      toast(err.message);
    }
  }

  document.getElementById('carsList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-listing-detail]');
    if (btn) openListingDetail(Number(btn.dataset.listingDetail));
  });

  document.body.addEventListener('click', (e) => {
    const photo = e.target.closest('.car-photo');
    if (photo && !photo.classList.contains('no-photo')) {
      openLightbox(photo.getAttribute('src'));
      return;
    }
    const thumb = e.target.closest('.car-photo-thumb');
    if (thumb) openLightbox(thumb.getAttribute('data-full') || thumb.getAttribute('src'));
  });

  function openLightbox(src) {
    const overlay = document.createElement('div');
    overlay.className = 'lightbox-overlay';
    const img = document.createElement('img');
    img.src = src;
    img.alt = '';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'lightbox-close';
    closeBtn.textContent = '✕';
    overlay.append(img, closeBtn);
    function close() { overlay.remove(); }
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    closeBtn.addEventListener('click', close);
    document.body.appendChild(overlay);
  }

  async function openListingDetail(id) {
    let listing;
    try {
      const data = await apiFetch(`/cars/${id}`);
      listing = data.listing;
    } catch (err) {
      toast(err.message);
      return;
    }
    openModal((content) => {
      const photos = (listing.photos || []).map((p) => p.replace(/^\/?uploads\//, ''));
      const wrap = document.createElement('div');
      wrap.innerHTML = `
        ${photoCarouselHtml(photos)}
        <h3 style="margin:6px 0;">${escapeHtml(listing.brand)} ${escapeHtml(listing.model)} (${listing.year})</h3>
        <div class="meta" style="margin-bottom:8px;">
          <span>${escapeHtml(listing.city)}</span>
          <span>${CAR_CLASS_LABELS[listing.car_class] || listing.car_class}</span>
          <span>${TRANSMISSION_LABELS[listing.transmission] || listing.transmission}</span>
          <span>${FUEL_LABELS[listing.fuel_type] || listing.fuel_type}</span>
          <span>${listing.seats} мест</span>
          ${listing.color ? `<span>Цвет: ${escapeHtml(listing.color)}</span>` : ''}
        </div>
        <div class="price">${listing.price_per_day} ₽/сутки${listing.deposit ? ` · залог ${listing.deposit} ₽` : ' · без залога'}</div>
        <div class="meta" style="margin:6px 0;"><span>Мин. срок: ${listing.min_rental_days} сут.</span>${listing.mileage_limit ? `<span>Лимит пробега: ${listing.mileage_limit} км/сут.</span>` : ''}</div>
        ${starsHtml(listing.avg_rating, listing.rating_count)}
        ${listing.restrictions ? `<p class="comment">⚠️ ${escapeHtml(listing.restrictions)}</p>` : ''}
        ${listing.description ? `<p>${escapeHtml(listing.description)}</p>` : ''}
        <div class="owner" style="margin:8px 0;">Владелец: ${escapeHtml(listing.owner_full_name || listing.owner_first_name)}${listing.owner_username ? ' · @' + escapeHtml(listing.owner_username) : ''}</div>
      `;
      content.appendChild(wrap);

      if (listing.status !== 'active') {
        const p = document.createElement('p');
        p.className = 'empty';
        p.textContent = 'Это объявление сейчас недоступно для бронирования.';
        content.appendChild(p);
        return;
      }
      if (listing.owner_id === state.me?.telegram_id) {
        const p = document.createElement('p');
        p.className = 'empty';
        p.textContent = 'Это ваше собственное объявление.';
        content.appendChild(p);
        return;
      }

      const contactBtn = document.createElement('button');
      contactBtn.type = 'button';
      contactBtn.className = 'btn secondary';
      contactBtn.style.marginTop = '4px';
      contactBtn.textContent = '📞 Показать контакты';
      content.appendChild(contactBtn);
      contactBtn.addEventListener('click', async () => {
        contactBtn.disabled = true;
        await withAgreementGate(async () => {
          await apiFetch('/contact-requests', { method: 'POST', body: JSON.stringify({ listingId: id }) });
          toast('Запрос отправлен владельцу — контакты придут после подтверждения.');
          contactBtn.textContent = '✅ Запрос отправлен';
        });
        if (contactBtn.textContent !== '✅ Запрос отправлен') contactBtn.disabled = false;
      });

      const form = document.createElement('div');
      form.style.marginTop = '12px';
      form.innerHTML = `
        <label>Дата с<input type="date" id="bookDateFrom" /></label>
        <label style="margin-top:8px;">Дата по<input type="date" id="bookDateTo" /></label>
      `;
      const bookBtn = document.createElement('button');
      bookBtn.type = 'button';
      bookBtn.className = 'btn';
      bookBtn.style.marginTop = '12px';
      bookBtn.textContent = 'Забронировать';
      form.appendChild(bookBtn);
      content.appendChild(form);

      const today = toDateStr(new Date());
      form.querySelector('#bookDateFrom').min = today;
      form.querySelector('#bookDateTo').min = today;
      form.querySelector('#bookDateFrom').value = today;

      bookBtn.addEventListener('click', async () => {
        const dateFrom = form.querySelector('#bookDateFrom').value;
        const dateTo = form.querySelector('#bookDateTo').value;
        if (!dateFrom || !dateTo) {
          toast('Укажите даты аренды');
          return;
        }
        if (dateTo < dateFrom) {
          toast('Дата окончания раньше даты начала');
          return;
        }
        bookBtn.disabled = true;
        await withAgreementGate(async () => {
          await apiFetch('/bookings', { method: 'POST', body: JSON.stringify({ listingId: id, dateFrom, dateTo }) });
          toast('Заявка на бронирование отправлена владельцу!');
          document.querySelector('.confirm-overlay')?.remove();
          showTab('bookings');
        });
        bookBtn.disabled = false;
      });
    }, { wide: true });
  }

  // ---------- Lend tab ----------
  async function loadLendTab() {
    const gate = document.getElementById('lendGate');
    const form = document.getElementById('listingForm');
    if (!state.me || !state.me.phone_verified) {
      gate.hidden = false;
      form.hidden = true;
    } else {
      gate.hidden = true;
      form.hidden = false;
    }
    loadMyListings();
  }

  document.getElementById('openBotFromLend').addEventListener('click', openBotChat);

  document.getElementById('listingForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const city = document.getElementById('carCity').value.trim();
    if (!isKnownCityName(city)) {
      toast('Выберите город из списка');
      return;
    }
    const payload = {
      brand: document.getElementById('carBrand').value.trim(),
      model: document.getElementById('carModel').value.trim(),
      year: Number(document.getElementById('carYear').value),
      color: document.getElementById('carColor').value.trim(),
      plate: document.getElementById('carPlate').value.trim(),
      city,
      carClass: document.getElementById('carClass').value,
      transmission: document.getElementById('carTransmission').value,
      fuelType: document.getElementById('carFuelType').value,
      seats: Number(document.getElementById('carSeats').value),
      pricePerDay: Number(document.getElementById('carPricePerDay').value),
      deposit: Number(document.getElementById('carDeposit').value || 0),
      minRentalDays: Number(document.getElementById('carMinRentalDays').value || 1),
      mileageLimit: document.getElementById('carMileageLimit').value ? Number(document.getElementById('carMileageLimit').value) : undefined,
      restrictions: document.getElementById('carRestrictions').value.trim(),
      description: document.getElementById('carDescription').value.trim(),
    };
    const form = e.target;
    const photoFile = document.getElementById('carPhotoInput').files?.[0];
    await withAgreementGate(async () => {
      const { listing } = await apiFetch('/cars', { method: 'POST', body: JSON.stringify(payload) });

      // Фото выбирали прямо в форме создания — сразу загружаем его к только
      // что созданному объявлению, чтобы не заставлять искать отдельную
      // кнопку загрузки после публикации (см. жалобу "не вижу добавить фото").
      if (photoFile) {
        try {
          const formData = new FormData();
          formData.append('photos', photoFile);
          await apiUpload(`/cars/${listing.id}/photos`, formData);
          toast('Объявление опубликовано вместе с фото!');
        } catch (err) {
          toast(`Объявление опубликовано, но фото загрузить не удалось: ${err.message}`);
        }
      } else {
        toast('Объявление опубликовано! Фото можно добавить в любой момент ниже.');
      }

      form.reset();
      document.getElementById('carPhotoPreview').innerHTML = '';
      document.getElementById('carSeats').value = 5;
      document.getElementById('carMinRentalDays').value = 1;
      document.getElementById('carDeposit').value = 0;
      await loadMyListings();
      document
        .querySelector(`.photos-toggle-btn[data-listing-id="${listing.id}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });

  document.getElementById('carPhotoInput').addEventListener('change', (e) => {
    const preview = document.getElementById('carPhotoPreview');
    preview.innerHTML = '';
    const file = e.target.files?.[0];
    if (!file) return;
    const img = document.createElement('img');
    img.src = URL.createObjectURL(file);
    preview.appendChild(img);
  });

  function myListingCardHtml(listing) {
    const statusBadge = `<span class="badge ${listing.status === 'active' ? 'ok' : listing.status === 'paused' ? 'paused' : 'cancelled'}">${LISTING_STATUS_LABELS[listing.status] || listing.status}</span>`;
    const actions = listing.status === 'deleted' ? '' : `
      ${listing.status === 'active'
        ? `<button type="button" class="btn secondary small pause-listing-btn" data-listing-id="${listing.id}">Приостановить</button>`
        : `<button type="button" class="btn small activate-listing-btn" data-listing-id="${listing.id}">Активировать</button>`}
      <button type="button" class="btn secondary small delete-listing-btn" data-listing-id="${listing.id}">Удалить</button>
      <button type="button" class="btn small photos-toggle-btn" data-listing-id="${listing.id}">📷 Добавить фото</button>
    `;
    return `
      <div class="card car-card">
        <div class="row">
          <div class="route">${escapeHtml(listing.brand)} ${escapeHtml(listing.model)} (${listing.year})</div>
          ${statusBadge}
        </div>
        <div class="meta">
          <span>${escapeHtml(listing.city)}</span>
          <span>${listing.price_per_day} ₽/сутки</span>
          <span>${escapeHtml(listing.plate)}</span>
        </div>
        ${actions}
        <div class="photos-panel" id="photos-${listing.id}" hidden></div>
      </div>`;
  }

  async function loadMyListings() {
    const list = document.getElementById('myListingsList');
    const empty = document.getElementById('myListingsEmpty');
    empty.hidden = true;
    list.innerHTML = skeletonHtml(2);
    try {
      const { listings } = await apiFetch('/cars/mine');
      const visible = listings.filter((l) => l.status !== 'deleted');
      empty.hidden = visible.length > 0;
      list.innerHTML = visible.map(myListingCardHtml).join('');
    } catch (err) {
      list.innerHTML = '';
      toast(err.message);
    }
  }

  // Разрешено ровно одно фото на объявление (см. server/routes/cars.ts) — чтобы
  // заменить, сначала нужно удалить текущее, поэтому панель показывает либо
  // фото с кнопкой удаления, либо форму загрузки, но никогда оба сразу.
  function photosPanelContent(listingId, photos, photoIds) {
    const hasPhoto = photos && photos.length > 0;
    if (hasPhoto) {
      const src = `/uploads/${photos[0].replace(/^\/?uploads\//, '')}`;
      const photoId = (photoIds && photoIds[0]) || '';
      return `
        <div class="photo-thumbs"><img class="car-photo-thumb" src="${src}" alt="" data-full="${src}" /></div>
        <button type="button" class="btn secondary small photo-delete-btn" data-listing-id="${listingId}" data-photo-id="${photoId}" style="margin-top:8px;">Удалить фото</button>
      `;
    }
    return `
      <p class="empty" style="padding:4px;">Фото ещё не загружено (доступно 1 фото на объявление)</p>
      <input type="file" class="photos-input" data-listing-id="${listingId}" accept="image/jpeg,image/png,image/webp" />
      <div class="file-thumbs" data-preview="${listingId}"></div>
      <button type="button" class="btn small photos-upload-btn" data-listing-id="${listingId}" style="margin-top:8px;">Загрузить фото</button>
      <div class="upload-progress" data-progress="${listingId}"></div>
    `;
  }

  document.getElementById('myListingsList').addEventListener('click', async (e) => {
    const pauseBtn = e.target.closest('.pause-listing-btn');
    const activateBtn = e.target.closest('.activate-listing-btn');
    const deleteBtn = e.target.closest('.delete-listing-btn');
    const photosBtn = e.target.closest('.photos-toggle-btn');
    const uploadBtn = e.target.closest('.photos-upload-btn');
    const deletePhotoBtn = e.target.closest('.photo-delete-btn');

    if (pauseBtn || activateBtn) {
      const id = (pauseBtn || activateBtn).dataset.listingId;
      const action = pauseBtn ? 'pause' : 'activate';
      try {
        await apiFetch(`/cars/${id}/${action}`, { method: 'POST' });
        toast(action === 'pause' ? 'Объявление приостановлено' : 'Объявление активировано');
        loadMyListings();
      } catch (err) { toast(err.message); }
      return;
    }
    if (deleteBtn) {
      const id = deleteBtn.dataset.listingId;
      if (!(await askConfirm('Удалить объявление? Действие необратимо.'))) return;
      try {
        await apiFetch(`/cars/${id}/delete`, { method: 'POST' });
        toast('Объявление удалено');
        loadMyListings();
      } catch (err) { toast(err.message); }
      return;
    }
    if (photosBtn) {
      const id = photosBtn.dataset.listingId;
      const panel = document.getElementById(`photos-${id}`);
      if (!panel.hidden) { panel.hidden = true; return; }
      panel.hidden = false;
      panel.innerHTML = '<p class="empty">Загрузка...</p>';
      try {
        const { listing } = await apiFetch(`/cars/${id}`);
        panel.innerHTML = photosPanelContent(id, listing.photos, listing.photoIds);
      } catch (err) {
        panel.innerHTML = `<p class="empty">${escapeHtml(err.message)}</p>`;
      }
      return;
    }
    if (uploadBtn) {
      const id = uploadBtn.dataset.listingId;
      const panel = document.getElementById(`photos-${id}`);
      const input = panel.querySelector('.photos-input');
      const files = input?.files;
      if (!files || !files.length) {
        toast('Выберите файл');
        return;
      }
      const progress = panel.querySelector('[data-progress]');
      uploadBtn.disabled = true;
      progress.textContent = 'Загрузка…';
      const formData = new FormData();
      formData.append('photos', files[0]);
      try {
        await apiUpload(`/cars/${id}/photos`, formData);
        toast('Фото загружено');
        const { listing } = await apiFetch(`/cars/${id}`);
        panel.innerHTML = photosPanelContent(id, listing.photos, listing.photoIds);
      } catch (err) {
        toast(err.message);
        progress.textContent = '';
        uploadBtn.disabled = false;
      }
      return;
    }
    if (deletePhotoBtn) {
      const id = deletePhotoBtn.dataset.listingId;
      const photoId = deletePhotoBtn.dataset.photoId;
      if (!(await askConfirm('Удалить фото?'))) return;
      try {
        await apiFetch(`/cars/${id}/photos/${photoId}/delete`, { method: 'POST' });
        toast('Фото удалено');
        const panel = document.getElementById(`photos-${id}`);
        const { listing } = await apiFetch(`/cars/${id}`);
        panel.innerHTML = photosPanelContent(id, listing.photos, listing.photoIds);
      } catch (err) {
        toast(err.message);
      }
    }
  });

  document.getElementById('myListingsList').addEventListener('change', (e) => {
    const input = e.target.closest('.photos-input');
    if (!input) return;
    const id = input.dataset.listingId;
    const preview = document.querySelector(`[data-preview="${id}"]`);
    if (!preview) return;
    preview.innerHTML = '';
    Array.from(input.files || []).slice(0, 1).forEach((file) => {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(file);
      preview.appendChild(img);
    });
  });

  // ---------- Bookings tab ----------
  document.getElementById('bookingsSubSwitch').addEventListener('click', (e) => {
    const btn = e.target.closest('.dir-btn');
    if (!btn) return;
    document.querySelectorAll('#bookingsSubSwitch .dir-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.bookingsSub = btn.dataset.bookingsTab;
    document.getElementById('bookingsRenterSection').hidden = state.bookingsSub !== 'renter';
    document.getElementById('bookingsOwnerSection').hidden = state.bookingsSub !== 'owner';
    loadBookingsTab();
  });

  function contactLine(booking, asOwner) {
    if (booking.status !== 'confirmed' && booking.status !== 'completed') return '';
    if (asOwner) {
      return booking.renter_phone
        ? `<div class="contact-row"><strong>Арендатор:</strong> ${escapeHtml(booking.renter_full_name || booking.renter_first_name)}${booking.renter_username ? ' · @' + escapeHtml(booking.renter_username) : ''}<br>Тел.: ${escapeHtml(booking.renter_phone)}</div>`
        : '';
    }
    return booking.owner_phone
      ? `<div class="contact-row"><strong>Владелец:</strong> ${escapeHtml(booking.owner_full_name || booking.owner_first_name)}${booking.owner_username ? ' · @' + escapeHtml(booking.owner_username) : ''}<br>Тел.: ${escapeHtml(booking.owner_phone)}</div>`
      : '';
  }

  function contractButtonHtml(booking) {
    if (booking.status !== 'confirmed' && booking.status !== 'completed') return '';
    return `<button type="button" class="btn secondary small contract-btn" data-booking-id="${booking.id}">Сформировать договор аренды</button>`;
  }

  function renterBookingCardHtml(booking) {
    const badgeClass = booking.status === 'confirmed' ? 'ok' : booking.status === 'pending' ? 'pending' : booking.status === 'completed' ? 'completed' : 'cancelled';
    const canCancel = booking.status === 'pending' || booking.status === 'confirmed';
    const rentalOver = new Date(`${booking.date_to}T23:59:59`).getTime() < Date.now();
    let rateBlock = '';
    if (booking.status === 'completed' || (booking.status === 'confirmed' && rentalOver)) {
      rateBlock = booking.owner_rated
        ? '<div class="rating-line">Вы уже оценили владельца ✅</div>'
        : `<div class="rate-widget" data-booking-id="${booking.id}" data-target="owner">
            ${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="star-btn" data-star="${n}">★</button>`).join('')}
            <button type="button" class="btn small rate-submit-btn" disabled>Оценить владельца</button>
          </div>`;
    }
    return `
      <div class="card car-card">
        <div class="row">
          <div class="route">${escapeHtml(booking.brand)} ${escapeHtml(booking.model)} (${booking.year})</div>
          <span class="badge ${badgeClass}">${BOOKING_STATUS_LABELS[booking.status] || booking.status}</span>
        </div>
        <div class="meta">
          <span>🗓 ${formatDate(booking.date_from)} — ${formatDate(booking.date_to)}</span>
          <span>${escapeHtml(booking.city)}</span>
        </div>
        <div class="price">${booking.total_price} ₽${booking.deposit ? ` + залог ${booking.deposit} ₽` : ''}</div>
        ${contactLine(booking, false)}
        ${booking.cancellation_reason ? `<div class="comment">Причина отмены: ${escapeHtml(booking.cancellation_reason)}</div>` : ''}
        ${canCancel ? `<button type="button" class="btn secondary small cancel-booking-btn" data-booking-id="${booking.id}">Отменить бронь</button>` : ''}
        ${contractButtonHtml(booking)}
        ${rateBlock}
      </div>`;
  }

  function ownerBookingCardHtml(booking) {
    const badgeClass = booking.status === 'confirmed' ? 'ok' : booking.status === 'pending' ? 'pending' : booking.status === 'completed' ? 'completed' : 'cancelled';
    const rentalOver = new Date(`${booking.date_to}T23:59:59`).getTime() < Date.now();
    let rateBlock = '';
    if (booking.status === 'completed' || (booking.status === 'confirmed' && rentalOver)) {
      rateBlock = booking.renter_rated
        ? '<div class="rating-line">Вы уже оценили арендатора ✅</div>'
        : `<div class="rate-widget" data-booking-id="${booking.id}" data-target="renter">
            ${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="star-btn" data-star="${n}">★</button>`).join('')}
            <button type="button" class="btn small rate-submit-btn" disabled>Оценить арендатора</button>
          </div>`;
    }
    return `
      <div class="card car-card">
        <div class="row">
          <div class="route">${escapeHtml(booking.brand)} ${escapeHtml(booking.model)} (${booking.year})</div>
          <span class="badge ${badgeClass}">${BOOKING_STATUS_LABELS[booking.status] || booking.status}</span>
        </div>
        <div class="meta">
          <span>🗓 ${formatDate(booking.date_from)} — ${formatDate(booking.date_to)}</span>
        </div>
        <div class="owner">Арендатор: ${escapeHtml(booking.renter_full_name || booking.renter_first_name)}${booking.renter_username ? ' · @' + escapeHtml(booking.renter_username) : ''}</div>
        <div class="price">${booking.total_price} ₽${booking.deposit ? ` + залог ${booking.deposit} ₽` : ''}</div>
        ${contactLine(booking, true)}
        ${booking.cancellation_reason ? `<div class="comment">Причина отмены: ${escapeHtml(booking.cancellation_reason)}</div>` : ''}
        ${booking.status === 'pending' ? `
          <button type="button" class="btn small confirm-booking-btn" data-booking-id="${booking.id}">Подтвердить</button>
          <button type="button" class="btn secondary small decline-booking-btn" data-booking-id="${booking.id}">Отклонить</button>
        ` : ''}
        ${contractButtonHtml(booking)}
        ${rateBlock}
      </div>`;
  }

  function renterContactCardHtml(r) {
    const badge = `<span class="badge ${r.status === 'confirmed' ? 'ok' : r.status === 'declined' ? 'cancelled' : 'pending'}">${CONTACT_STATUS_LABELS[r.status] || r.status}</span>`;
    const phoneLine = r.status === 'confirmed'
      ? `<div class="owner">Телефон владельца: ${escapeHtml(r.owner_phone || 'не указан')}</div>`
      : '';
    return `
      <div class="card">
        <div class="row">
          <div class="route">${escapeHtml(r.brand)} ${escapeHtml(r.model)}</div>
          ${badge}
        </div>
        <div class="meta"><span>${escapeHtml(r.city)}</span></div>
        <div class="owner">Владелец: ${escapeHtml(r.owner_full_name || r.owner_first_name)}${r.owner_username ? ' · @' + escapeHtml(r.owner_username) : ''}</div>
        ${phoneLine}
      </div>`;
  }

  function ownerContactCardHtml(r) {
    const badge = `<span class="badge ${r.status === 'confirmed' ? 'ok' : r.status === 'declined' ? 'cancelled' : 'pending'}">${CONTACT_STATUS_LABELS[r.status] || r.status}</span>`;
    const phoneLine = r.status === 'confirmed'
      ? `<div class="owner">Телефон арендатора: ${escapeHtml(r.renter_phone || 'не указан')}</div>`
      : '';
    const actions = r.status === 'pending'
      ? `<div class="confirm-actions" style="margin-top:8px;">
          <button type="button" class="btn small confirm-contact-btn" data-request-id="${r.id}">Показать контакты</button>
          <button type="button" class="btn secondary small decline-contact-btn" data-request-id="${r.id}">Отклонить</button>
        </div>`
      : '';
    return `
      <div class="card">
        <div class="row">
          <div class="route">${escapeHtml(r.brand)} ${escapeHtml(r.model)}</div>
          ${badge}
        </div>
        <div class="meta"><span>${escapeHtml(r.city)}</span></div>
        <div class="owner">Арендатор: ${escapeHtml(r.renter_full_name || r.renter_first_name)}${r.renter_username ? ' · @' + escapeHtml(r.renter_username) : ''}</div>
        ${phoneLine}
        ${actions}
      </div>`;
  }

  document.getElementById('ownerContactsList').addEventListener('click', async (e) => {
    const confirmBtn = e.target.closest('.confirm-contact-btn');
    const declineBtn = e.target.closest('.decline-contact-btn');
    if (!confirmBtn && !declineBtn) return;
    const id = (confirmBtn || declineBtn).dataset.requestId;
    const action = confirmBtn ? 'confirm' : 'decline';
    try {
      await apiFetch(`/contact-requests/${id}/${action}`, { method: 'POST' });
      toast(action === 'confirm' ? 'Контакты арендатора теперь видны' : 'Запрос отклонён');
      loadBookingsTab();
    } catch (err) {
      toast(err.message);
    }
  });

  async function loadBookingsTab() {
    if (state.bookingsSub === 'renter') {
      const contactsList = document.getElementById('renterContactsList');
      const contactsEmpty = document.getElementById('renterContactsEmpty');
      try {
        const { requests } = await apiFetch('/contact-requests/mine');
        contactsEmpty.hidden = requests.length > 0;
        contactsList.innerHTML = requests.map(renterContactCardHtml).join('');
      } catch (err) {
        contactsList.innerHTML = '';
      }

      const list = document.getElementById('renterBookingsList');
      const empty = document.getElementById('renterBookingsEmpty');
      empty.hidden = true;
      list.innerHTML = skeletonHtml(2);
      try {
        const { bookings } = await apiFetch('/bookings/mine');
        empty.hidden = bookings.length > 0;
        list.innerHTML = bookings.map(renterBookingCardHtml).join('');
      } catch (err) {
        list.innerHTML = '';
        toast(err.message);
      }
    } else {
      const contactsList = document.getElementById('ownerContactsList');
      const contactsEmpty = document.getElementById('ownerContactsEmpty');
      try {
        const { requests } = await apiFetch('/contact-requests/owner');
        contactsEmpty.hidden = requests.length > 0;
        contactsList.innerHTML = requests.map(ownerContactCardHtml).join('');
      } catch (err) {
        contactsList.innerHTML = '';
      }

      const list = document.getElementById('ownerBookingsList');
      const empty = document.getElementById('ownerBookingsEmpty');
      empty.hidden = true;
      list.innerHTML = skeletonHtml(2);
      try {
        const { bookings } = await apiFetch('/bookings/owner');
        empty.hidden = bookings.length > 0;
        list.innerHTML = bookings.map(ownerBookingCardHtml).join('');
        const confirmedCount = bookings.filter((b) => b.status === 'confirmed' || b.status === 'completed').length;
        const earnings = bookings.filter((b) => b.status !== 'cancelled').reduce((sum, b) => sum + b.total_price, 0);
        document.getElementById('ownerStats').innerHTML = `
          <div class="stat-tile"><div class="value">${bookings.length}</div><div class="label">Всего броней</div></div>
          <div class="stat-tile"><div class="value">${confirmedCount}</div><div class="label">Подтверждено</div></div>
        `;
      } catch (err) {
        list.innerHTML = '';
        toast(err.message);
      }
    }
  }

  async function openContract(bookingId) {
    const mode = platformMode();
    if (mode === 'web') {
      window.open(`/api/legal/contract/${bookingId}`, '_blank');
      return;
    }
    // Inside a Mini App webview, window.open() carries no init-data header
    // (it's not a fetch call) — fetch the HTML ourselves and show it in an
    // in-page iframe overlay instead, which sidesteps popup blockers too.
    try {
      const html = await apiFetchText(`/legal/contract/${bookingId}`);
      const overlay = document.createElement('div');
      overlay.className = 'overlay-full';
      const header = document.createElement('div');
      header.className = 'overlay-full-header';
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'btn secondary small';
      closeBtn.textContent = '✕ Закрыть';
      header.appendChild(closeBtn);
      const iframe = document.createElement('iframe');
      // Server-generated static contract document — the one place srcdoc
      // with server content (not raw user input) is acceptable.
      iframe.srcdoc = html;
      overlay.append(header, iframe);
      closeBtn.addEventListener('click', () => overlay.remove());
      document.body.appendChild(overlay);
    } catch (err) {
      toast(err.message);
    }
  }

  function attachBookingListHandlers(listId, asOwner) {
    document.getElementById(listId).addEventListener('click', async (e) => {
      const cancelBtn = e.target.closest('.cancel-booking-btn');
      const confirmBtn = e.target.closest('.confirm-booking-btn');
      const declineBtn = e.target.closest('.decline-booking-btn');
      const contractBtn = e.target.closest('.contract-btn');
      const starBtn = e.target.closest('.star-btn');
      const rateSubmitBtn = e.target.closest('.rate-submit-btn');

      if (cancelBtn) {
        const reason = await askConfirmWithReason('Отменить бронирование?', 'Отменить');
        if (reason === null) return;
        try {
          await apiFetch(`/bookings/${cancelBtn.dataset.bookingId}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) });
          toast('Бронирование отменено');
          loadBookingsTab();
        } catch (err) { toast(err.message); }
        return;
      }
      if (confirmBtn) {
        try {
          await apiFetch(`/bookings/${confirmBtn.dataset.bookingId}/confirm`, { method: 'POST' });
          toast('Бронь подтверждена, контакты арендатора теперь доступны');
          loadBookingsTab();
        } catch (err) { toast(err.message); }
        return;
      }
      if (declineBtn) {
        const reason = await askConfirmWithReason('Отклонить бронирование?', 'Отклонить');
        if (reason === null) return;
        try {
          await apiFetch(`/bookings/${declineBtn.dataset.bookingId}/decline`, { method: 'POST', body: JSON.stringify({ reason }) });
          toast('Бронирование отклонено');
          loadBookingsTab();
        } catch (err) { toast(err.message); }
        return;
      }
      if (contractBtn) {
        openContract(contractBtn.dataset.bookingId);
        return;
      }
      if (starBtn) {
        const widget = starBtn.closest('.rate-widget');
        const value = Number(starBtn.dataset.star);
        widget.dataset.selected = value;
        widget.querySelectorAll('.star-btn').forEach((b) => b.classList.toggle('filled', Number(b.dataset.star) <= value));
        widget.querySelector('.rate-submit-btn').disabled = false;
        return;
      }
      if (rateSubmitBtn) {
        const widget = rateSubmitBtn.closest('.rate-widget');
        const rating = Number(widget.dataset.selected);
        const bookingId = Number(widget.dataset.bookingId);
        const target = widget.dataset.target;
        rateSubmitBtn.disabled = true;
        try {
          await apiFetch(target === 'owner' ? '/ratings' : '/ratings/renter', {
            method: 'POST',
            body: JSON.stringify({ bookingId, rating }),
          });
          toast('Спасибо за оценку!');
          loadBookingsTab();
        } catch (err) {
          toast(err.message);
          rateSubmitBtn.disabled = false;
        }
      }
    });
  }
  attachBookingListHandlers('renterBookingsList', false);
  attachBookingListHandlers('ownerBookingsList', true);

  // ---------- Profile tab ----------
  async function loadProfileTab() {
    try {
      const { user, isAdmin, ownerRating, renterRating } = await apiFetch('/users/me');
      state.me = user;
      state.isAdmin = isAdmin;
      document.getElementById('adminTabBtn').hidden = !isAdmin;
      const card = document.getElementById('profileCard');
      card.innerHTML = `
        <div class="profile-row"><span class="label">Имя</span><span>${escapeHtml(user.full_name || '—')}</span></div>
        <div class="profile-row"><span class="label">Username</span><span>${user.username ? '@' + escapeHtml(user.username) : '—'}</span></div>
        <div class="profile-row"><span class="label">Платформа</span><span>${user.platform === 'max' ? 'MAX' : 'Telegram'}</span></div>
        <div class="profile-row"><span class="label">Телефон</span><span>${user.phone_verified ? '✅ подтверждён' : '❌ не подтверждён'}</span></div>
        ${ownerRating?.count ? `<div class="profile-row"><span class="label">Рейтинг как владелец</span><span>${starsHtml(ownerRating.avg, ownerRating.count)}</span></div>` : ''}
        ${renterRating?.count ? `<div class="profile-row"><span class="label">Рейтинг как арендатор</span><span>${starsHtml(renterRating.avg, renterRating.count)}</span></div>` : ''}
      `;
      document.getElementById('logoutCard').hidden = platformMode() !== 'web';

      if (!state.botUsername) {
        try {
          const cfg = await apiFetch('/config');
          state.botUsername = cfg.botUsername;
        } catch (e) { /* ignore */ }
      }
      const supportLink = document.getElementById('supportTelegramLink');
      if (state.botUsername) {
        supportLink.href = `https://t.me/${state.botUsername}`;
        supportLink.hidden = false;
      }
    } catch (err) {
      toast(err.message);
    }
  }

  document.getElementById('supportSendBtn').addEventListener('click', async () => {
    const textarea = document.getElementById('supportMessage');
    const message = textarea.value.trim();
    if (!message) { toast('Введите текст сообщения'); return; }
    try {
      await apiFetch('/support', { method: 'POST', body: JSON.stringify({ message }) });
      textarea.value = '';
      toast('Сообщение отправлено в поддержку');
    } catch (err) { toast(err.message); }
  });

  document.getElementById('logoutAllBtn').addEventListener('click', async () => {
    if (!(await askConfirm('Выйти со всех устройств? Все браузерные сессии будут завершены, включая эту.'))) return;
    try {
      await apiFetch('/auth/logout-all', { method: 'POST' });
      location.reload();
    } catch (err) { toast(err.message); }
  });

  // ---------- Admin tab ----------
  document.getElementById('adminSubSwitch').addEventListener('click', (e) => {
    const btn = e.target.closest('.dir-btn');
    if (!btn) return;
    document.querySelectorAll('#adminSubSwitch .dir-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.adminSub = btn.dataset.adminTab;
    document.getElementById('adminUsersList').hidden = state.adminSub !== 'users';
    document.getElementById('adminListingsList').hidden = state.adminSub !== 'listings';
    document.getElementById('adminBookingsList').hidden = state.adminSub !== 'bookings';
    document.getElementById('adminSupportList').hidden = state.adminSub !== 'support';
    document.getElementById('adminBroadcastPanel').hidden = state.adminSub !== 'broadcast';
  });

  async function loadAdminTab() {
    try {
      const { stats } = await apiFetch('/admin/stats');
      document.getElementById('adminStats').innerHTML = `
        <div class="stat-tile"><div class="value">${stats.totalUsers}</div><div class="label">Пользователей</div></div>
        <div class="stat-tile"><div class="value">${stats.onlineUsers}</div><div class="label">Онлайн</div></div>
        <div class="stat-tile"><div class="value">${stats.verifiedUsers}</div><div class="label">Подтверждено</div></div>
        <div class="stat-tile"><div class="value">${stats.bannedUsers}</div><div class="label">Заблокировано</div></div>
        <div class="stat-tile"><div class="value">${stats.activeListings}</div><div class="label">Активных объявлений</div></div>
        <div class="stat-tile"><div class="value">${stats.totalBookings}</div><div class="label">Всего броней</div></div>
      `;
    } catch (err) { toast(err.message); }

    try {
      const { users } = await apiFetch('/admin/users');
      document.getElementById('adminUsersList').innerHTML = users.map((u) => `
        <div class="card car-card">
          <div class="row">
            <div class="route">${escapeHtml(u.full_name || u.first_name)}${u.username ? ' · @' + escapeHtml(u.username) : ''}</div>
            <span class="badge ${u.banned ? 'full' : u.phone_verified ? 'ok' : 'cancelled'}">${u.banned ? 'заблокирован' : u.phone_verified ? 'телефон подтверждён' : 'не подтверждён'}</span>
          </div>
          <div class="meta">
            <span class="badge platform-${u.platform === 'max' ? 'max' : 'telegram'}">${u.platform === 'max' ? 'MAX' : 'Telegram'}</span>
            <span>ID: ${Math.abs(u.telegram_id)}</span>
            ${u.phone ? `<span>${escapeHtml(u.phone)}</span>` : ''}
          </div>
          <button type="button" class="btn ${u.banned ? '' : 'secondary'} small ban-toggle-btn" data-telegram-id="${u.telegram_id}" data-action="${u.banned ? 'unban' : 'ban'}">
            ${u.banned ? 'Разблокировать' : 'Заблокировать'}
          </button>
        </div>
      `).join('') || '<p class="empty">Пока никто не зарегистрирован.</p>';
    } catch (err) { toast(err.message); }

    try {
      const { listings } = await apiFetch('/admin/listings');
      document.getElementById('adminListingsList').innerHTML = listings.map((l) => carCardHtml(l)).join('') || '<p class="empty">Объявлений пока нет.</p>';
    } catch (err) { toast(err.message); }

    try {
      const { bookings } = await apiFetch('/admin/bookings');
      document.getElementById('adminBookingsList').innerHTML = bookings.map((b) => `
        <div class="card car-card">
          <div class="row">
            <div class="route">${escapeHtml(b.brand)} ${escapeHtml(b.model)}</div>
            <span class="badge ${b.status === 'confirmed' ? 'ok' : b.status === 'pending' ? 'pending' : 'cancelled'}">${BOOKING_STATUS_LABELS[b.status] || b.status}</span>
          </div>
          <div class="meta"><span>🗓 ${formatDate(b.date_from)} — ${formatDate(b.date_to)}</span><span>${b.total_price} ₽</span></div>
          <div class="owner">Арендатор: ${escapeHtml(b.renter_first_name)}${b.renter_username ? ' · @' + escapeHtml(b.renter_username) : ''}</div>
          <div class="owner">Владелец: ${escapeHtml(b.owner_first_name)}${b.owner_username ? ' · @' + escapeHtml(b.owner_username) : ''}</div>
        </div>
      `).join('') || '<p class="empty">Бронирований пока нет.</p>';
    } catch (err) { toast(err.message); }

    try {
      const { messages } = await apiFetch('/admin/support');
      document.getElementById('adminSupportList').innerHTML = messages.map((m) => `
        <div class="card car-card ${m.from_admin ? 'support-from-admin' : ''}">
          <div class="row">
            <div class="route">${m.from_admin ? 'Вы →' : ''} ${escapeHtml(m.full_name || m.first_name || '')}${m.username ? ' · @' + escapeHtml(m.username) : ''}</div>
            <span class="badge ok">${formatDate(m.created_at)}</span>
          </div>
          <p>${escapeHtml(m.message)}</p>
          ${!m.from_admin ? `
            <div class="support-reply">
              <input type="text" class="reply-input" data-user-id="${m.telegram_id}" maxlength="1000" placeholder="Ответ..." />
              <button type="button" class="reply-send-btn" data-user-id="${m.telegram_id}">Отправить</button>
            </div>` : ''}
        </div>
      `).join('') || '<p class="empty">Сообщений пока нет.</p>';
    } catch (err) { toast(err.message); }
  }

  document.getElementById('adminUsersList').addEventListener('click', async (e) => {
    const btn = e.target.closest('.ban-toggle-btn');
    if (!btn) return;
    const id = btn.dataset.telegramId;
    const action = btn.dataset.action;
    if (!(await askConfirm(action === 'ban' ? 'Заблокировать пользователя?' : 'Разблокировать пользователя?'))) return;
    try {
      await apiFetch(`/admin/users/${id}/${action}`, { method: 'POST' });
      toast(action === 'ban' ? 'Пользователь заблокирован' : 'Пользователь разблокирован');
      loadAdminTab();
    } catch (err) { toast(err.message); }
  });

  document.getElementById('adminSupportList').addEventListener('click', async (e) => {
    const btn = e.target.closest('.reply-send-btn');
    if (!btn) return;
    const userId = btn.dataset.userId;
    const input = document.querySelector(`.reply-input[data-user-id="${userId}"]`);
    const message = input.value.trim();
    if (!message) { toast('Введите текст ответа'); return; }
    btn.disabled = true;
    try {
      await apiFetch(`/admin/support/${userId}/reply`, { method: 'POST', body: JSON.stringify({ message }) });
      toast('Ответ отправлен');
      loadAdminTab();
    } catch (err) {
      toast(err.message);
      btn.disabled = false;
    }
  });

  document.getElementById('broadcastPhotoInput').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    const preview = document.getElementById('broadcastPhotoPreview');
    if (!file) { preview.style.display = 'none'; return; }
    preview.src = URL.createObjectURL(file);
    preview.style.display = 'block';
  });

  document.getElementById('broadcastSendBtn').addEventListener('click', async () => {
    const message = document.getElementById('broadcastMessage').value.trim();
    const file = document.getElementById('broadcastPhotoInput').files?.[0];
    const pin = document.getElementById('broadcastPinInput').checked;
    if (!message && !file) { toast('Добавьте текст или фото'); return; }
    if (!(await askConfirm('Отправить сообщение всем пользователям?'))) return;
    const btn = document.getElementById('broadcastSendBtn');
    btn.disabled = true;
    try {
      const formData = new FormData();
      if (message) formData.append('message', message);
      if (file) formData.append('photo', file);
      if (pin) formData.append('pin', 'true');
      const { total } = await apiUpload('/admin/broadcast', formData);
      toast(`Рассылка запущена: ${total} получателей`);
      document.getElementById('broadcastMessage').value = '';
      document.getElementById('broadcastPhotoInput').value = '';
      document.getElementById('broadcastPhotoPreview').style.display = 'none';
    } catch (err) {
      toast(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  // ---------- Boot ----------
  async function boot() {
    let user;
    try {
      const data = await apiFetch('/users/me');
      user = data.user;
      state.isAdmin = data.isAdmin;
    } catch (err) {
      if (err.status === 401) {
        showBrowserLoginGate();
        return;
      }
      toast(err.message);
      return;
    }
    state.me = user;

    if (user.banned && !state.isAdmin) { showAppGate('banned'); return; }
    if (!user.phone_verified && !state.isAdmin) { showAppGate('phone'); return; }
    if (!user.full_name && !state.isAdmin) { showAppGate('name'); return; }

    hideAppGate();
    document.getElementById('adminTabBtn').hidden = !state.isAdmin;

    // Диплинк из уведомлений бота (?tab=bookings&contract=<id>, см.
    // bot/notifier.ts::notifyContractReady) — открывает нужную вкладку и,
    // если передан ID брони, сразу показывает договор аренды, а не просто
    // высаживает пользователя на экран поиска.
    const params = new URLSearchParams(location.search);
    const deepLinkTab = params.get('tab');
    if (deepLinkTab && TABS.includes(deepLinkTab)) state.activeTab = deepLinkTab;
    showTab(state.activeTab);

    const contractId = params.get('contract');
    if (contractId && /^\d+$/.test(contractId)) {
      openContract(contractId);
    }
  }

  async function init() {
    await waitForPlatformSdk(1500);
    tg = window.Telegram?.WebApp || null;
    maxApp = window.WebApp || null;

    if (tg) {
      try {
        tg.ready();
        tg.expand();
        const syncColorScheme = () => {
          document.documentElement.style.colorScheme = tg.colorScheme === 'dark' ? 'dark' : 'light';
          if (tg.themeParams) {
            const root = document.documentElement.style;
            const map = {
              bg_color: '--tg-theme-bg-color',
              secondary_bg_color: '--tg-theme-secondary-bg-color',
              text_color: '--tg-theme-text-color',
              hint_color: '--tg-theme-hint-color',
              link_color: '--tg-theme-link-color',
              button_color: '--tg-theme-button-color',
              button_text_color: '--tg-theme-button-text-color',
            };
            Object.entries(map).forEach(([key, cssVar]) => {
              if (tg.themeParams[key]) root.setProperty(cssVar, tg.themeParams[key]);
            });
          }
        };
        syncColorScheme();
        if (typeof tg.onEvent === 'function') tg.onEvent('themeChanged', syncColorScheme);
      } catch (err) {
        // Defensive — a bridge quirk shouldn't block boot.
      }
    } else if (maxApp) {
      // MAX Bridge API surface isn't fully documented — feature-detect and
      // wrap every call, degrading to the plain-web login flow on any throw.
      try {
        if (typeof maxApp.ready === 'function') maxApp.ready();
      } catch (err) {
        maxApp = null;
      }
    }

    document.getElementById('toast').hidden = true;
    loadCities();

    try {
      const cfg = await apiFetch('/config');
      state.botUsername = cfg.botUsername;
      const already = sessionStorage.getItem('appVersionReloadFor');
      if (cfg.appVersion && cfg.appVersion !== APP_VERSION && already !== cfg.appVersion) {
        sessionStorage.setItem('appVersionReloadFor', cfg.appVersion);
        location.reload();
        return;
      }
    } catch (err) { /* non-critical */ }

    await boot();
  }

  init();
})();
