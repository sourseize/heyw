// ── HeyWork: Pop-out countdown window ──
//
// A deliberately tiny surface: the countdown, what it is attached to, and two
// buttons. It keeps its own heartbeat, so this window alone is enough to hold a
// focus block open while the main app is closed — which is the point: you should
// be able to work without HeyWork on screen.
(function () {
  const theme = localStorage.getItem('heyw-theme') || 'light';
  document.documentElement.setAttribute('data-theme', theme);

  const typeEl = document.getElementById('popout-type');
  const timeEl = document.getElementById('popout-time');
  const taskEl = document.getElementById('popout-task');
  const toggleBtn = document.getElementById('popout-toggle');
  const stopBtn = document.getElementById('popout-stop');

  function render(state) {
    const active = Boolean(state);
    document.getElementById('popout').classList.toggle('is-idle', !active);
    typeEl.textContent = active ? FocusTimer.typeLabel(state.type) : 'No timer running';
    timeEl.textContent = active ? FocusTimer.formatRemaining() : '--:--';
    taskEl.textContent = active && state.taskTitle ? state.taskTitle : '';
    toggleBtn.textContent = !active ? 'Start' : state.running ? 'Pause' : 'Resume';
    toggleBtn.disabled = !active;
    stopBtn.disabled = !active;
    document.body.classList.toggle('running', Boolean(active && state.running && state.type === 'focus'));
  }

  toggleBtn.addEventListener('click', () => FocusTimer.toggle());
  stopBtn.addEventListener('click', () => FocusTimer.stop());

  FocusTimer.onChange(render);
  // The pop-out must not be counted as "tinkering with the app": it is a read-only
  // presence beacon, so interaction tracking stays off here.
  FocusTimer.init({ heartbeatMs: 10000, syncMs: 20000, trackInteractions: false });
  render(FocusTimer.state);
})();
