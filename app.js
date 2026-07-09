(function () {
  "use strict";

  const HYPER_ID = "hyper";
  const DEFAULT_THRESHOLD = 1000;
  const DEFAULT_QTY = 1;

  const state = {
    selected: {}, // productId -> { qty }
    threshold: DEFAULT_THRESHOLD
  };

  const fmt = (n) => Math.round(n).toLocaleString("ru-RU") + " ₸";

  const storeById = Object.fromEntries(APP_DATA.stores.map((s) => [s.id, s]));

  function groupByCategory(products) {
    const groups = new Map();
    for (const p of products) {
      if (!groups.has(p.category)) groups.set(p.category, []);
      groups.get(p.category).push(p);
    }
    return groups;
  }

  function renderCatalog() {
    const root = document.getElementById("catalog");
    root.innerHTML = "";
    const groups = groupByCategory(APP_DATA.products);

    for (const [category, products] of groups) {
      const section = document.createElement("section");
      section.className = "category";

      const h2 = document.createElement("h2");
      h2.textContent = category;
      section.appendChild(h2);

      const table = document.createElement("table");
      table.className = "catalog-table";

      const thead = document.createElement("thead");
      thead.innerHTML = `
        <tr>
          <th class="col-check"></th>
          <th class="col-name">Товар</th>
          <th class="col-qty">Кол-во</th>
          ${APP_DATA.stores.map((s) => `<th class="col-price">${s.name}</th>`).join("")}
        </tr>`;
      table.appendChild(thead);

      const tbody = document.createElement("tbody");

      for (const p of products) {
        const tr = document.createElement("tr");
        tr.dataset.productId = p.id;

        const minPrice = Math.min(...APP_DATA.stores.map((s) => p.prices[s.id]));
        const isSelected = !!state.selected[p.id];

        const checkTd = document.createElement("td");
        checkTd.className = "col-check";
        checkTd.setAttribute("data-label", "");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = isSelected;
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) {
            state.selected[p.id] = { qty: state.selected[p.id]?.qty ?? DEFAULT_QTY };
          } else {
            delete state.selected[p.id];
          }
          qtyInput.disabled = !checkbox.checked;
          recalcAndRender();
        });
        checkTd.appendChild(checkbox);
        tr.appendChild(checkTd);

        const nameTd = document.createElement("td");
        nameTd.className = "col-name";
        nameTd.setAttribute("data-label", "Товар");
        nameTd.textContent = p.name;
        tr.appendChild(nameTd);

        const qtyTd = document.createElement("td");
        qtyTd.className = "col-qty";
        qtyTd.setAttribute("data-label", "Кол-во");
        const qtyInput = document.createElement("input");
        qtyInput.type = "number";
        qtyInput.min = "0.1";
        qtyInput.step = "0.1";
        qtyInput.value = state.selected[p.id]?.qty ?? DEFAULT_QTY;
        qtyInput.disabled = !isSelected;
        qtyInput.addEventListener("input", () => {
          let v = parseFloat(qtyInput.value);
          if (isNaN(v) || v < 0.1) v = 0.1;
          if (state.selected[p.id]) {
            state.selected[p.id].qty = v;
            recalcAndRender();
          }
        });
        const unitSpan = document.createElement("span");
        unitSpan.className = "unit";
        unitSpan.textContent = p.unit;
        qtyTd.appendChild(qtyInput);
        qtyTd.appendChild(unitSpan);
        tr.appendChild(qtyTd);

        for (const s of APP_DATA.stores) {
          const priceTd = document.createElement("td");
          priceTd.className = "col-price";
          priceTd.setAttribute("data-label", s.name);
          const price = p.prices[s.id];
          if (price === minPrice) priceTd.classList.add("min-price");
          priceTd.textContent = `${price.toLocaleString("ru-RU")} ₸/${p.unit}`;
          tr.appendChild(priceTd);
        }

        tbody.appendChild(tr);
      }

      table.appendChild(tbody);
      section.appendChild(table);
      root.appendChild(section);
    }
  }

  function calculate() {
    const items = Object.entries(state.selected).map(([id, { qty }]) => {
      const product = APP_DATA.products.find((p) => p.id === id);
      return { product, qty };
    });

    if (items.length === 0) return null;

    // baseline: всё в гипермаркете
    const baseline = items.reduce(
      (sum, { product, qty }) => sum + product.prices[HYPER_ID] * qty,
      0
    );

    // оптимальная точка на товар
    const withOptimal = items.map(({ product, qty }) => {
      let bestStore = APP_DATA.stores[0].id;
      let bestCost = Infinity;
      for (const s of APP_DATA.stores) {
        const cost = product.prices[s.id] * qty;
        if (cost < bestCost) {
          bestCost = cost;
          bestStore = s.id;
        }
      }
      return { product, qty, store: bestStore, cost: bestCost };
    });

    // группировка в корзины по точкам
    let basketMap = new Map(APP_DATA.stores.map((s) => [s.id, []]));
    for (const item of withOptimal) {
      basketMap.get(item.store).push(item);
    }

    // применяем порог целесообразности к не-гипермаркетным корзинам
    for (const s of APP_DATA.stores) {
      if (s.id === HYPER_ID) continue;
      const basketItems = basketMap.get(s.id);
      if (basketItems.length === 0) continue;

      const contribution = basketItems.reduce(
        (sum, item) => sum + item.product.prices[HYPER_ID] * item.qty - item.cost,
        0
      );

      if (contribution < state.threshold) {
        // переносим товары корзины в гипермаркет
        for (const item of basketItems) {
          item.store = HYPER_ID;
          item.cost = item.product.prices[HYPER_ID] * item.qty;
        }
        basketMap.get(HYPER_ID).push(...basketItems);
        basketMap.set(s.id, []);
      }
    }

    const baskets = APP_DATA.stores.map((s) => {
      const basketItems = basketMap.get(s.id);
      const subtotal = basketItems.reduce((sum, item) => sum + item.cost, 0);
      return { store: s, items: basketItems, subtotal };
    });

    const optimal = baskets.reduce((sum, b) => sum + b.subtotal, 0);
    const savings = baseline - optimal;
    const savingsPct = baseline > 0 ? (savings / baseline) * 100 : 0;

    return { baskets, baseline, optimal, savings, savingsPct };
  }

  function renderResults() {
    const root = document.getElementById("results");
    const result = calculate();

    if (!result) {
      root.innerHTML = `<p class="empty-hint">Выберите товары в справочнике слева, чтобы увидеть расчёт корзин.</p>`;
      return;
    }

    const { baskets, baseline, optimal, savings, savingsPct } = result;

    const basketsHtml = baskets
      .filter((b) => b.items.length > 0)
      .map(
        (b) => `
        <div class="basket">
          <h3>${b.store.name} <span class="basket-subtotal">${fmt(b.subtotal)}</span></h3>
          <ul>
            ${b.items
              .map(
                (item) =>
                  `<li><span>${item.product.name} × ${item.qty} ${item.product.unit}</span><span>${fmt(item.cost)}</span></li>`
              )
              .join("")}
          </ul>
        </div>`
      )
      .join("");

    const savingsClass = savings > 0 ? "positive" : savings < 0 ? "negative" : "";

    root.innerHTML = `
      ${basketsHtml}
      <div class="summary">
        <div class="summary-row"><span>Всё в гипермаркете (базовый сценарий)</span><span>${fmt(baseline)}</span></div>
        <div class="summary-row"><span>Оптимальное распределение</span><span>${fmt(optimal)}</span></div>
        <div class="summary-row total ${savingsClass}">
          <span>Экономия</span>
          <span>${fmt(savings)} (${savingsPct.toFixed(1)}%)</span>
        </div>
      </div>
    `;
  }

  function recalcAndRender() {
    renderResults();
  }

  function setupControls() {
    const thresholdInput = document.getElementById("threshold");
    thresholdInput.value = state.threshold;
    thresholdInput.addEventListener("input", () => {
      let v = parseFloat(thresholdInput.value);
      if (isNaN(v) || v < 0) v = 0;
      state.threshold = v;
      recalcAndRender();
    });

    document.getElementById("reset-btn").addEventListener("click", () => {
      state.selected = {};
      state.threshold = DEFAULT_THRESHOLD;
      thresholdInput.value = DEFAULT_THRESHOLD;
      renderCatalog();
      renderResults();
    });
  }

  function init() {
    renderCatalog();
    setupControls();
    renderResults();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
