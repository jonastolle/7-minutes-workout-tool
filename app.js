// Standard 7 minute workout (Klika & Jordan, 2013):
// 12 exercises, 30 s each, 10 s rest between them.
const WORK_SECONDS = 30;
const REST_SECONDS = 10;

const EXERCISES = [
  { name: "Jumping jacks", image: "01-jumping-jacks.svg", hint: "Arms up, legs out, keep a steady rhythm" },
  { name: "Wall sit", image: "02-wall-sit.svg", hint: "Back against the wall, knees at 90°" },
  { name: "Push-ups", image: "03-push-up.svg", hint: "Body straight, chest towards the floor" },
  { name: "Abdominal crunches", image: "04-abdominal-crunch.svg", hint: "Lift your shoulders, keep your lower back down" },
  { name: "Step-ups onto a chair", image: "05-step-up.svg", hint: "Alternate legs, stand fully upright on top" },
  { name: "Squats", image: "06-squat.svg", hint: "Hips back, weight on your heels" },
  { name: "Triceps dips on a chair", image: "07-triceps-dip.svg", hint: "Elbows point back, lower slowly" },
  { name: "Plank", image: "08-plank.svg", hint: "Forearms down, body in one straight line" },
  { name: "High knees, running in place", image: "09-high-knees.svg", hint: "Knees up to hip height, pump your arms" },
  { name: "Lunges", image: "10-lunge.svg", hint: "Alternate legs, front knee over the ankle" },
  { name: "Push-ups with rotation", image: "11-push-up-rotation.svg", hint: "After each push-up, rotate and reach to the sky" },
  { name: "Side plank", image: "12-side-plank.svg", hint: "Switch sides halfway through" },
];

// Build the timeline: work, rest, work, rest, ..., work.
const PHASES = [];
EXERCISES.forEach((exercise, i) => {
  PHASES.push({ type: "work", index: i, seconds: WORK_SECONDS });
  if (i < EXERCISES.length - 1) {
    PHASES.push({ type: "rest", index: i + 1, seconds: REST_SECONDS });
  }
});
const TOTAL_SECONDS = PHASES.reduce((sum, p) => sum + p.seconds, 0);

const $ = (id) => document.getElementById(id);
const els = {
  phaseLabel: $("phase-label"),
  image: $("exercise-image"),
  step: $("exercise-step"),
  name: $("exercise-name"),
  hint: $("exercise-hint"),
  phaseTimerLabel: $("phase-timer-label"),
  phaseTime: $("phase-time"),
  phaseBar: $("phase-bar"),
  totalTime: $("total-time"),
  totalBar: $("total-bar"),
  start: $("start-btn"),
  pause: $("pause-btn"),
  stop: $("stop-btn"),
  plan: $("plan-list"),
  bowl: $("bowl"),
  clap: $("clap"),
};

// Timer state. Elapsed time is measured against the clock, so the
// countdown does not drift when the tab is throttled.
let state = "idle"; // idle | running | paused | finished
let elapsedBefore = 0; // ms accumulated before the current run segment
let runStartedAt = 0;
let tickHandle = null;
let lastPhaseIndex = -1;

function buildPlan() {
  EXERCISES.forEach((exercise, i) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <img src="images/${exercise.image}" alt="">
      <span class="label">${i + 1}. ${exercise.name}</span>
      <span class="check" aria-hidden="true"></span>`;
    els.plan.appendChild(li);
  });
}

function formatTime(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function elapsedMs() {
  return state === "running" ? elapsedBefore + (Date.now() - runStartedAt) : elapsedBefore;
}

// Returns which phase we are in and how far into it.
function locate(elapsedSeconds) {
  let t = elapsedSeconds;
  for (let i = 0; i < PHASES.length; i++) {
    if (t < PHASES[i].seconds) return { phaseIndex: i, intoPhase: t };
    t -= PHASES[i].seconds;
  }
  return { phaseIndex: PHASES.length, intoPhase: 0 };
}

// The recording rings for over 20 s; play only the strike and fade it out.
const BOWL_HOLD_MS = 1000;
const BOWL_FADE_MS = 2000;
let bowlFadeHandle = null;

function stopBowl() {
  clearInterval(bowlFadeHandle);
  els.bowl.pause();
  els.bowl.volume = 1;
}

function ringBowl() {
  stopBowl();
  els.bowl.currentTime = 0;
  els.bowl.play().catch(() => {});
  const startedAt = Date.now();
  bowlFadeHandle = setInterval(() => {
    const fade = (Date.now() - startedAt - BOWL_HOLD_MS) / BOWL_FADE_MS;
    if (fade >= 1) stopBowl();
    else if (fade > 0) els.bowl.volume = 1 - fade;
  }, 50);
}

// Three claps mark the start of each exercise.
const CLAP_COUNT = 3;
const CLAP_GAP_MS = 400;
let clapTimeouts = [];

function stopClaps() {
  clapTimeouts.forEach(clearTimeout);
  clapTimeouts = [];
}

function clap() {
  els.clap.currentTime = 0;
  els.clap.play().catch(() => {});
}

// The first clap plays right away, so on the very first exercise it
// runs inside the Start click and that unlocks the clap sound.
function clapThreeTimes() {
  stopClaps();
  clap();
  for (let i = 1; i < CLAP_COUNT; i++) {
    clapTimeouts.push(setTimeout(clap, i * CLAP_GAP_MS));
  }
}

// Browsers only allow audio that was first started from a click,
// so play each sound silently once when Start is pressed.
function unlockAudio(audio) {
  audio.muted = true;
  audio.play()
    .then(() => { audio.pause(); audio.muted = false; })
    .catch(() => { audio.muted = false; });
}

function showExercise(index, type) {
  const exercise = EXERCISES[index];
  els.image.src = `images/${exercise.image}`;
  els.image.alt = exercise.name;
  els.name.textContent = exercise.name;
  els.hint.textContent = exercise.hint;
  els.step.textContent = type === "rest"
    ? `Up next: exercise ${index + 1} of ${EXERCISES.length}`
    : `Exercise ${index + 1} of ${EXERCISES.length}`;
}

function markPlan(doneCount, currentIndex) {
  [...els.plan.children].forEach((li, i) => {
    li.classList.toggle("done", i < doneCount);
    li.classList.toggle("current", i === currentIndex);
  });
}

function render() {
  const elapsed = elapsedMs() / 1000;
  const { phaseIndex, intoPhase } = locate(elapsed);

  // Ring the bowl each time an exercise phase ends, including any
  // that were skipped over while the tab was in the background.
  if (state === "running" && phaseIndex > lastPhaseIndex) {
    for (let i = Math.max(lastPhaseIndex, 0); i < phaseIndex; i++) {
      if (PHASES[i].type === "work") { ringBowl(); break; }
    }
    if (PHASES[phaseIndex]?.type === "work") clapThreeTimes();
  }
  if (state === "running") lastPhaseIndex = phaseIndex;

  els.totalTime.textContent = formatTime(TOTAL_SECONDS - elapsed);
  els.totalBar.style.width = `${Math.min(100, (elapsed / TOTAL_SECONDS) * 100)}%`;

  if (phaseIndex >= PHASES.length) {
    finish();
    return;
  }

  const phase = PHASES[phaseIndex];
  // A rest phase carries the index of the exercise that follows it,
  // so in both cases every exercise before `phase.index` is done.
  showExercise(phase.index, phase.type);
  markPlan(phase.index, state === "idle" ? -1 : phase.index);

  els.phaseTime.textContent = formatTime(phase.seconds - intoPhase);
  els.phaseBar.style.width = `${(intoPhase / phase.seconds) * 100}%`;
  els.phaseBar.classList.toggle("rest", phase.type === "rest");
  els.phaseTimerLabel.textContent = phase.type === "rest" ? "Rest" : "Exercise";

  els.phaseLabel.className = "phase-label";
  if (state === "idle") {
    els.phaseLabel.textContent = "Ready";
  } else if (state === "paused") {
    els.phaseLabel.textContent = "Paused";
  } else {
    els.phaseLabel.textContent = phase.type === "rest" ? "Rest" : "Go!";
    els.phaseLabel.classList.add(phase.type);
  }
}

function setButtons() {
  els.start.disabled = state === "running" || state === "paused";
  els.pause.disabled = !(state === "running" || state === "paused");
  els.pause.textContent = state === "paused" ? "Resume" : "Pause";
  els.stop.disabled = state === "idle";
  els.start.textContent = state === "finished" ? "Start again" : "Start";
}

function start() {
  if (state === "finished") reset();
  unlockAudio(els.bowl);
  state = "running";
  runStartedAt = Date.now();
  tickHandle = setInterval(render, 200);
  setButtons();
  render();
}

function togglePause() {
  if (state === "running") {
    elapsedBefore = elapsedMs();
    state = "paused";
    clearInterval(tickHandle);
  } else if (state === "paused") {
    state = "running";
    runStartedAt = Date.now();
    tickHandle = setInterval(render, 200);
  }
  setButtons();
  render();
}

function reset() {
  clearInterval(tickHandle);
  state = "idle";
  elapsedBefore = 0;
  lastPhaseIndex = -1;
  stopBowl();
  stopClaps();
  setButtons();
  render();
}

function finish() {
  clearInterval(tickHandle);
  state = "finished";
  elapsedBefore = TOTAL_SECONDS * 1000;
  markPlan(EXERCISES.length, -1);
  els.phaseLabel.className = "phase-label rest";
  els.phaseLabel.textContent = "Done!";
  els.step.textContent = "Workout complete";
  els.name.textContent = "Well done!";
  els.hint.textContent = "All 12 exercises finished.";
  els.phaseTime.textContent = "0:00";
  els.phaseBar.style.width = "100%";
  els.totalTime.textContent = "0:00";
  setButtons();
}

els.start.addEventListener("click", start);
els.pause.addEventListener("click", togglePause);
els.stop.addEventListener("click", reset);

buildPlan();
reset();
