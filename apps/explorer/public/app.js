const byId = (id) => document.getElementById(id);
let endpoints = [];
let selected;
let exchange = 'All';
let preview = 'javascript';
let view = 'json';
let running = false;
let history = [];
const drafts = new Map();
const results = new Map();
let toastTimer;

function icons() {
  window.lucide?.createIcons();
}
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function toast(message) {
  byId('toast').textContent = message;
  byId('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    byId('toast').hidden = true;
  }, 2500);
}
async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied');
  } catch {
    toast('Clipboard access unavailable');
  }
}
function renderEndpoints() {
  const search = byId('search').value.trim().toLowerCase();
  const filtered = endpoints.filter(
    (endpoint) =>
      (exchange === 'All' || endpoint.exchange === exchange) &&
      `${endpoint.title} ${endpoint.method} ${endpoint.group} ${endpoint.exchange}`
        .toLowerCase()
        .includes(search)
  );
  byId('endpoint-count').textContent = filtered.length;
  const nav = byId('endpoints');
  nav.replaceChildren();
  for (const group of [
    ...new Set(filtered.map((endpoint) => endpoint.group)),
  ]) {
    nav.append(element('h3', 'group-heading', group));
    for (const endpoint of filtered.filter((item) => item.group === group)) {
      const button = element('button', 'endpoint-button');
      button.type = 'button';
      button.setAttribute('aria-current', String(endpoint.id === selected?.id));
      button.append(
        element(
          'span',
          `exchange-mini ${endpoint.exchange.toLowerCase()}`,
          endpoint.exchange
        ),
        element('span', '', endpoint.title)
      );
      button.onclick = () => select(endpoint);
      nav.append(button);
    }
  }
  if (!filtered.length)
    nav.append(element('p', 'muted', 'No matching endpoints'));
}
function params() {
  const values = {};
  for (const field of selected.fields) {
    const input = byId(`param-${field.name}`);
    if (input.disabled) continue;
    const value = input.value.trim();
    if (value)
      values[field.name] = field.type === 'number' ? Number(value) : value;
  }
  return values;
}
function updateForecastDates() {
  if (selected?.id !== 'nse-forecast') return;
  const joint = byId('param-model')?.value === 'technical_finbert';
  const sentiment = byId('param-sentiment');
  const context = byId('param-context');
  if (sentiment && context) {
    if (joint) {
      sentiment.value = 'finbert';
      context.value = 'auto';
    }
    sentiment.disabled = joint;
    context.disabled = joint;
  }
  const custom = byId('param-horizon').value === 'custom';
  for (const name of ['start_date', 'end_date']) {
    const input = byId(`param-${name}`);
    const wrapper = input.closest('.field');
    wrapper.hidden = !custom;
    input.disabled = !custom;
    input.required = custom;
    const label = wrapper.querySelector('label span');
    label.textContent = custom ? 'required' : 'optional';
    label.className = custom ? 'required' : '';
  }
  const start = byId('param-start_date').value;
  const end = byId('param-end_date');
  if (custom && start) {
    end.min = start;
    end.max = new Date(Date.parse(`${start}T00:00:00Z`) + 6 * 86400000)
      .toISOString()
      .slice(0, 10);
  } else {
    end.removeAttribute('min');
    end.removeAttribute('max');
  }
}
function saveDraft() {
  if (!selected) return;
  drafts.set(
    selected.id,
    Object.fromEntries(
      selected.fields.map((field) => [
        field.name,
        byId(`param-${field.name}`).value,
      ])
    )
  );
}
function select(endpoint) {
  saveDraft();
  selected = endpoint;
  location.hash = endpoint.id;
  byId('endpoint-title').textContent = endpoint.title;
  byId('breadcrumb-exchange').textContent = endpoint.exchange;
  byId('breadcrumb-group').textContent = endpoint.group;
  byId('group-label').textContent = endpoint.group;
  byId('exchange-badge').textContent = endpoint.exchange;
  byId('exchange-badge').className =
    `exchange-badge ${endpoint.exchange.toLowerCase()}`;
  byId('method-name').textContent =
    `${endpoint.exchange.toLowerCase()}.${endpoint.method}()`;
  byId('request-path').textContent = `/api/run/${endpoint.id}`;
  const fields = byId('fields');
  fields.replaceChildren();
  for (const field of endpoint.fields) {
    const wrapper = element('div', 'field');
    const label = element('label', '', field.name);
    label.htmlFor = `param-${field.name}`;
    label.append(
      element(
        'span',
        field.required ? 'required' : '',
        field.required ? 'required' : 'optional'
      )
    );
    const input = element(field.choices ? 'select' : 'input');
    input.id = `param-${field.name}`;
    input.name = field.name;
    input.required = Boolean(field.required);
    if (field.choices) {
      if (!field.required) input.append(new Option('Default', ''));
      for (const choice of field.choices)
        input.append(
          new Option(
            field.name === 'model'
              ? ({
                  technical: 'LightGBM',
                  technical_finbert: 'LightGBM + Local FinBERT',
                  baseline: 'Statistical baseline',
                }[choice] ?? choice)
              : choice,
            choice
          )
        );
    } else {
      input.type = field.type === 'string' ? 'text' : field.type;
      if (field.type === 'number') {
        input.min = String(field.min ?? 1);
        if (field.max !== undefined) input.max = String(field.max);
        input.step = '1';
      }
      input.maxLength = 200;
      input.placeholder =
        field.type === 'date' ? 'YYYY-MM-DD' : (field.example ?? '');
    }
    input.value = drafts.get(endpoint.id)?.[field.name] ?? field.example ?? '';
    if (field.description)
      wrapper.append(element('small', 'muted', field.description));
    input.oninput = () => {
      updateForecastDates();
      saveDraft();
      renderPreview();
    };
    wrapper.append(label, input);
    fields.append(wrapper);
  }
  if (!endpoint.fields.length)
    fields.append(element('p', 'no-params', 'No parameters'));
  byId('execute').disabled = running;
  updateForecastDates();
  renderEndpoints();
  renderPreview();
  renderResponse();
}
function shellQuote(text) {
  return `'${text.replaceAll("'", "'\\''")}'`;
}
function renderPreview() {
  if (!selected) return;
  const values = params();
  if (preview === 'curl') {
    byId('request-code').textContent =
      `curl -X POST ${shellQuote(`${location.origin}/api/run/${selected.id}`)} \\\n  -H 'Content-Type: application/json' \\\n  -d ${shellQuote(JSON.stringify(values))}`;
    return;
  }
  const positional = [
    'equityQuote',
    'equityMetaInfo',
    'listEquityStocksByIndex',
    'market.lookup',
    'holidays',
    'options.getOptionChain',
    'getExpiryDatesV3',
    'quote',
    'lookupSymbol',
  ];
  const argument = positional.includes(selected.method)
    ? Object.values(values).length
      ? JSON.stringify(Object.values(values)[0])
      : ''
    : selected.method === 'listPastIPO'
      ? ['from_date', 'to_date']
          .map((name) =>
            values[name]
              ? `new Date(${JSON.stringify(`${values[name]}T00:00:00`)})`
              : 'undefined'
          )
          .join(', ')
      : selected.fields.length
        ? `{${Object.keys(values).length ? '\n' : ''}${Object.entries(values)
            .map(
              ([name, value]) =>
                `  ${name}: ${selected.method !== 'forecastStock' && selected.fields.find((field) => field.name === name).type === 'date' ? `new Date(${JSON.stringify(`${value}T00:00:00`)})` : JSON.stringify(value)}`
            )
            .join(',\n')}${Object.keys(values).length ? '\n' : ''}}`
        : '';
  const client = selected.exchange.toLowerCase();
  byId('request-code').textContent =
    `import { ${selected.exchange} } from 'nse-bse-api';\n\nconst ${client} = new ${selected.exchange}(${client === 'nse' ? "'./downloads'" : ''});\ntry {\n  const data = await ${client}.${selected.method}(${argument});\n  console.log(data);\n} finally {\n  ${client}.${client === 'nse' ? 'exit' : 'close'}();\n}`;
}
function tableRows(data) {
  if (
    Array.isArray(data) &&
    data.length &&
    data.every((row) => row && typeof row === 'object' && !Array.isArray(row))
  )
    return data;
  if (data && typeof data === 'object') {
    for (const key of ['data', 'Table', 'results', 'forecast'])
      if (Array.isArray(data[key])) return tableRows(data[key]);
  }
  return null;
}
function jsonNode(data) {
  const pre = element('pre');
  const text = JSON.stringify(data, null, 2);
  const pattern =
    /"(?:\\.|[^"\\])*"\s*:|"(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    pre.append(document.createTextNode(text.slice(cursor, match.index)));
    const token = match[0];
    pre.append(
      element(
        'span',
        token.endsWith(':')
          ? 'json-key'
          : token.startsWith('"')
            ? 'json-string'
            : /^(true|false|null)$/.test(token)
              ? 'json-null'
              : 'json-number',
        token
      )
    );
    cursor = match.index + token.length;
  }
  pre.append(document.createTextNode(text.slice(cursor)));
  return pre;
}
function renderResponse() {
  const result = results.get(selected?.id);
  const body = byId('response-body');
  const meta = byId('response-meta');
  meta.replaceChildren();
  body.replaceChildren();
  byId('copy-response').disabled = !result;
  byId('download-response').disabled = !result;
  const rows = result && !result.error ? tableRows(result.data) : null;
  document.querySelector('[data-view="table"]').disabled = !rows;
  if (!rows) view = 'json';
  document
    .querySelectorAll('[data-view]')
    .forEach((button) =>
      button.setAttribute('aria-pressed', String(button.dataset.view === view))
    );
  byId('row-count').textContent = rows
    ? `${Math.min(200, rows.length)} / ${rows.length} rows`
    : '';
  if (!result) {
    const empty = element('div', 'empty-state');
    const icon = element('i');
    icon.dataset.lucide = 'braces';
    empty.append(
      icon,
      element('h3', '', 'No response yet'),
      element('span', 'muted', '-')
    );
    body.append(empty);
    icons();
    return;
  }
  meta.append(
    element(
      'span',
      `status ${result.error ? 'error' : ''}`,
      `${result.status} ${result.error ? 'ERROR' : 'OK'}`
    ),
    element('span', '', `${result.durationMs} ms`),
    element(
      'span',
      '',
      `${(new Blob([JSON.stringify(result.data)]).size / 1024).toFixed(1)} KB`
    )
  );
  if (selected.id === 'nse-forecast' && !result.error && result.data.summary) {
    const data = result.data;
    const target = data.forecast[data.forecast.length - 1];
    const summary = element('section', 'forecast-summary');
    summary.append(
      element(
        'h3',
        '',
        `${data.symbol} / ${data.forecast.length} trading session${data.forecast.length === 1 ? '' : 's'}`
      )
    );
    const metrics = element('div', 'forecast-metrics');
    for (const [label, value] of [
      ['Estimated direction', data.summary.estimatedDirection.toUpperCase()],
      ['Directional signal', data.summary.signal.toUpperCase()],
      ['Estimated close', `INR ${target.estimatedClose.toFixed(2)}`],
      [
        'Expected change',
        `${data.summary.expectedChangePct > 0 ? '+' : ''}${data.summary.expectedChangePct.toFixed(2)}%`,
      ],
    ]) {
      const metric = element('div');
      metric.append(
        element('span', 'muted', label),
        element('strong', '', value)
      );
      metrics.append(metric);
    }
    summary.append(
      ...(data.forecastRange
        ? [
            element(
              'p',
              'muted',
              `${data.forecastRange.startDate} to ${data.forecastRange.endDate} / ${data.forecastRange.calendarDays} calendar days`
            ),
          ]
        : []),
      metrics,
      element(
        'p',
        'muted',
        `Last close: INR ${data.lastClose.price.toFixed(2)} (${data.lastClose.date}). Approximate 95% range: INR ${target.predictionInterval95.lower.toFixed(2)} to ${target.predictionInterval95.upper.toFixed(2)}.`
      ),
      element('p', '', data.summary.reason),
      element('p', 'forecast-warning', data.warnings[0]),
      ...(data.forecastRange
        ? [
            element(
              'p',
              'forecast-warning',
              'Weekday estimates; exchange holidays are not modeled.'
            ),
          ]
        : [])
    );
    body.append(summary);
    const modelPanel = element('section', 'forecast-context');
    modelPanel.append(element('h3', '', data.model.name));
    if (data.model.training) {
      const training = data.model.training;
      modelPanel.append(
        element(
          'p',
          'muted',
          `${training.trainingRows} training rows / ${training.sentimentDays} sentiment dates / through ${training.trainedThrough}`
        ),
        element('p', '', training.features.join(', ')),
        element('p', 'forecast-warning', training.validation)
      );
      if (training.folds) {
        const details = element('details');
        details.append(
          element('summary', '', `${training.folds.length} rolling folds`)
        );
        for (const fold of training.folds)
          details.append(
            element(
              'p',
              'muted',
              `${fold.horizon}-session target / train ${fold.trainStart} to ${fold.trainEndExclusive} (exclusive) / test ${fold.testStart} to ${fold.testEndExclusive} (exclusive) / ${fold.trainRows} train, ${fold.testRows} test`
            )
          );
        modelPanel.append(details);
      }
    }
    body.append(modelPanel);
    if (data.context) {
      const context = data.context;
      const panel = element('section', 'forecast-context');
      panel.append(
        element('h3', '', 'Market & News'),
        element('p', 'muted', `Information cutoff: ${context.asOf}`)
      );
      panel.append(
        element(
          'p',
          '',
          context.market.applied
            ? `NSE ${context.market.proxy}: ${context.market.recentChange5Pct.toFixed(2)}% over five observations / beta ${context.market.beta.toFixed(2)} / volatility ${context.market.volatilityRatio.toFixed(2)}x`
            : `NSE ${context.market.proxy}: ${context.market.status}; no market adjustment applied.`
        )
      );
      panel.append(
        element(
          'p',
          '',
          `Local archive: ${context.news.status.replaceAll('_', ' ')} / ${context.news.scope}`
        )
      );
      panel.append(
        element(
          'p',
          '',
          `Sentiment engine: ${context.news.sentimentEngine === 'finbert' ? 'ProsusAI/finbert (local ONNX)' : 'off'} / ${context.news.sentimentStatus ?? 'not requested'}`
        )
      );
      if (context.news.status === 'available') {
        panel.append(
          element(
            'p',
            'muted',
            `${context.news.articles.length} sampled articles / ${context.news.todayArticles} on cutoff day / sentiment ${context.news.averagePolarity === null ? 'unavailable' : context.news.averagePolarity.toFixed(2)} / ${context.news.requestedFrom} to ${context.news.requestedTo}`
          )
        );
        const articles = element('ul', 'news-articles');
        for (const article of context.news.articles.slice(0, 5)) {
          const item = element('li');
          const link = element(article.url ? 'a' : 'span', '', article.title);
          if (article.url) {
            link.href = article.url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
          }
          item.append(link, element('time', 'muted', article.publishedAt));
          articles.append(item);
        }
        panel.append(articles);
      }
      for (const warning of context.warnings)
        panel.append(element('p', 'forecast-warning', warning));
      if (context.elevatedRisk)
        panel.append(
          element(
            'p',
            'forecast-warning',
            'Elevated market/news risk. Directional signal withheld.'
          )
        );
      panel.append(
        element(
          'p',
          'muted',
          data.backtest.includesNews
            ? 'Backtest includes historical FinBERT features; excludes the additional live news-risk overlay.'
            : 'Backtest excludes the news-risk overlay.'
        )
      );
      body.append(panel);
    }
  }
  if (view === 'table' && rows) {
    const table = element('table');
    const head = element('thead');
    const header = element('tr');
    const columns = [
      ...new Set(rows.slice(0, 200).flatMap((row) => Object.keys(row))),
    ].slice(0, 30);
    for (const column of columns) header.append(element('th', '', column));
    head.append(header);
    table.append(head);
    const tbody = element('tbody');
    for (const row of rows.slice(0, 200)) {
      const tr = element('tr');
      for (const column of columns) {
        const value = row[column];
        const text =
          value == null
            ? '-'
            : typeof value === 'object'
              ? JSON.stringify(value)
              : String(value);
        const cell = element('td', '', text);
        cell.title = text;
        tr.append(cell);
      }
      tbody.append(tr);
    }
    table.append(tbody);
    body.append(table);
  } else body.append(jsonNode(result.data));
}
function renderHistory() {
  const container = byId('history');
  container.replaceChildren();
  if (!history.length)
    container.append(element('p', 'muted', 'No requests yet'));
  for (const item of history.slice(0, 6)) {
    const button = element('button', 'history-item');
    button.type = 'button';
    button.append(
      element('span', `dot ${item.error ? 'failed' : ''}`),
      element('span', '', `${item.endpoint.exchange} ${item.endpoint.title}`),
      element('time', '', item.time)
    );
    button.onclick = () => {
      exchange = 'All';
      updateExchangeButtons();
      select(item.endpoint);
    };
    container.append(button);
  }
  drawLatency();
}
function drawLatency() {
  const canvas = byId('latency-chart');
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = '#dce6df';
  context.beginPath();
  for (const height of [12, 28, 44]) {
    context.moveTo(0, height);
    context.lineTo(160, height);
  }
  context.stroke();
  if (!history.length) return;
  const items = history.slice(0, 12).reverse();
  const maximum = Math.max(...items.map((item) => item.durationMs), 1);
  for (const [index, item] of items.entries()) {
    const height = Math.max(3, (item.durationMs / maximum) * 38);
    context.fillStyle = item.error ? '#c66d27' : '#087e6c';
    context.fillRect(index * 13 + 2, 44 - height, 8, height);
  }
  canvas.setAttribute(
    'aria-label',
    `Recent request latency: ${items.map((item) => `${item.durationMs} milliseconds`).join(', ')}`
  );
}
function updateExchangeButtons() {
  document
    .querySelectorAll('[data-exchange]')
    .forEach((button) =>
      button.setAttribute(
        'aria-pressed',
        String(button.dataset.exchange === exchange)
      )
    );
}
byId('request-form').onsubmit = async (event) => {
  event.preventDefault();
  if (running || !selected) return;
  const endpoint = selected;
  const values = params();
  running = true;
  byId('execute').disabled = true;
  byId('execute').querySelector('span').textContent = 'Running...';
  byId('request-state').textContent =
    `${endpoint.exchange} / ${endpoint.title}`;
  const start = performance.now();
  let result;
  try {
    const response = await fetch(`/api/run/${endpoint.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    const payload = await response.json();
    result = {
      data: response.ok
        ? payload.data
        : { error: payload.error ?? 'Request failed' },
      status: response.status,
      error: !response.ok,
      durationMs: payload.durationMs ?? Math.round(performance.now() - start),
    };
  } catch (error) {
    result = {
      data: { error: error.message },
      status: 'NETWORK',
      error: true,
      durationMs: Math.round(performance.now() - start),
    };
  } finally {
    running = false;
    byId('execute').disabled = false;
    byId('execute').querySelector('span').textContent = 'Execute Request';
    byId('request-state').textContent = '';
  }
  results.set(endpoint.id, result);
  history.unshift({
    ...result,
    endpoint,
    time: new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    }),
  });
  history = history.slice(0, 12);
  renderHistory();
  renderResponse();
};
byId('search').oninput = renderEndpoints;
document.querySelectorAll('[data-exchange]').forEach((button) => {
  button.onclick = () => {
    exchange = button.dataset.exchange;
    updateExchangeButtons();
    renderEndpoints();
  };
});
document.querySelectorAll('[data-preview]').forEach((button) => {
  button.onclick = () => {
    preview = button.dataset.preview;
    document
      .querySelectorAll('[data-preview]')
      .forEach((item) =>
        item.setAttribute('aria-pressed', String(item === button))
      );
    renderPreview();
  };
});
document.querySelectorAll('[data-view]').forEach((button) => {
  button.onclick = () => {
    view = button.dataset.view;
    renderResponse();
  };
});
byId('reset').onclick = () => {
  if (!selected) return;
  for (const field of selected.fields)
    byId(`param-${field.name}`).value = field.example ?? '';
  updateForecastDates();
  saveDraft();
  renderPreview();
};
byId('copy-request').onclick = () => copy(byId('request-code').textContent);
byId('copy-response').onclick = () =>
  copy(JSON.stringify(results.get(selected.id).data, null, 2));
byId('download-response').onclick = () => {
  const blob = new Blob(
    [JSON.stringify(results.get(selected.id).data, null, 2)],
    { type: 'application/json' }
  );
  const url = URL.createObjectURL(blob);
  const link = element('a');
  link.href = url;
  link.download = `${selected.id}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
byId('clear-history').onclick = () => {
  history = [];
  renderHistory();
};
window.addEventListener('hashchange', () => {
  const endpoint = endpoints.find((item) => item.id === location.hash.slice(1));
  if (endpoint && endpoint.id !== selected?.id) select(endpoint);
});
async function init() {
  icons();
  drawLatency();
  try {
    const response = await fetch('/api/endpoints');
    if (!response.ok) throw new Error('Could not load endpoint catalogue');
    endpoints = await response.json();
    select(
      endpoints.find((endpoint) => endpoint.id === location.hash.slice(1)) ??
        endpoints[0]
    );
  } catch (error) {
    byId('endpoints').replaceChildren(element('p', 'muted', error.message));
    byId('request-state').textContent = 'Server unavailable';
  }
}
init();
