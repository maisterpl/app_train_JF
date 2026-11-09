/* The server renders the real chart; JavaScript adds touch and keyboard selection. */
const chart = document.getElementById('progress-chart');
const source = document.getElementById('exercise-progress-data');
if (chart && source) {
  const data = JSON.parse(source.textContent);
  const points = [...chart.querySelectorAll('[data-progress-index]')];
  let selected = data.length - 1;
  const previous = document.getElementById('progress-previous');
  const next = document.getElementById('progress-next');
  function select(index, focus = false) {
    if (!Number.isInteger(index) || index < 0 || index >= data.length) return;
    selected = index;
    const point = data[index];
    document.getElementById('progress-selected-date').textContent = point.datetime_label || point.label;
    document.getElementById('progress-selected-result').textContent = point.detail;
    document.getElementById('progress-selected-link').href = point.url;
    previous.disabled = index === 0;
    next.disabled = index === data.length - 1;
    points.forEach((node, current) => {
      node.classList.toggle('is-selected', current === index);
      if (current === index) node.setAttribute('aria-current', 'true');
      else node.removeAttribute('aria-current');
    });
    if (focus) points[index]?.focus({preventScroll:true});
  }
  chart.addEventListener('click', event => {
    const point = event.target.closest('[data-progress-index]');
    if (!point || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    select(Number(point.dataset.progressIndex));
  });
  chart.addEventListener('keydown', event => {
    const point = event.target.closest('[data-progress-index]');
    if (!point) return;
    const index = Number(point.dataset.progressIndex);
    const actions = {ArrowLeft:index-1, ArrowRight:index+1, Home:0, End:data.length-1, Enter:index, ' ':index};
    if (!(event.key in actions)) return;
    event.preventDefault();
    select(Math.max(0,Math.min(data.length-1,actions[event.key])),true);
  });
  previous.addEventListener('click', () => select(selected - 1));
  next.addEventListener('click', () => select(selected + 1));
  document.getElementById('progress-controls').hidden = false;
  select(selected);
}
