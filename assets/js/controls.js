/* 原生底部面板：查看方式、筛选和标签编辑。 */

(() => {

  'use strict';

  const browse = document.getElementById('browseSheet');

  const tags = document.getElementById('tagSheet');

  const content = document.getElementById('tagContent');

  const status = document.getElementById('tagStatus');

  const meta = window.PLANET_META;

  let tagPhoto = null;

  function el(tag, text, className) {

    const node = document.createElement(tag);

    if (text !== undefined) node.textContent = text;

    if (className) node.className = className;

    return node;

  }

  function show(dialog) {

    status.textContent = '';

    if (!dialog.open) dialog.showModal();

    document.body.classList.add('sheet-open');

  }

  for (const dialog of [browse, tags]) {

    dialog.querySelector('[data-close-sheet]').addEventListener('click', () => dialog.close());

    dialog.addEventListener('close', () => {

      if (!document.querySelector('dialog[open]')) document.body.classList.remove('sheet-open');

    });

    dialog.addEventListener('click', e => {

      if (e.target !== dialog) return;

      const r = dialog.getBoundingClientRect();

      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close();

    });

  }

  document.getElementById('browseMenu').addEventListener('click', () => show(browse));

  document.getElementById('modes').addEventListener('click', e => { if (e.target.closest('[data-mode]')) browse.close(); });

  document.getElementById('chips').addEventListener('click', e => { if (e.target.closest('[data-filter]')) browse.close(); });

  function run(action, success) {

    try { action(); status.textContent = success; }

    catch (error) { status.textContent = error.message; }

  }

  function editPhoto(photo) {

    tagPhoto = photo;

    document.getElementById('tagTitle').textContent = '给这张，记一笔';

    document.getElementById('tagIntro').textContent = '记得多少就写多少。不确定的日期，可以先空着。';

    const form = el('form');

    const label = el('label', '你想怎么记住这一天？'); label.htmlFor = 'photoTags';

    const input = el('textarea'); input.id = 'photoTags'; input.rows = 3; input.maxLength = 260;

    input.value = meta.custom(photo).join('，'); input.placeholder = '用逗号分开；留空就去掉自定义标签';

    const save = el('button', '就这样记下来', 'sheet-primary'); save.type = 'submit';

    const dates = window.PLANET_DATES;

    const fields = el('div', undefined, 'memory-fields');

    const precisionLabel = el('label', '那天，记得多少？'); precisionLabel.htmlFor = 'photoPrecision';

    const precision = el('select'); precision.id = 'photoPrecision';

    for (const [value, text] of [['unknown', '日期暂时想不起来'], ['year', '只记得哪一年'], ['month', '记得哪年哪月'], ['day', '记得具体哪一天']]) {

      const option = el('option', text); option.value = value; precision.appendChild(option);

    }

    precision.value = dates.precision(photo.takenAt);

    const dateLabel = el('label', '补记日期'); dateLabel.htmlFor = 'photoDate';

    const date = el('input'); date.id = 'photoDate'; date.autocomplete = 'off';

    const seasonLabel = el('label', '还记得是什么季节吗？'); seasonLabel.htmlFor = 'photoSeason';

    const season = el('select'); season.id = 'photoSeason';

    for (const [value, text] of [['', '季节也先空着'], ...Object.entries(dates.names)]) {

      const option = el('option', text); option.value = value; season.appendChild(option);

    }

    season.value = dates.seasonOf(photo) || '';

    const hint = el('p', '', 'sheet-footnote memory-hint');

    function syncSeason() {

      const monthSeason = precision.value === 'month' || precision.value === 'day' ? dates.fromMonth(Number(date.value.slice(5, 7))) : null;

      season.disabled = precision.value === 'month' || precision.value === 'day';

      if (monthSeason) season.value = monthSeason;

      hint.textContent = season.disabled ? '四季会跟着月份记好。' : '只记得季节也可以：选好后，就能在对应季节里翻到这张。';

    }

    function syncDate(value = '') {

      const kind = precision.value;

      date.hidden = dateLabel.hidden = kind === 'unknown';

      date.required = kind !== 'unknown';

      date.type = kind === 'month' ? 'month' : kind === 'day' ? 'date' : 'text';

      date.removeAttribute('min'); date.removeAttribute('max'); date.removeAttribute('pattern');

      if (kind === 'year') { date.inputMode = 'numeric'; date.pattern = '[12][0-9]{3}'; date.maxLength = 4; date.placeholder = '比如 2025'; }

      else { date.inputMode = 'text'; date.removeAttribute('maxlength'); date.min = kind === 'month' ? '1000-01' : '1000-01-01'; date.max = kind === 'month' ? '2999-12' : '2999-12-31'; }

      date.value = kind === 'unknown' ? '' : value.slice(0, kind === 'year' ? 4 : kind === 'month' ? 7 : 10);

      syncSeason();

    }

    syncDate(photo.takenAt || '');

    let initialPrecision = precision.value;

    let initialDate = date.value;

    let initialSeason = season.value;

    precision.addEventListener('change', () => syncDate(date.value));

    date.addEventListener('input', syncSeason);

    fields.append(precisionLabel, precision, dateLabel, date, seasonLabel, season, hint);

    const source = photo.dateSource === 'exif' ? '原始拍摄记录' : photo.dateSource === 'folder' ? '日期文件夹' : photo.dateSource === 'manual' ? '手动补记' : photo.dateSource === 'moments' ? '朋友圈发布日期（北京时间，并非原始拍摄时间）' : '暂无可靠拍摄日期';

    fields.appendChild(el('p', `日期依据：${source}。补记只保存在这台设备，可在「整理一下标签」里导出回忆备份。`, 'sheet-footnote'));

    const restore = el('button', '恢复这张的原始日期记录', 'memory-restore'); restore.type = 'button';

    restore.addEventListener('click', () => run(() => { meta.restoreDate(photo); editPhoto(photo); }, '已经恢复到相册里的原始记录。'));

    fields.appendChild(restore);
    if (photo.imageQuality === 'preview') fields.appendChild(el('p', '这张导出时只有预览图，放大可能有些模糊；以后找到原图还可以补上。', 'sheet-footnote'));

    const chatFields = el('div', undefined, 'memory-fields chat-date-fields');

    const chatLabel = el('label', '这张照片，想配哪天的话？'); chatLabel.htmlFor = 'photoChatMode';

    const chatMode = el('select'); chatMode.id = 'photoChatMode';

    for (const [value, text] of [['auto', '跟着照片的日期'], ['manual', '另外选一天的聊天']]) {

      const option = el('option', text); option.value = value; chatMode.appendChild(option);

    }

    chatMode.value = photo.chatDate ? 'manual' : 'auto';

    const chatDateLabel = el('label', '想翻到的聊天日期'); chatDateLabel.htmlFor = 'photoChatDate';

    const chatDate = el('input'); chatDate.type = 'date'; chatDate.id = 'photoChatDate'; chatDate.min = '1000-01-01'; chatDate.max = '2999-12-31';

    chatDate.value = photo.chatDate || '';

    const updateChatDate = () => {

      chatDate.hidden = chatDateLabel.hidden = chatMode.value !== 'manual';

      chatDate.required = chatMode.value === 'manual';

    };

    chatMode.addEventListener('change', updateChatDate); updateChatDate();

    let initialChatDate = photo.chatDate || null;

    chatFields.append(chatLabel, chatMode, chatDateLabel, chatDate, el('p', '比如第二天才把照片发给对方，就配第二天的话。这个选择只改变聊天搭配，拍摄日期会好好留着。', 'sheet-footnote'));

    form.append(fields, chatFields, label, input, save);

    form.addEventListener('submit', e => {

      e.preventDefault();

      run(() => {

        let memory;

        if (precision.value !== initialPrecision || date.value !== initialDate || season.value !== initialSeason) {

          const takenAt = precision.value === 'unknown' ? null : date.value;

          if (!dates.valid(takenAt)) throw new Error('这个日期还没写完整，或暂时选「想不起来」。');

          memory = { takenAt, season: season.value || null };

        }

        const linkedDate = chatMode.value === 'manual' ? chatDate.value : null;

        meta.save(photo, input.value.split(/[,，\n]/).map(t => t.trim()).filter(Boolean), memory, linkedDate === initialChatDate ? undefined : linkedDate);

        initialPrecision = precision.value; initialDate = date.value; initialSeason = season.value;

        initialChatDate = linkedDate;

      }, '记好了，日期、季节和小记号都收好了。');

    });

    content.replaceChildren(form); show(tags);

  }

  function manageTags() {

    tagPhoto = null;

    document.getElementById('tagTitle').textContent = '整理一下小记号';

    document.getElementById('tagIntro').textContent = '不喜欢的标签可以改名、删掉，照片会好好留着。';

    content.replaceChildren();

    const list = meta.list();

    if (!list.length) content.appendChild(el('p', '还没有自定义标签，打开一张照片就能添一个。', 'tag-empty'));

    list.forEach(([tag, count], index) => {

      const form = el('form', undefined, 'tag-row');

      const input = el('input'); input.value = tag; input.maxLength = 20; input.setAttribute('aria-label', `修改标签 ${tag}`); input.id = `tagName${index}`;

      const label = el('label', `${count} 张`); label.htmlFor = input.id;

      const save = el('button', '改好啦'); save.type = 'submit';

      const remove = el('button', '去掉', 'tag-delete'); remove.type = 'button';

      form.append(input, label, save, remove);

      form.addEventListener('submit', e => { e.preventDefault(); run(() => { meta.rename(tag, input.value); manageTags(); }, '标签名字改好了。'); });

      remove.addEventListener('click', () => {

        if (!window.confirm(`去掉「${tag}」这个标签吗？照片都会留着。`)) return;

        run(() => { meta.remove(tag); manageTags(); }, '标签去掉了，照片都还在。');

      });

      content.appendChild(form);

    });

    const note = el('p', '这些小记号先记在这台设备。备份包含标签、日期、季节和聊天日期搭配，不包含照片与聊天正文。', 'sheet-footnote');

    const actions = el('div', undefined, 'tag-transfer');

    const exportBtn = el('button', '带走回忆备份'); exportBtn.type = 'button';

    exportBtn.addEventListener('click', () => {

      const blob = new Blob([JSON.stringify(meta.exportData(), null, 2)], { type: 'application/json' });

      const url = URL.createObjectURL(blob); const a = el('a'); a.href = url; a.download = '小夏的回忆补记.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);

    });

    const importLabel = el('label', '读回回忆备份', 'tag-import');

    const file = el('input'); file.type = 'file'; file.accept = '.json,application/json'; file.setAttribute('aria-label', '读回回忆备份');

    file.addEventListener('change', async () => {

      try {

        if (!file.files[0]) return;

        if (file.files[0].size > 2 * 1024 * 1024) throw new Error('这份文件太大了，请选回忆备份。');

        meta.importData(JSON.parse(await file.files[0].text())); manageTags(); status.textContent = '标签和日期补记带回来了。';

      } catch (error) { status.textContent = error.message; }

    });

    importLabel.appendChild(file); actions.append(exportBtn, importLabel); content.append(note, actions); show(tags);

  }

  document.getElementById('manageTags').addEventListener('click', () => { browse.close(); manageTags(); });

  // 全部浏览时用细点提示当前照片的季节，不假装已开启筛选。

  function updateRail() {

    const state = window.PLANET_APP.state;

    document.querySelectorAll('#seasonRail [data-season-choice]').forEach(btn => btn.classList.toggle('is-current', state.seasonFilter === 'all' && btn.dataset.seasonChoice === window.PLANET_DATES.seasonOf(window.PLANET_APP.byId.get(state.activeId) || {})));

  }

  for (const event of ['season:change', 'photo:active', 'gallery:filter', 'metadata:change']) document.addEventListener(event, updateRail);

  updateRail();

  window.PLANET_CONTROLS = { editPhoto, manageTags };

})();

