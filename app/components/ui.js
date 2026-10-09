(function (root) {
  'use strict';

  var CA = (root.CareerAgent = root.CareerAgent || {});
  CA.components = CA.components || {};
  var doc = root.document;

  // 所有文本都经 textContent 写入，避免把数据当作 HTML 解析。
  function h(tag, attrs) {
    var el = doc.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        var value = attrs[key];
        if (value === null || value === undefined || value === false) return;
        if (key === 'class') el.className = value;
        else if (key === 'text') el.textContent = value;
        else if (key === 'dataset') {
          Object.keys(value).forEach(function (k) {
            el.dataset[k] = value[k];
          });
        } else if (key.slice(0, 2) === 'on' && typeof value === 'function') {
          el.addEventListener(key.slice(2).toLowerCase(), value);
        } else if (value === true) el.setAttribute(key, '');
        else el.setAttribute(key, String(value));
      });
    }
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }

  function append(parent, child) {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) {
      child.forEach(function (c) {
        append(parent, c);
      });
      return;
    }
    parent.appendChild(typeof child === 'string' || typeof child === 'number' ? doc.createTextNode(String(child)) : child);
  }

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
  }

  function icon(name) {
    return h('i', { class: 'fa fa-' + name + ' ca-icon', 'aria-hidden': 'true' });
  }

  function badge(text, tone) {
    return h('span', { class: 'ca-badge ca-badge--' + (tone || 'neutral') }, text);
  }

  function link(href, label, opts) {
    opts = opts || {};
    return h('a', { href: href, class: opts.className || 'ca-link' }, opts.icon ? icon(opts.icon) : null, label);
  }

  function button(label, opts) {
    opts = opts || {};
    return h(
      'button',
      {
        type: opts.type || 'button',
        class: 'ca-btn ca-btn--' + (opts.variant || 'secondary') + (opts.className ? ' ' + opts.className : ''),
        onclick: opts.onClick,
        disabled: opts.disabled,
        'aria-describedby': opts.describedBy
      },
      opts.icon ? icon(opts.icon) : null,
      h('span', null, label)
    );
  }

  function formatDateTime(iso, timeZone, withTime) {
    if (!iso) return null;
    var d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    var opts = { timeZone: timeZone || 'Asia/Shanghai', year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' };
    if (withTime !== false) {
      opts.hour = '2-digit';
      opts.minute = '2-digit';
      opts.hour12 = false;
    }
    try {
      return new Intl.DateTimeFormat('zh-CN', opts).format(d);
    } catch (e) {
      return iso;
    }
  }

  // 状态区块：加载／空／失败三种显式区分。
  function statePanel(kind, title, message, actions) {
    var role = kind === 'error' ? 'alert' : 'status';
    var iconName = { loading: 'circle-o-notch fa-spin', empty: 'inbox', error: 'exclamation-triangle', info: 'info-circle' }[kind] || 'info-circle';
    return h(
      'div',
      { class: 'ca-state ca-state--' + kind, role: role, 'aria-live': kind === 'loading' ? 'polite' : null },
      h('p', { class: 'ca-state__title' }, icon(iconName), h('span', null, title)),
      message ? h('p', { class: 'ca-state__message' }, message) : null,
      actions && actions.length ? h('div', { class: 'ca-actions' }, actions) : null
    );
  }

  function notice(tone, content, actions) {
    return h(
      'div',
      { class: 'ca-notice ca-notice--' + tone, role: tone === 'danger' ? 'alert' : 'status' },
      h('div', { class: 'ca-notice__body' }, content),
      actions && actions.length ? h('div', { class: 'ca-actions' }, actions) : null
    );
  }

  var toastRegion = null;
  function toast(message, tone) {
    if (!toastRegion) toastRegion = doc.getElementById('ca-toasts');
    if (!toastRegion) return;
    var item = h('div', { class: 'ca-toast ca-toast--' + (tone || 'info') }, message);
    while (toastRegion.children.length >= 2) toastRegion.removeChild(toastRegion.firstChild);
    toastRegion.appendChild(item);
    setTimeout(function () {
      if (item.parentNode) item.parentNode.removeChild(item);
    }, tone === 'danger' ? 9000 : 5000);
  }

  // 原生 <dialog> 模态确认：Esc 与“取消”都返回 false。
  function confirmDialog(options) {
    return new Promise(function (resolve) {
      var dialog = h('dialog', { class: 'ca-dialog', 'aria-labelledby': 'ca-dialog-title', 'aria-describedby': 'ca-dialog-message' });
      var settled = false;
      function done(value) {
        if (settled) return;
        settled = true;
        if (dialog.open) dialog.close();
        if (dialog.parentNode) dialog.parentNode.removeChild(dialog);
        resolve(value);
      }
      var cancelBtn = button(options.cancelText || '取消', { onClick: function () { done(false); } });
      var okBtn = button(options.confirmText || '确认', {
        variant: options.danger ? 'danger' : 'primary',
        onClick: function () {
          done(true);
        }
      });
      append(
        dialog,
        h(
          'div',
          { class: 'ca-dialog__inner' },
          h('h2', { id: 'ca-dialog-title', class: 'ca-dialog__title' }, options.title),
          h('p', { id: 'ca-dialog-message', class: 'ca-dialog__message' }, options.message),
          h('div', { class: 'ca-actions ca-actions--end' }, cancelBtn, okBtn)
        )
      );
      dialog.addEventListener('cancel', function (event) {
        event.preventDefault();
        done(false);
      });
      doc.body.appendChild(dialog);
      if (typeof dialog.showModal === 'function') {
        dialog.showModal();
        cancelBtn.focus();
      } else {
        dialog.parentNode.removeChild(dialog);
        settled = true;
        resolve(root.confirm(options.title + '\n\n' + options.message));
      }
    });
  }

  function appendAll(parent) {
    for (var i = 1; i < arguments.length; i++) append(parent, arguments[i]);
    return parent;
  }

  CA.components.ui = {
    h: h,
    append: appendAll,
    clear: clear,
    icon: icon,
    badge: badge,
    link: link,
    button: button,
    formatDateTime: formatDateTime,
    statePanel: statePanel,
    notice: notice,
    toast: toast,
    confirmDialog: confirmDialog
  };
})(window);
