/* 相册纸条和独立聊天页共用安全的消息渲染。 */
(() => {
  'use strict';
  const node = (tag, text, cls) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el; };
  function labels() { return { me: window.PLANET_PREFS?.get('meName') || '阿屿', her: window.PLANET_PREFS?.get('herName') || '小夏', system: window.SITE_CONFIG?.people?.system || '那天的小记号' }; }
  function senderNode(sender) { const el = node('span', labels()[sender]); el.dataset.senderLabel = sender; return el; }
  function shareLink(value) {
    if (!value || typeof value.url !== 'string' || /[\u0000-\u001f\u007f-\u009f]/.test(value.url)) return null;
    if (!/^https?:\/\//i.test(value.url)) return null;
    try {
      const url = new URL(value.url);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
      return { url, title: typeof value.title === 'string' ? value.title.trim() : '' };
    } catch (_) { return null; }
  }
  function messageNode(message, { jump } = {}) {
    const item = node('article', undefined, `chat-message chat-from-${message.sender}`); item.dataset.messageId = message.id;
    const header = node('div', undefined, 'chat-message-head');
    header.append(senderNode(message.sender), node('time', String(message.time || '').slice(0, 5)));
    item.append(header);
    const bubble = node('div', undefined, 'chat-bubble');
    if (!window.PLANET_CHAT_MEDIA && message.quote?.text) {
      const quote = node('blockquote', undefined, 'chat-quote');
      if (message.quote.sender) quote.append(node('b', message.quote.sender === '我' ? labels().me : labels()[message.quote.sender] || message.quote.sender));
      quote.append(node('p', message.quote.text)); bubble.append(quote);
    }
    const share = shareLink(message.link);
    const repeatedTitle = share && (message.text.trim() === share.title || message.text.trim() === message.link.url);
    if (!repeatedTitle && message.text.length > 1800) {
      const details = node('details', undefined, 'chat-long-message');
      details.append(node('summary', message.text.slice(0, 180) + '… 展开这段话'), node('p', message.text)); bubble.append(details);
    } else if (!repeatedTitle && (message.text || !share)) bubble.append(node('p', message.text || '一个小记号'));
    if (share) {
      const link = node('a', undefined, 'chat-share');
      link.href = share.url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.referrerPolicy = 'no-referrer';
      const copy = node('span', undefined, 'chat-share-copy');
      copy.append(node('span', share.title || '打开这条分享', 'chat-share-title'), node('small', share.url.hostname, 'chat-share-host'));
      const arrow = node('span', '↗', 'chat-share-arrow'); arrow.setAttribute('aria-hidden', 'true');
      link.append(copy, arrow); bubble.append(link);
    }
    if (window.PLANET_CHAT_MEDIA) window.PLANET_CHAT_MEDIA.render(message, bubble, { jump });
    if (message.attachment && !message.text.includes('附件尚未收录')) bubble.append(node('small', '附件还没收进相册', 'chat-attachment-note'));
    item.append(bubble); return item;
  }
  function syncLabels() {
    document.querySelectorAll('[data-sender-label]').forEach(el => { el.textContent = labels()[el.dataset.senderLabel] || '分享里的人'; });
  }
  syncLabels(); document.addEventListener('preferences:change', syncLabels);
  window.PLANET_CHAT_RENDER = Object.freeze({ messageNode });
})();
