/* ============================================================
 *  LetterPairAssociation · 主逻辑
 *  魔方盲拧字母对联想词训练器
 * ============================================================ */

(function () {
  'use strict';

  /* ============================================================
   *  常量：字母表 & 全部合法字母组合
   *  排除 I / O / U / V，排除两个相同字母
   *  22 个字母 → 22 × 21 = 462 个组合
   * ============================================================ */
  const STORAGE_KEY = 'cube_assoc_trainer_v1';
  const EXCLUDE = 'IOUV';
  const LETTERS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].filter(c => !EXCLUDE.includes(c));
  const ALL_KEYS = [];
  for (const a of LETTERS) for (const b of LETTERS) if (a !== b) ALL_KEYS.push(a + b);
  const TOTAL = ALL_KEYS.length;

  /* ============================================================
   *  状态
   * ============================================================ */
  let state = null;        // 持久化状态
  let pending = null;      // 冲突待决状态 { key, typed }
  let toastTimer = null;

  const $ = id => document.getElementById(id);

  /* ============================================================
   *  工具函数
   * ============================================================ */
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function newEntry() {
    return { word: '', mastered: false, history: [] };
  }

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 1900);
  }

  /* ============================================================
   *  持久化
   * ============================================================ */
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('保存失败：', e);
    }
  }

  function buildFreshState() {
    const entries = {};
    ALL_KEYS.forEach(k => { entries[k] = newEntry(); });
    return { version: 1, round: 1, total: 0, queue: [], entries };
  }

  function loadState() {
    let raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
    if (!raw) return null;

    try {
      const s = JSON.parse(raw);
      if (!s || typeof s !== 'object' || !s.entries) return null;

      // 补全 / 校正
      ALL_KEYS.forEach(k => {
        const e = s.entries[k];
        if (!e) {
          s.entries[k] = newEntry();
        } else {
          if (typeof e.word !== 'string') e.word = '';
          e.mastered = !!e.mastered;
          if (!Array.isArray(e.history)) e.history = [];
        }
      });

      s.round = (typeof s.round === 'number' && s.round > 0) ? s.round : 1;
      s.total = (typeof s.total === 'number' && s.total >= 0) ? s.total : 0;
      s.queue = Array.isArray(s.queue) ? s.queue.filter(k => !!s.entries[k]) : [];

      return s;
    } catch (e) {
      return null;
    }
  }

  /* ============================================================
   *  回合控制
   * ============================================================ */
  function beginRound(roundNum) {
    state.round = roundNum;
    // 只遍历"尚未掌握"的组合
    const pool = ALL_KEYS.filter(k => !state.entries[k].mastered);
    state.queue = shuffle(pool);      // 随机打乱，一轮内不重复
    state.total = pool.length;
    pending = null;
    save();
  }

  function advance() {
    state.queue.shift();
    pending = null;
    save();
    render();
  }

  function masterCount() {
    let n = 0;
    for (const k of ALL_KEYS) if (state.entries[k].mastered) n++;
    return n;
  }

  /* ============================================================
   *  渲染
   * ============================================================ */
  function render() {
    const mc = masterCount();
    $('roundInfo').textContent = `第 ${state.round} 轮`;
    $('masteredInfo').textContent = `已掌握 ${mc} / ${TOTAL}`;

    if (state.queue.length === 0) {
      renderComplete(mc);
    } else {
      renderQuestion();
    }

    if ($('wordlistPanel').open) renderWordList();
  }

  function renderQuestion() {
    $('mainCard').style.display = '';
    $('completeCard').style.display = 'none';

    const key = state.queue[0];
    const entry = state.entries[key];
    const done = state.total - state.queue.length;

    $('progressInfo').textContent = `${done} / ${state.total}`;
    $('progressBar').style.width = (state.total ? (done / state.total * 100) : 0) + '%';
    $('pair').innerHTML = `<span>${key[0]}</span><span>${key[1]}</span>`;

    const inputRow = $('inputRow');
    const feedback = $('feedback');
    const input = $('answerInput');

    if (pending && pending.key === key) {
      /* ---------- 冲突界面 ---------- */
      inputRow.style.display = 'none';
      feedback.innerHTML = `
        <div class="conflict">
          <div class="conflict-title">⚠️ 与之前记录的联想词不一致</div>
          <div class="compare">
            <div class="cmp old">
              <div class="cmp-label">之前记录</div>
              <div class="cmp-word">${esc(entry.word)}</div>
            </div>
            <div class="cmp new">
              <div class="cmp-label">这次输入</div>
              <div class="cmp-word">${esc(pending.typed)}</div>
            </div>
          </div>
          <div class="actions">
            <button class="btn primary" id="btnReplace">用新词替换并记录</button>
            <button class="btn ghost" id="btnKeep">保留原来的词</button>
          </div>
        </div>
      `;
      $('btnReplace').onclick = () => resolveConflict('replace');
      $('btnKeep').onclick = () => resolveConflict('keep');
    } else {
      /* ---------- 正常答题界面 ---------- */
      inputRow.style.display = '';
      feedback.innerHTML = '';
      $('hint').textContent = state.round === 1
        ? '为这个字母组合输入你的联想词'
        : '回忆一下，输入你之前为它设定的联想词';
      input.value = '';
      input.focus();
    }
  }

  function renderComplete(mc) {
    $('mainCard').style.display = 'none';
    const card = $('completeCard');
    card.style.display = '';

    const allDone = mc >= TOTAL;

    card.innerHTML = `
      <div class="complete-icon">${allDone ? '🏆' : '🎉'}</div>
      <h2>第 ${state.round} 轮完成</h2>
      <p>${
        allDone
          ? '所有字母组合的联想词都已巩固完成，太厉害了！'
          : `本轮结束。已掌握 <b>${mc}</b> / ${TOTAL} 个组合，还有 <b>${TOTAL - mc}</b> 个需要继续巩固。`
      }</p>
      <div class="actions" style="justify-content:center">
        ${allDone ? '' : `<button class="btn primary" id="btnNextRound">开始第 ${state.round + 1} 轮</button>`}
        <button class="btn ghost" id="btnReset2">重置全部数据</button>
      </div>
    `;

    if (!allDone) {
      $('btnNextRound').onclick = () => {
        beginRound(state.round + 1);
        render();
      };
    }
    $('btnReset2').onclick = resetAll;
  }

  /* ============================================================
   *  答题逻辑
   * ============================================================ */
  function handleSubmit() {
    if (pending) return;
    if (state.queue.length === 0) return;

    const input = $('answerInput');
    const val = input.value.trim();
    if (!val) { input.focus(); return; }

    const key = state.queue[0];
    const entry = state.entries[key];

    // ① 该组合还没有任何记录（第一轮 / 新记录）→ 直接存
    if (!entry.word) {
      entry.word = val;
      entry.history.push({ round: state.round, word: val, type: 'set' });
      advance();
      return;
    }

    // ② 与已有记录一致 → 掌握，后续轮次不再遍历
    if (entry.word === val) {
      entry.history.push({ round: state.round, word: val, type: 'match' });
      if (!entry.mastered) {
        entry.mastered = true;
        advance();
        toast('✅ 两次一致，这个组合已掌握');
      } else {
        advance();
      }
      return;
    }

    // ③ 不一致 → 弹出对比与两个按钮
    pending = { key, typed: val };
    render();
  }

  function resolveConflict(action) {
    if (!pending) return;

    const { key, typed } = pending;
    const entry = state.entries[key];
    const oldWord = entry.word;

    if (action === 'replace') {
      // 用新词替换，并记录最新的联想词
      entry.word = typed;
      entry.mastered = false;
      entry.history.push({
        round: state.round, word: typed, type: 'replace', from: oldWord
      });
    } else {
      // 保留原来的词
      entry.history.push({
        round: state.round, word: typed, type: 'keep', kept: oldWord
      });
    }

    advance();

    if (action === 'replace') {
      toast(`已把联想词更新为「${typed}」`);
    } else {
      toast(`保留原联想词「${oldWord}」`);
    }
  }

  /* ============================================================
   *  词库面板
   * ============================================================ */
  function renderWordList() {
    const grid = $('wordGrid');
    const q = $('searchBox').value.trim().toUpperCase();

    const recorded = ALL_KEYS.filter(k => state.entries[k].word).length;
    $('wordlistCount').textContent = `已记录 ${recorded} / ${TOTAL}`;

    const items = [];
    for (const k of ALL_KEYS) {
      const e = state.entries[k];
      if (!e.word) continue;
      if (q && !k.includes(q) && !e.word.toUpperCase().includes(q)) continue;
      items.push([k, e]);
    }

    if (!items.length) {
      grid.innerHTML = '<div class="wl-empty">暂无记录</div>';
      return;
    }

    grid.innerHTML = items.map(([k, e]) => `
      <div class="wl-item${e.mastered ? ' ok' : ''}">
        <span class="wl-key">${k}</span>
        <span class="wl-word" title="${esc(e.word)}">${esc(e.word)}</span>
        ${e.mastered ? '<span class="wl-badge">✓</span>' : ''}
      </div>
    `).join('');
  }

  /* ============================================================
   *  导出 / 导入备份
   * ============================================================ */
  function exportBackup() {
    let raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { }

    if (!raw) {
      toast('还没有可导出的数据');
      return;
    }

    try { JSON.parse(raw); }
    catch (e) {
      toast('本地数据已损坏，无法导出');
      return;
    }

    const date = new Date().toISOString().slice(0, 10); // 2025-01-31
    const blob = new Blob([raw], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `letterpairassociation-backup-${date}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    toast('备份已导出');
  }

  function importBackup() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';

    input.onchange = e => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      const reader = new FileReader();

      reader.onload = () => {
        let parsed = null;
        try {
          parsed = JSON.parse(reader.result);
        } catch (err) {
          toast('文件不是有效的 JSON');
          return;
        }

        if (!parsed || typeof parsed !== 'object' || !parsed.entries
            || typeof parsed.entries !== 'object') {
          toast('文件格式不正确，导入已取消');
          return;
        }

        if (!confirm('导入会覆盖当前所有记录，确定继续吗？')) return;

        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
        } catch (err) {
          toast('写入失败，可能是存储空间不足');
          return;
        }

        location.reload();
      };

      reader.onerror = () => toast('读取文件失败');
      reader.readAsText(file);
    };

    input.click();
  }

  /* ============================================================
   *  重置
   * ============================================================ */
  function resetAll() {
    if (!confirm('确定要清空所有联想词记录并重新开始吗？此操作不可撤销。')) return;

    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { }

    state = buildFreshState();
    beginRound(1);
    $('searchBox').value = '';
    render();
    toast('已重置，开始第 1 轮');
  }

  /* ============================================================
   *  事件绑定
   * ============================================================ */
  function bindEvents() {
    $('submitBtn').addEventListener('click', handleSubmit);

    $('answerInput').addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSubmit();
      }
    });

    $('resetBtn').addEventListener('click', resetAll);
    $('exportBtn').addEventListener('click', exportBackup);
    $('importBtn').addEventListener('click', importBackup);

    const panel = $('wordlistPanel');
    panel.addEventListener('toggle', () => { if (panel.open) renderWordList(); });
    $('searchBox').addEventListener('input', renderWordList);
  }

  /* ============================================================
   *  初始化
   * ============================================================ */
  function init() {
    state = loadState();

    if (!state) {
      state = buildFreshState();
      beginRound(1);
    } else if (state.total === 0 && state.queue.length === 0 && state.round === 1) {
      beginRound(1);
    }

    bindEvents();
    render();
    renderWordList();
  }

  init();
})();