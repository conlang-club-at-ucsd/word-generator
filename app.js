(function () {
  'use strict';

  /* presets */

  var PRESETS = [
    { label: 'Open syllables',
      c: 'C=p/t/k/m/n/s/l/h\nV=a/i/u/e/o',
      p: 'CV', min: 1, max: 3, f: '', d: 'zipf' },
    { label: 'Consonant clusters',
      c: 'C=t/n/r/s/d/l/k/m/b/g/h/f/w\nS=s/ʃ/f\nL=l/r\nV=a/e/i/o/u/ai/au\nF=n/r/t/s/l/m/k/nd/st',
      p: '(S)C(L)V(F)', min: 1, max: 2,
      f: '// no doubled starts, no triple letters\n!/^[sʃf][sʃf]/\n!/(.)\\1\\1/', d: 'zipf' },
    { label: 'Island style',
      c: 'C=h/k/l/m/n/p/w/ʻ\nV=a/e/i/o/u',
      p: '(C)V', min: 2, max: 4, f: '!/(.)\\1\\1/', d: 'zipf' },
    { label: 'Mora-timed',
      c: 'C=k/s/t/n/h/m/r/g/b/z/d/y/w\nV=a/i/u/e/o\nN=n',
      p: '(C)V(N)', min: 2, max: 4,
      f: 'si>shi\nti>chi\ntu>tsu\nhu>fu\nzi>ji\ndi>ji\ndu>zu\nyi>i\nye>e\nwu>u\nwi>i\nwe>e', d: 'zipf' },
    { label: 'Short and tonal',
      c: 'C=p/t/k/m/n/s/l/h/f/ts/ch\nV=a/i/u/e/o/ai/ou\nF=n/ng/m\nT=1/2/3/4',
      p: '(C)V(F)T', min: 1, max: 2, f: '', d: 'zipf' }
  ];

  var DEFAULTS = {
    c: PRESETS[0].c, p: PRESETS[0].p, min: PRESETS[0].min, max: PRESETS[0].max,
    f: PRESETS[0].f, d: PRESETS[0].d, n: 24, u: true, sort: false, cap: false, seed: ''
  };

  /* random numbers */

  function hashSeed(s) {
    var h = 1779033703 ^ s.length;
    for (var i = 0; i < s.length; i++) {
      h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^ (h >>> 16)) >>> 0;
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function newSeed() { return Math.random().toString(36).slice(2, 8); }

  /* pattern parser */

  function parsePattern(str, errors, where) {
    var i = 0;
    var NUM = /^\d*\.?\d+/;

    function alt(closer) {
      var alts = [], seq = [], weight = null;
      function end() { alts.push({ seq: seq, weight: weight }); seq = []; weight = null; }

      while (i < str.length) {
        var ch = str[i], m, cp;
        if (ch === ')' || ch === ']') {
          if (ch === closer) break;
          errors.push(where + ': unexpected "' + ch + '".');
          i++; continue;
        }
        if (ch === '/') { i++; end(); continue; }
        if (ch === '*') {
          i++;
          m = NUM.exec(str.slice(i));
          if (m) { weight = parseFloat(m[0]); i += m[0].length; }
          else errors.push(where + ': expected a number after "*".');
          continue;
        }
        if (ch === '(' || ch === '[') {
          i++;
          var close = ch === '(' ? ')' : ']';
          var inner = alt(close);
          if (str[i] === close) i++;
          else errors.push(where + ': missing "' + close + '".');
          var node = { t: ch === '(' ? 'opt' : 'grp', alts: inner, p: 0.5 };
          if (node.t === 'opt' && str[i] === '%') {
            i++;
            m = NUM.exec(str.slice(i));
            if (m) { node.p = Math.min(1, parseFloat(m[0]) / 100); i += m[0].length; }
            else errors.push(where + ': expected a number after "%".');
          }
          seq.push(node);
          continue;
        }
        if (ch === '\\') {
          i++;
          if (i < str.length) {
            cp = String.fromCodePoint(str.codePointAt(i)); i += cp.length;
            seq.push({ t: 'lit', v: cp });
          }
          continue;
        }
        if (/\s/.test(ch)) { i++; continue; }
        cp = String.fromCodePoint(str.codePointAt(i)); i += cp.length;
        seq.push(/^[A-Z]$/.test(cp) ? { t: 'ref', v: cp } : { t: 'lit', v: cp });
      }
      end();
      return alts;
    }
    return alt(null);
  }

  /* compile settings */

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&'); }

  function rejectRegex(text) {
    var m = /^\/(.+)\/([a-z]*)$/.exec(text);
    if (m) return new RegExp(m[1], m[2].replace(/g/g, ''));
    return new RegExp(escapeRe(text));
  }

  function compile(s) {
    var errors = [], classes = {}, subs = [], rejects = [];

    s.c.split(/\r?\n/).forEach(function (raw) {
      var line = raw.trim();
      if (!line || line.indexOf('//') === 0) return;
      var m = /^([A-Z])\s*=\s*(.*)$/.exec(line);
      if (!m) { errors.push('Class line not understood: "' + line + '". Write it like C=p/t/k.'); return; }
      var body = m[2].trim();
      if (!/[\/(\[]/.test(body)) body = body.split(/[\s,]+/).filter(Boolean).join('/');
      classes[m[1]] = parsePattern(body, errors, 'Class ' + m[1]);
    });

    var pattern = parsePattern(s.p, errors, 'Pattern');

    s.f.split(/\r?\n/).forEach(function (raw, idx) {
      var line = raw.trim();
      if (!line || line.indexOf('//') === 0) return;
      try {
        if (line.charAt(0) === '!') {
          var t = line.slice(1).trim();
          if (t) rejects.push(rejectRegex(t));
          return;
        }
        var rm = /^\/((?:\\.|[^\/\\])+)\/([a-z]*)\s*>(.*)$/.exec(line);
        if (rm) {
          var flags = rm[2].indexOf('g') === -1 ? rm[2] + 'g' : rm[2];
          subs.push([new RegExp(rm[1], flags), rm[3].trim()]);
        } else {
          var gt = line.indexOf('>');
          if (gt < 1) { errors.push('Rule on line ' + (idx + 1) + ' needs a ">", like ti>chi.'); return; }
          var from = line.slice(0, gt).trim();
          var to = line.slice(gt + 1).trim().replace(/\$/g, '$$$$');
          subs.push([new RegExp(escapeRe(from), 'g'), to]);
        }
      } catch (e) {
        errors.push('Rule on line ' + (idx + 1) + ': ' + e.message);
      }
    });

    return { classes: classes, pattern: pattern, subs: subs, rejects: rejects, errors: errors };
  }

  /* generation */

  function distWeight(i, d) {
    if (d === 'even') return 1;
    if (d === 'steep') return 1 / ((i + 1) * (i + 1));
    return 1 / (i + 1);
  }

  function pick(alts, ctx) {
    if (alts.length === 1) return alts[0];
    var ws = alts.map(function (a, i) { return a.weight != null ? a.weight : distWeight(i, ctx.dist); });
    var total = ws.reduce(function (x, y) { return x + y; }, 0);
    if (total <= 0) return alts[0];
    var r = ctx.rnd() * total;
    for (var i = 0; i < alts.length; i++) {
      r -= ws[i];
      if (r < 0) return alts[i];
    }
    return alts[alts.length - 1];
  }

  function gen(alts, ctx, depth) {
    if (depth > 24) return '';
    var alt = pick(alts, ctx), out = '';
    for (var i = 0; i < alt.seq.length; i++) {
      var n = alt.seq[i];
      if (n.t === 'lit') out += n.v;
      else if (n.t === 'ref') {
        var cls = ctx.classes[n.v];
        if (cls) out += gen(cls, ctx, depth + 1);
        else { ctx.warn[n.v] = true; out += n.v; }
      }
      else if (n.t === 'opt') { if (ctx.rnd() < n.p) out += gen(n.alts, ctx, depth + 1); }
      else out += gen(n.alts, ctx, depth + 1);
    }
    return out;
  }

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  function generate(s) {
    var model = compile(s);
    var ctx = { rnd: mulberry32(hashSeed(s.seed)), dist: s.d, classes: model.classes, warn: {} };
    var lo = clamp(s.min, 1, 8), hi = Math.max(lo, clamp(s.max, 1, 8));
    var want = clamp(s.n, 1, 500);
    var words = [], seen = {}, tries = 0, limit = want * 80 + 400;

    while (words.length < want && tries < limit) {
      tries++;
      var k = lo + Math.floor(ctx.rnd() * (hi - lo + 1));
      var w = '';
      for (var i = 0; i < k; i++) w += gen(model.pattern, ctx, 0);
      for (var j = 0; j < model.subs.length; j++) w = w.replace(model.subs[j][0], model.subs[j][1]);
      if (!w) continue;
      if (model.rejects.some(function (re) { return re.test(w); })) continue;
      if (s.u) {
        if (Object.prototype.hasOwnProperty.call(seen, w)) continue;
        seen[w] = true;
      }
      words.push(w);
    }

    if (s.sort) words.sort(function (a, b) { return a.localeCompare(b); });
    if (s.cap) words = words.map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); });

    var notes = model.errors.slice();
    Object.keys(ctx.warn).forEach(function (k) {
      notes.push('"' + k + '" is used in a pattern but has no class, so it is written as a plain letter.');
    });
    if (!s.p.trim()) notes.push('Add a syllable pattern to start generating.');
    else if (words.length < want) {
      notes.push('Only found ' + words.length + ' of ' + want + ' words. Your rules may allow few unique results; try more syllables or turn off "No duplicates".');
    }
    return { words: words, notes: notes };
  }

  /* page wiring */

  function $(id) { return document.getElementById(id); }
  var el = {
    c: $('classes'), p: $('pattern'), min: $('min'), max: $('max'), n: $('count'),
    f: $('rules'), d: $('dist'), u: $('unique'), sort: $('sort'), cap: $('cap'), seed: $('seed'),
    words: $('words'), meta: $('meta'), notes: $('notes'), status: $('status')
  };
  var lastWords = [];

  function intOr(v, fallback) { var n = parseInt(v, 10); return isNaN(n) ? fallback : n; }

  function read() {
    return {
      c: el.c.value, p: el.p.value,
      min: intOr(el.min.value, 1), max: intOr(el.max.value, 1), n: intOr(el.n.value, 24),
      f: el.f.value, d: el.d.value,
      u: el.u.checked, sort: el.sort.checked, cap: el.cap.checked,
      seed: el.seed.value
    };
  }

  function write(s) {
    el.c.value = s.c; el.p.value = s.p; el.min.value = s.min; el.max.value = s.max;
    el.n.value = s.n; el.f.value = s.f; el.d.value = s.d;
    el.u.checked = !!s.u; el.sort.checked = !!s.sort; el.cap.checked = !!s.cap;
    el.seed.value = s.seed;
  }

  function toQuery(s) {
    var q = new URLSearchParams();
    q.set('c', s.c); q.set('p', s.p);
    q.set('min', s.min); q.set('max', s.max); q.set('n', s.n);
    if (s.f) q.set('f', s.f);
    q.set('d', s.d);
    q.set('u', s.u ? '1' : '0'); q.set('sort', s.sort ? '1' : '0'); q.set('cap', s.cap ? '1' : '0');
    q.set('seed', s.seed);
    return q.toString();
  }

  function fromQuery() {
    var q = new URLSearchParams(window.location.search);
    var s = {};
    Object.keys(DEFAULTS).forEach(function (k) { s[k] = DEFAULTS[k]; });
    if (q.has('c')) s.c = q.get('c');
    if (q.has('p')) s.p = q.get('p');
    if (q.has('min')) s.min = clamp(intOr(q.get('min'), s.min), 1, 8);
    if (q.has('max')) s.max = clamp(intOr(q.get('max'), s.max), 1, 8);
    if (q.has('n')) s.n = clamp(intOr(q.get('n'), s.n), 1, 500);
    if (q.has('f')) s.f = q.get('f');
    else if (q.has('c') || q.has('p')) s.f = '';
    if (q.has('d') && /^(even|zipf|steep)$/.test(q.get('d'))) s.d = q.get('d');
    if (q.has('u')) s.u = q.get('u') !== '0';
    if (q.has('sort')) s.sort = q.get('sort') === '1';
    if (q.has('cap')) s.cap = q.get('cap') === '1';
    s.seed = q.has('seed') && q.get('seed') ? q.get('seed') : newSeed();
    return s;
  }

  function say(msg) {
    el.status.textContent = msg;
    clearTimeout(say.t);
    say.t = setTimeout(function () { el.status.textContent = ''; }, 2800);
  }

  function copy(text, msg) {
    function fallback() {
      var t = document.createElement('textarea');
      t.value = text; t.setAttribute('readonly', '');
      t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); say(msg); }
      catch (e) { say('Copy failed. Select the text and copy it by hand.'); }
      document.body.removeChild(t);
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { say(msg); }, fallback);
    } else fallback();
  }

  function render(result, s) {
    lastWords = result.words;
    el.words.textContent = '';
    if (!result.words.length) {
      var li = document.createElement('li');
      li.className = 'out-empty';
      li.textContent = 'No words yet. Check the notes below or adjust your settings.';
      el.words.appendChild(li);
    }
    result.words.forEach(function (w) {
      var item = document.createElement('li');
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'word'; b.textContent = w;
      b.title = 'Copy "' + w + '"';
      item.appendChild(b);
      el.words.appendChild(item);
    });
    el.meta.textContent = result.words.length + (result.words.length === 1 ? ' word' : ' words') +
      (s.seed ? ', seed ' + s.seed : '');

    el.notes.textContent = '';
    result.notes.forEach(function (msg) {
      var d = document.createElement('div');
      d.textContent = msg;
      el.notes.appendChild(d);
    });
    el.notes.hidden = !result.notes.length;
  }

  function updateUrl(s) {
    try { window.history.replaceState(null, '', window.location.pathname + '?' + toQuery(s)); }
    catch (e) { /* file:// and some sandboxes refuse; the generator still works */ }
  }

  function run() {
    var s = read();
    var result;
    try { result = generate(s); }
    catch (e) { result = { words: [], notes: ['Something went wrong: ' + e.message] }; }
    render(result, s);
    updateUrl(s);
  }

  var timer;
  function schedule() { clearTimeout(timer); timer = setTimeout(run, 150); }

  // presets
  var presetBox = $('presets');
  PRESETS.forEach(function (pr) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'btn btn--small'; b.textContent = pr.label;
    b.addEventListener('click', function () {
      var s = read();
      write({ c: pr.c, p: pr.p, min: pr.min, max: pr.max, f: pr.f, d: pr.d,
              n: s.n, u: s.u, sort: s.sort, cap: s.cap, seed: s.seed || newSeed() });
      run();
      say('Loaded "' + pr.label + '".');
    });
    presetBox.appendChild(b);
  });

  $('gen-form').addEventListener('input', schedule);
  $('gen-form').addEventListener('change', schedule);

  $('reroll').addEventListener('click', function () { el.seed.value = newSeed(); run(); });
  $('copy-all').addEventListener('click', function () {
    if (!lastWords.length) { say('Nothing to copy yet.'); return; }
    copy(lastWords.join('\n'), 'Copied ' + lastWords.length + ' words.');
  });
  $('copy-link').addEventListener('click', function () {
    clearTimeout(timer); run();
    copy(window.location.href, 'Link copied.');
  });
  el.words.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('button.word') : null;
    if (b) copy(b.textContent, 'Copied "' + b.textContent + '".');
  });

  write(fromQuery());
  run();
})();
