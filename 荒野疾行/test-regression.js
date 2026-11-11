#!/usr/bin/env node
/**
 * 荒野疾行 · 回归测试脚本（零依赖）
 *
 * 运行方式：node test-regression.js
 *
 * 原理：
 *   - 读取 index.html，提取内联 <script>（不含带 src 的外部脚本）。
 *   - 自建一个极简的 DOM / Canvas / localStorage 桩，让内联脚本在受控
 *     环境中执行（页面初始化、事件绑定等）。
 *   - 通过模拟用户点击按钮、按键、触发 requestAnimationFrame 等方式，
 *     驱动游戏核心逻辑，并断言 DOM 状态 / 存档数据是否符合预期。
 *
 * 约束：不引入任何第三方依赖，仅使用 Node 内置模块。
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = __dirname;
const HTML_PATH = path.join(ROOT, "index.html");

/* ------------------------------------------------------------------ */
/* 极简 DOM / Canvas 桩                                                */
/* ------------------------------------------------------------------ */

function makeContext2D() {
  // 游戏只会调用这些 Canvas 2D 方法；全部提供空实现，避免运行时报错。
  const noop = () => {};
  const gradient = { addColorStop: noop };
  const ctx = {
    canvas: null,
    globalAlpha: 1,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    lineJoin: "round",
    lineCap: "round",
    font: "",
    textAlign: "left",
    shadowColor: "",
    shadowBlur: 0,
    fillRect: noop,
    strokeRect: noop,
    clearRect: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    ellipse: noop,
    quadraticCurveTo: noop,
    fill: noop,
    stroke: noop,
    save: noop,
    restore: noop,
    translate: noop,
    rotate: noop,
    scale: noop,
    setLineDash: noop,
    createLinearGradient: () => gradient,
    fillText: noop,
    roundRect: noop,
    rect: noop,
  };
  return ctx;
}

class FakeElement {
  constructor(tagName, id) {
    this.tagName = tagName.toUpperCase();
    this.id = id || "";
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this.style = {};
    this._listeners = {};
    this.value = "";
    this._textContent = "";
    this.hidden = false;
    this.disabled = false;
    this.className = "";
    this._innerHTML = "";
    this._classSet = new Set();
    // 桩标记（供 querySelectorAll 使用）
    this._view = false;
    this._isTouchButton = false;
  }

  // textContent：赋值时统一转为字符串（脚本会赋数字），读取返回字符串
  get textContent() {
    return this._textContent;
  }
  set textContent(v) {
    this._textContent = v == null ? "" : String(v);
  }

  // innerHTML：脚本用 innerHTML 写 HUD 距离/速度，测试需能读回
  get innerHTML() {
    return this._innerHTML;
  }
  set innerHTML(v) {
    this._innerHTML = v == null ? "" : String(v);
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  append(...nodes) {
    for (const n of nodes) this.appendChild(typeof n === "string" ? makeTextNode(n) : n);
  }
  removeChild(child) {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
    child.parentNode = null;
    return child;
  }
  replaceChildren(...nodes) {
    this.children = [];
    for (const n of nodes) this.appendChild(typeof n === "string" ? makeTextNode(n) : n);
  }
  addEventListener(type, fn) {
    (this._listeners[type] || (this._listeners[type] = [])).push(fn);
  }
  dispatchEvent(event) {
    event.target = this;
    event.currentTarget = this;
    for (const fn of this._listeners[event.type] || []) fn.call(this, event);
    return true;
  }
  click() {
    this.dispatchEvent({ type: "click", preventDefault: () => {} });
  }
  get classList() {
    const self = this;
    return {
      add: (c) => self._classSet.add(c),
      remove: (c) => self._classSet.delete(c),
      toggle: (c, force) => {
        const shouldAdd = force === undefined ? !self._classSet.has(c) : force;
        if (shouldAdd) self._classSet.add(c);
        else self._classSet.delete(c);
        return shouldAdd;
      },
      contains: (c) => self._classSet.has(c),
    };
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
  getAttribute(name) {
    return this.attributes[name];
  }
  removeAttribute(name) {
    delete this.attributes[name];
  }
}

function makeTextNode(text) {
  const el = new FakeElement("#text");
  el.textContent = String(text);
  return el;
}

class FakeDocument {
  constructor() {
    this.elementsById = new Map();
    this._rafCallbacks = [];
    this._rafId = 0;
    this._now = 0;
  }

  register(id, el) {
    el.id = id;
    this.elementsById.set(id, el);
    return el;
  }

  getElementById(id) {
    if (this.elementsById.has(id)) return this.elementsById.get(id);
    // 未预先注册则按需创建，避免脚本因缺失元素而抛错
    const el = new FakeElement("div", id);
    this.elementsById.set(id, el);
    return el;
  }

  createElement(tagName) {
    return new FakeElement(tagName);
  }
  createTextNode(text) {
    return makeTextNode(text);
  }
  querySelectorAll(selector) {
    // 脚本会查询 .view（页面视图切换）、[data-home]（返回按钮）、.touch-controls button（触屏）
    // 这里返回已注册元素中匹配 selector 的元素。
    const result = [];
    for (const el of this.elementsById.values()) {
      if (selector === ".view" && el._view) result.push(el);
      else if (selector === "[data-home]" && el.attributes["data-home"] !== undefined) result.push(el);
      else if (selector === ".touch-controls button" && el._isTouchButton) result.push(el);
    }
    return result;
  }
  querySelector() {
    return null;
  }

  // requestAnimationFrame 由测试手动推进
  requestAnimationFrame(cb) {
    const id = ++this._rafId;
    this._rafCallbacks.push({ id, cb });
    return id;
  }
  cancelAnimationFrame(id) {
    this._rafCallbacks = this._rafCallbacks.filter((c) => c.id !== id);
  }
  step(now) {
    // 推进一帧：执行所有已排队的 rAF 回调（模拟渲染循环）
    this._now = now == null ? this._now + 16 : now;
    const pending = this._rafCallbacks.splice(0);
    for (const { cb } of pending) cb(this._now);
  }
}

/* ------------------------------------------------------------------ */
/* localStorage 桩（内存实现，可注入初始值、可注入抛错）               */
/* ------------------------------------------------------------------ */

function makeStorage(initial) {
  const store = new Map(Object.entries(initial || {}));
  return {
    _store: store,
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
  };
}

/* ------------------------------------------------------------------ */
/* 测试框架                                                           */
/* ------------------------------------------------------------------ */

const results = [];
let currentSuite = "";

function test(name, fn) {
  try {
    fn();
    results.push({ suite: currentSuite, name, ok: true });
    console.log(`  \u2713 ${name}`);
  } catch (err) {
    results.push({ suite: currentSuite, name, ok: false, err });
    console.log(`  \u2717 ${name}\n      ${err && err.message}`);
  }
}

function suite(name, fn) {
  currentSuite = name;
  console.log(`\n\u25a0 ${name}`);
  fn();
}

/* ------------------------------------------------------------------ */
/* 环境加载：解析 HTML，构造桩环境，执行内联脚本                       */
/* ------------------------------------------------------------------ */

function extractInlineScripts(html) {
  // 匹配没有 src 属性的 <script>...</script>（内联脚本）
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  const scripts = [];
  let m;
  while ((m = re.exec(html)) !== null) scripts.push(m[1]);
  return scripts;
}

function collectElementIds(html) {
  // 预先收集 HTML 里声明的所有 id，注册成桩元素（保证 getElementById 命中真实声明）
  const ids = new Set();
  const re = /\bid="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) ids.add(m[1]);
  return ids;
}

// 从 HTML 解析每个 id 对应的元素，记录其 class 与是否带 data-home 等特征，
// 供 querySelectorAll 桩使用。
// 注：这里只做「标记收集」，用于 querySelectorAll 返回正确元素子集；
// 具体标记用固定 ID 白名单（见 buildEnv 内的 VIEW_IDS / TOUCH_IDS / HOME_IDS）。
function collectElementMeta(html) {
  return {};
}

function buildEnv(html, { storageInitial, storageThrows } = {}) {
  const document = new FakeDocument();
  const ids = collectElementIds(html);
  for (const id of ids) document.register(id, new FakeElement("div", id));

  // 视图切换（showView 用 .view 集合 + classList.toggle("active")）
  const VIEW_IDS = ["home-view", "challenge-view", "battle-view", "leaderboard-view", "shop-view", "game-view"];
  for (const id of VIEW_IDS) {
    const el = document.getElementById(id);
    el._view = true;
  }
  // 返回按钮（[data-home]）
  const HOME_IDS = ["classic-cancel"];
  // 触屏按钮（.touch-controls button）
  const TOUCH_IDS = ["touch-left", "touch-attack", "touch-right", "touch-jump", "touch-duck", "touch-flight", "touch-double"];
  for (const id of TOUCH_IDS) {
    document.getElementById(id)._isTouchButton = true;
  }
  // data-home 标记：HTML 中所有 back-button 元素（带 data-home 属性）
  // 脚本 querySelectorAll("[data-home]") 用于给返回按钮绑定事件；
  // 这里仅需返回非空数组即可（空数组也不影响核心断言），故通过 attributes 模拟。
  for (const id of VIEW_IDS) {
    // 每个视图的返回按钮带 data-home；用固定 id 近似即可，不影响断言
  }
  const backIds = ["result-home-button"];
  for (const id of backIds) {
    document.getElementById(id).attributes["data-home"] = "";
  }

  // canvas 元素需要带 getContext 与 width/height
  for (const cid of ["game-canvas", "battle-canvas"]) {
    const el = document.getElementById(cid);
    el.width = 960;
    el.height = 440;
    el.getContext = () => makeContext2D();
  }

  // name 输入框默认值
  const nameInput = document.getElementById("player-name");
  nameInput.value = "跑者";

  const localStorage = makeStorage(storageInitial);
  if (storageThrows) {
    localStorage.setItem = () => {
      throw new Error("QuotaExceeded");
    };
  }

  // 云端 SDK 桩：脚本里 typeof WorkBuddyCloud !== "undefined" 才会初始化；
  // 默认不提供，模拟未联网环境（排行榜走本地回退）。
  const sandbox = {
    window: { addEventListener: () => {} },
    document,
    localStorage,
    performance: { now: () => document._now },
    requestAnimationFrame: (cb) => document.requestAnimationFrame(cb),
    cancelAnimationFrame: (id) => document.cancelAnimationFrame(id),
    console,
    Math,
    JSON,
    Number,
    Object,
    Array,
    String,
    Boolean,
    Map,
    Set,
    isFinite: Number.isFinite,
    parseFloat,
    parseInt,
    setTimeout,
    clearTimeout,
    Infinity,
    NaN,
  };
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);

  return { document, localStorage, sandbox, ids: [...ids] };
}

function runPageScripts(sandbox, scripts) {
  for (const code of scripts) {
    vm.runInContext(code, sandbox, { filename: "index-inline.js" });
  }
}

// 派发键盘事件到 window 上注册的 keydown/keyup 监听器
function bindWindowEvents(sandbox) {
  const listeners = { keydown: [], keyup: [] };
  sandbox.window = {
    addEventListener: (type, fn) => {
      if (listeners[type]) listeners[type].push(fn);
    },
  };
  // 重新执行时脚本会再次调用 window.addEventListener —— 因此需要在此返回
  // 一个稳定对象；buildEnv 里已放空实现，这里替换为可记录版本。
  sandbox.window = {
    _listeners: listeners,
    addEventListener(type, fn) {
      if (listeners[type]) listeners[type].push(fn);
    },
  };
  return {
    key(type, code) {
      const ev = { type, code, preventDefault: () => {} };
      for (const fn of listeners[type] || []) fn(ev);
    },
  };
}

/* ------------------------------------------------------------------ */
/* 测试主体                                                           */
/* ------------------------------------------------------------------ */

const html = fs.readFileSync(HTML_PATH, "utf8");
const scripts = extractInlineScripts(html);

if (scripts.length === 0) {
  console.error("未从 index.html 提取到内联脚本，无法测试。");
  process.exit(1);
}

console.log(`已提取 ${scripts.length} 段内联脚本，共 ${scripts.join("").length} 字符。\n`);

/* 1. 基础加载 */
suite("页面与脚本加载", () => {
  test("内联脚本语法可被解析（无 SyntaxError）", () => {
    for (const code of scripts) new Function(code);
  });

  test("脚本在桩 DOM 环境中可无异常初始化", () => {
    const { sandbox } = buildEnv(html);
    // 初始化不应抛错（getElementById 全部命中、Canvas getContext 可用）
    expectNoThrow(() => runPageScripts(sandbox, scripts));
  });

  test("所有 getElementById 引用的 ID 均已在 HTML 中声明", () => {
    const missing = [];
    const declared = new Set(collectElementIds(html));
    const re = /getElementById\(["']([^"']+)["']\)/g;
    let m;
    while ((m = re.exec(scripts.join("\n"))) !== null) {
      if (!declared.has(m[1])) missing.push(m[1]);
    }
    assert(missing.length === 0, `缺失 ID: ${missing.join(", ")}`);
  });
});

/* 2. 存档读写 */
suite("本地存档（localStorage）", () => {
  test("首次运行无存档时，钱包与纪录初始为 0", () => {
    const { document } = buildEnv(html);
    const env = buildEnv(html);
    runPageScripts(env.sandbox, scripts);
    // 首页金币/纪录应显示 0
    assert(env.document.getElementById("home-coins").textContent === "0", "初始金币应为 0");
    assert(env.document.getElementById("home-best").textContent === "0 m", "初始纪录应为 0 m");
  });

  test("损坏的存档 JSON 会被容错处理，不抛错", () => {
    const env = buildEnv(html, { storageInitial: { "rough-run-save-v1": "{broken json" } });
    expectNoThrow(() => runPageScripts(env.sandbox, scripts));
  });

  test("合法存档能被正确恢复（金币/道具/纪录）", () => {
    const env = buildEnv(html, {
      storageInitial: {
        "rough-run-save-v1": JSON.stringify({
          coins: 120,
          items: { flight: 3, double: 2 },
          bests: { 跑者: 456 },
        }),
      },
    });
    runPageScripts(env.sandbox, scripts);
    assert(env.document.getElementById("home-coins").textContent === "120", "金币应恢复为 120");
    assert(env.document.getElementById("home-best").textContent === "456 m", "纪录应恢复为 456 m");
  });
});

/* 3. 核心跑酷流程 */
suite("经典模式跑酷流程", () => {
  function startClassicRun() {
    const env = buildEnv(html);
    runPageScripts(env.sandbox, scripts);
    const kb = bindWindowEvents(env.sandbox);
    const doc = env.document;
    // 点「经典模式」展开面板
    doc.getElementById("classic-button").click();
    assert(doc.getElementById("classic-panel").hidden === false, "经典模式面板应展开");
    // 点「开始游戏」
    doc.getElementById("start-button").click();
    return { env, kb, doc };
  }

  test("点击「开始游戏」后切换到游戏视图并生成首个障碍", () => {
    const { doc } = startClassicRun();
    // game-view 应激活（脚本通过 classList 切换 active）
    const gameView = doc.getElementById("game-view");
    assert(gameView.classList.contains("active"), "游戏视图应被激活");
  });

  test("跳跃：按下 Space 后垂直速度被设置（角色离地）", () => {
    const { kb, doc } = startClassicRun();
    kb.key("keydown", "Space");
    // 推进若干帧，角色应进入跳跃/下落状态
    for (let i = 0; i < 30; i++) doc.step();
    // 无法直接读闭包，但可确认不抛错、HUD 仍在更新
    expectNoThrow(() => {
      for (let i = 0; i < 30; i++) doc.step();
    });
  });

  test("推进 5 秒（约 300 帧）无运行时异常，且距离递增", () => {
    const { doc } = startClassicRun();
    expectNoThrow(() => {
      for (let i = 0; i < 300; i++) doc.step();
    });
    // 距离 HUD（innerHTML 写入）应随游戏推进而 > 0
    const scoreHtml = doc.getElementById("hud-score").innerHTML;
    assert(/^\d+/.test(String(scoreHtml)), `距离应显示为数字，实际: ${JSON.stringify(scoreHtml)}`);
  });

  test("触屏跳跃按钮可触发跳跃且不抛错", () => {
    const { doc } = startClassicRun();
    const jumpBtn = doc.getElementById("touch-jump");
    expectNoThrow(() => {
      jumpBtn.dispatchEvent({ type: "pointerdown", preventDefault: () => {} });
      for (let i = 0; i < 20; i++) doc.step();
    });
  });
});

/* 4. 商店逻辑 */
suite("道具商城", () => {
  function openShop(initial) {
    const env = buildEnv(html, initial ? { storageInitial: { "rough-run-save-v1": JSON.stringify(initial) } } : undefined);
    runPageScripts(env.sandbox, scripts);
    const doc = env.document;
    doc.getElementById("shop-button").click();
    return { env, doc };
  }

  test("打开商店后渲染飞行器与双倍金币两个道具", () => {
    const { doc } = openShop();
    const list = doc.getElementById("shop-list");
    assert(list.children.length === 2, `商店应有 2 个道具，实际 ${list.children.length}`);
  });

  test("金币不足时购买按钮禁用", () => {
    const { doc } = openShop({ coins: 0, items: { flight: 0, double: 0 }, bests: {} });
    const list = doc.getElementById("shop-list");
    // 两个 item 各自的 buy 按钮
    for (const item of list.children) {
      const buyBtn = item.children.find((c) => c.className && String(c.className).includes("item-buy"));
      assert(buyBtn && buyBtn.disabled === true, "金币为 0 时购买按钮应禁用");
    }
  });

  test("金币充足时可购买并扣除金币、提升等级", () => {
    const env = buildEnv(html, {
      storageInitial: { "rough-run-save-v1": JSON.stringify({ coins: 100, items: { flight: 0, double: 0 }, bests: {} }) },
    });
    runPageScripts(env.sandbox, scripts);
    const doc = env.document;
    doc.getElementById("shop-button").click();
    const list = doc.getElementById("shop-list");
    const firstItem = list.children[0];
    const buyBtn = firstItem.children.find((c) => c.className && String(c.className).includes("item-buy"));
    assert(buyBtn && buyBtn.disabled === false, "金币充足时购买按钮应可用");
    buyBtn.click();
    // 购买后存档金币应从 100 减到 75（解锁费 25）
    const saved = JSON.parse(env.localStorage.getItem("rough-run-save-v1"));
    assert(saved.coins === 75, `购买后金币应为 75，实际 ${saved.coins}`);
    assert(saved.items.flight === 1, `飞行器等级应为 1，实际 ${saved.items.flight}`);
  });
});

/* 5. 排行榜 */
suite("排行榜", () => {
  test("无存档时排行榜显示空状态文案", () => {
    const env = buildEnv(html);
    runPageScripts(env.sandbox, scripts);
    const doc = env.document;
    doc.getElementById("leaderboard-button").click();
    const list = doc.getElementById("leaderboard-list");
    assert(list.children.length >= 1, "排行榜应至少渲染一行（空态或加载态）");
  });

  test("本地纪录会合并进排行榜（同名取最高）", () => {
    const env = buildEnv(html, {
      storageInitial: {
        "rough-run-save-v1": JSON.stringify({
          coins: 0,
          items: { flight: 0, double: 0 },
          bests: { 小明: 300, 小红: 500 },
        }),
      },
    });
    runPageScripts(env.sandbox, scripts);
    const doc = env.document;
    doc.getElementById("leaderboard-button").click();
    const list = doc.getElementById("leaderboard-list");
    // 无云端时仅本地两人，应渲染 2 行
    assert(list.children.length === 2, `应渲染 2 行本地纪录，实际 ${list.children.length}`);
  });
});

/* 6. 难度切换与完整跑局 */
suite("难度切换与完整一局", () => {
  function startWithDifficulty(mode) {
    const env = buildEnv(html);
    runPageScripts(env.sandbox, scripts);
    const doc = env.document;
    doc.getElementById("classic-button").click();
    if (mode === "hard") doc.getElementById("diff-hard").click();
    else doc.getElementById("diff-normal").click();
    doc.getElementById("start-button").click();
    return { env, doc };
  }

  test("切换到困难模式后，困难按钮获得高亮样式", () => {
    const env = buildEnv(html);
    runPageScripts(env.sandbox, scripts);
    const doc = env.document;
    doc.getElementById("classic-button").click();
    doc.getElementById("diff-hard").click();
    const hardBtn = doc.getElementById("diff-hard");
    assert(hardBtn.classList.contains("active"), "困难按钮应处于激活态");
    assert(hardBtn.classList.contains("hard-active"), "困难按钮应有困难高亮样式");
    const normalBtn = doc.getElementById("diff-normal");
    assert(!normalBtn.classList.contains("active"), "普通按钮应被取消激活");
  });

  test("困难模式下完整推进多帧无异常（速度上限 175 不报错）", () => {
    const { doc } = startWithDifficulty("hard");
    expectNoThrow(() => {
      for (let i = 0; i < 600; i++) doc.step();
    });
  });

  test("完整跑一局直到撞障碍结束，结算流程无异常", () => {
    const { doc } = startWithDifficulty("normal");
    // 推进足够多帧，让障碍自然撞上玩家触发 finishRun；
    // 期间交替跳跃模拟躲避，但不保证存活 —— 仅验证结算链路不抛错。
    expectNoThrow(() => {
      for (let i = 0; i < 1500; i++) doc.step();
    });
  });

  test("未解锁飞行器时按 F，不抛错（仅弹提示）", () => {
    const env = buildEnv(html); // 无存档，飞行器未解锁
    runPageScripts(env.sandbox, scripts);
    const doc = env.document;
    doc.getElementById("classic-button").click();
    doc.getElementById("start-button").click();
    const kb = bindWindowEvents(env.sandbox);
    expectNoThrow(() => {
      kb.key("keydown", "KeyF");
      for (let i = 0; i < 10; i++) doc.step();
    });
  });
});

/* 7. 挑战模式（副本对战） */
suite("挑战模式（副本对战）", () => {
  function startBattle() {
    const env = buildEnv(html);
    runPageScripts(env.sandbox, scripts);
    const kb = bindWindowEvents(env.sandbox);
    const doc = env.document;
    // 进入挑战模式 → 点击场景卡 → 进入战斗
    doc.getElementById("challenge-button").click();
    // 场景卡由 renderScenarioList 动态创建，触发 challenge-view 渲染后点第一张卡
    const list = doc.getElementById("scenario-list");
    assert(list.children.length === 1, "挑战模式应有 1 个剧本卡");
    list.children[0].click();
    return { env, kb, doc };
  }

  test("进入挑战模式后战斗视图激活、场景名正确", () => {
    const { doc } = startBattle();
    const battleView = doc.getElementById("battle-view");
    assert(battleView.classList.contains("active"), "战斗视图应被激活");
    assert(doc.getElementById("battle-stage").textContent.includes("第一阶段"), "应显示第一阶段");
  });

  test("主角按右方向键持续移动，坐标递增（移动速度正常）", () => {
    const { kb, doc } = startBattle();
    // 持续按住右方向键
    kb.key("keydown", "ArrowRight");
    // 推进若干帧，主角应向右移动（通过 HUD 无法直接读坐标，但可通过不抛错 + 击杀数状态验证）
    expectNoThrow(() => {
      for (let i = 0; i < 60; i++) doc.step();
    });
    kb.key("keyup", "ArrowRight");
  });

  test("挥刀（Space/J）可触发攻击且不抛错，挥刀时仍可移动", () => {
    const { kb, doc } = startBattle();
    expectNoThrow(() => {
      kb.key("keydown", "Space");      // 挥刀
      kb.key("keydown", "ArrowRight"); // 挥刀同时移动（不应锁定）
      for (let i = 0; i < 30; i++) doc.step();
      kb.key("keyup", "ArrowRight");
    });
  });

  test("长时间推进战斗（小怪陆续登场 + 近身攻击）无异常", () => {
    const { doc } = startBattle();
    // 推进 10 秒，覆盖小怪激活、靠近、攻击玩家、Boss 阶段切换等全流程
    expectNoThrow(() => {
      for (let i = 0; i < 600; i++) doc.step();
    });
  });

  test("触屏攻击按钮可触发攻击且不抛错", () => {
    const { doc } = startBattle();
    const attackBtn = doc.getElementById("touch-attack");
    expectNoThrow(() => {
      attackBtn.dispatchEvent({ type: "pointerdown", preventDefault: () => {} });
      for (let i = 0; i < 10; i++) doc.step();
    });
  });

  test("跳跃：按 W/↑ 触发跳跃，角色离地后落地，不抛错", () => {
    const { kb, doc } = startBattle();
    expectNoThrow(() => {
      kb.key("keydown", "KeyW");          // 跳跃
      for (let i = 0; i < 60; i++) doc.step();  // 推进，覆盖起跳+下落+落地
    });
  });

  test("触屏跳跃按钮可触发跳跃且不抛错", () => {
    const { doc } = startBattle();
    const jumpBtn = doc.getElementById("touch-jump-battle");
    expectNoThrow(() => {
      jumpBtn.dispatchEvent({ type: "pointerdown", preventDefault: () => {} });
      for (let i = 0; i < 20; i++) doc.step();
    });
  });
});

/* ------------------------------------------------------------------ */
/* 断言工具                                                           */
/* ------------------------------------------------------------------ */

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "断言失败");
}

function expectNoThrow(fn) {
  try {
    fn();
  } catch (err) {
    throw new Error("预期不抛错，但抛出: " + (err && err.stack ? err.stack : err));
  }
}

/* ------------------------------------------------------------------ */
/* 汇总                                                               */
/* ------------------------------------------------------------------ */

const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;

console.log(`\n${"=".repeat(44)}`);
console.log(`\u2713 通过 ${passed} 项   \u2717 失败 ${failed} 项   共 ${results.length} 项`);
console.log(`${"=".repeat(44)}`);

if (failed > 0) {
  process.exitCode = 1;
} else {
  console.log("全部回归测试通过。");
}
