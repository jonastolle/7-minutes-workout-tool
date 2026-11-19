// Standard 7 minute workout (Klika & Jordan, 2013):
// 12 exercises, 30 s each, 10 s rest between them.
const WORK_SECONDS = 30;
const REST_SECONDS = 10;
// Exercises done one side at a time (marked with `side`) get a short
// break at the halfway mark to change position.
const SWITCH_SECONDS = 3;

const EXERCISES = [
  { name: "Jumping jacks", image: "01-jumping-jacks.svg", hint: "Arms up, legs out, keep a steady rhythm" },
  { name: "Wall sit", image: "02-wall-sit.svg", hint: "Back against the wall, knees at 90°" },
  { name: "Push-ups", image: "03-push-up.svg", hint: "Body straight, chest towards the floor" },
  { name: "Abdominal crunches", image: "04-abdominal-crunch.svg", hint: "Reach for your knees, lift only your shoulder blades" },
  { name: "Step-ups onto a chair", image: "05-step-up.svg", hint: "Alternate legs, stand fully upright on top" },
  { name: "Squats", image: "06-squat.svg", hint: "Hips back, weight on your heels" },
  { name: "Triceps dips on a chair", image: "07-triceps-dip.svg", hint: "Elbows point back, lower slowly" },
  { name: "Plank", image: "08-plank.svg", hint: "Forearms down, body in one straight line" },
  { name: "High knees, running in place", image: "09-high-knees.svg", hint: "Knees up to hip height, pump your arms" },
  { name: "Lunges", image: "10-lunge.svg", hint: "Front knee over the ankle, back knee towards the floor", side: "leg" },
  { name: "Push-ups with rotation", image: "11-push-up-rotation.svg", hint: "After each push-up, rotate and reach to the sky" },
  { name: "Side plank", image: "12-side-plank.svg", hint: "Hips up, body in one straight line", side: "side" },
];

// Build the timeline: work, rest, work, rest, ..., work. A one-sided
// exercise becomes first side, switch break, second side.
const PHASES = [];
EXERCISES.forEach((exercise, i) => {
  if (exercise.side) {
    const half = WORK_SECONDS / 2;
    PHASES.push({ type: "work", index: i, seconds: half, part: 1 });
    PHASES.push({ type: "switch", index: i, seconds: SWITCH_SECONDS });
    PHASES.push({ type: "work", index: i, seconds: half, part: 2 });
  } else {
    PHASES.push({ type: "work", index: i, seconds: WORK_SECONDS });
  }
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
  whistle: $("whistle"),
  march: $("march"),
  bing: $("bing"),
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

// The recording rings for over 20 s; let it ring through most of the
// 10 s rest and fade it out just before the next exercise starts.
const BOWL_HOLD_MS = 3000;
const BOWL_FADE_MS = 6000;
// After the last exercise the bowl is kept short, then the march plays.
const FINAL_BOWL_HOLD_MS = 1500;
const FINAL_BOWL_FADE_MS = 1500;
let bowlFadeHandle = null;

function stopBowl() {
  clearInterval(bowlFadeHandle);
  els.bowl.pause();
  els.bowl.volume = 1;
}

function ringBowl(holdMs = BOWL_HOLD_MS, fadeMs = BOWL_FADE_MS) {
  stopBowl();
  els.bowl.currentTime = 0;
  els.bowl.play().catch(() => {});
  const startedAt = Date.now();
  bowlFadeHandle = setInterval(() => {
    const fade = (Date.now() - startedAt - holdMs) / fadeMs;
    if (fade >= 1) stopBowl();
    else if (fade > 0) els.bowl.volume = 1 - fade;
  }, 50);
}

// A referee whistle marks the start of each exercise. On the first
// exercise it plays inside the Start click, which unlocks the sound.
function blowWhistle() {
  els.whistle.currentTime = 0;
  els.whistle.play().catch(() => {});
}

function stopWhistle() {
  els.whistle.pause();
}

// The display updates every tick. Phase changes, and the sounds that go
// with them, are scheduled for their exact moment instead.
const TICK_MS = 200;
let boundaryTimeout = null;

function scheduleBoundary(msToPhaseEnd) {
  if (state !== "running" || boundaryTimeout !== null || msToPhaseEnd > TICK_MS) return;
  boundaryTimeout = setTimeout(() => {
    boundaryTimeout = null;
    render();
  }, Math.max(0, msToPhaseEnd));
}

function cancelBoundary() {
  clearTimeout(boundaryTimeout);
  boundaryTimeout = null;
}

// A short bing starts the switch break of one-sided exercises.
function playBing() {
  els.bing.currentTime = 0;
  els.bing.play().catch(() => {});
}

// A short march celebrates the finished workout once the last bowl
// has faded. The sample already fades out at its end.
let marchTimeout = null;

function playMarchAfterBowl() {
  stopMarch();
  marchTimeout = setTimeout(() => {
    els.march.currentTime = 0;
    els.march.play().catch(() => {});
  }, FINAL_BOWL_HOLD_MS + FINAL_BOWL_FADE_MS);
}

function stopMarch() {
  clearTimeout(marchTimeout);
  els.march.pause();
}

// Confetti rain for the "Well done!" screen.
const CONFETTI_COLORS = ["#e07b39", "#4f9d8c", "#f2c14e", "#5b8def", "#d65db1", "#8a6cf0"];
const CONFETTI_RAIN_MS = 6000;
const confettiCanvas = $("confetti");
const confettiCtx = confettiCanvas.getContext("2d");
let confettiPieces = [];
let confettiFrame = null;
let confettiStartedAt = 0;

function newConfettiPiece(width, aboveTop) {
  return {
    x: Math.random() * width,
    y: aboveTop ? -20 - Math.random() * 40 : Math.random() * -window.innerHeight,
    w: 6 + Math.random() * 6,
    h: 8 + Math.random() * 8,
    color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
    speed: 1.5 + Math.random() * 2.5,
    sway: Math.random() * Math.PI * 2,
    swaySpeed: 0.02 + Math.random() * 0.04,
    angle: Math.random() * Math.PI,
    spin: (Math.random() - 0.5) * 0.2,
  };
}

function startConfetti() {
  stopConfetti();
  const ratio = window.devicePixelRatio || 1;
  confettiCanvas.width = window.innerWidth * ratio;
  confettiCanvas.height = window.innerHeight * ratio;
  confettiCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
  confettiPieces = Array.from({ length: 150 }, () => newConfettiPiece(window.innerWidth, false));
  confettiStartedAt = Date.now();
  confettiFrame = requestAnimationFrame(drawConfetti);
}

function drawConfetti() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const raining = Date.now() - confettiStartedAt < CONFETTI_RAIN_MS;
  confettiCtx.clearRect(0, 0, width, height);

  confettiPieces = confettiPieces.filter((p) => {
    p.y += p.speed;
    p.sway += p.swaySpeed;
    p.x += Math.sin(p.sway) * 1.2;
    p.angle += p.spin;
    if (p.y > height + 20) {
      // While it is still raining, recycle the piece back to the top.
      if (!raining) return false;
      Object.assign(p, newConfettiPiece(width, true));
    }
    confettiCtx.save();
    confettiCtx.translate(p.x, p.y);
    confettiCtx.rotate(p.angle);
    // Squash the width with the sway so pieces look like they flutter.
    confettiCtx.scale(Math.cos(p.sway * 2), 1);
    confettiCtx.fillStyle = p.color;
    confettiCtx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    confettiCtx.restore();
    return true;
  });

  confettiFrame = confettiPieces.length ? requestAnimationFrame(drawConfetti) : null;
}

function stopConfetti() {
  cancelAnimationFrame(confettiFrame);
  confettiFrame = null;
  confettiPieces = [];
  confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
}

// Keep the screen on while the workout runs. A phone that locks its
// screen pauses the page, and the sound cues would stop or come late.
let wakeLock = null;

async function keepScreenOn() {
  if (!("wakeLock" in navigator) || wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => { wakeLock = null; });
  } catch {
    wakeLock = null; // not allowed here, e.g. low battery mode
  }
}

function allowScreenOff() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

// The browser drops the lock when the page is hidden; take it back.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state === "running") keepScreenOn();
});

// Browsers only allow audio that was first started from a click,
// so play each sound silently once when Start is pressed.
function unlockAudio(audio) {
  audio.muted = true;
  audio.play()
    .then(() => { audio.pause(); audio.muted = false; })
    .catch(() => { audio.muted = false; });
}

function showExercise(phase) {
  const exercise = EXERCISES[phase.index];
  const position = `${phase.index + 1} of ${EXERCISES.length}`;
  els.image.src = `images/${exercise.image}`;
  els.image.alt = exercise.name;
  els.name.textContent = exercise.name;
  els.hint.textContent = exercise.hint;
  if (phase.type === "rest") {
    els.step.textContent = `Up next: exercise ${position}`;
  } else if (phase.type === "switch") {
    els.step.textContent = `Exercise ${position}`;
    els.hint.textContent = `Switch ${exercise.side}s now!`;
  } else if (phase.part) {
    els.step.textContent = `Exercise ${position} · ${phase.part === 1 ? "first" : "second"} ${exercise.side}`;
  } else {
    els.step.textContent = `Exercise ${position}`;
  }
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

  // Ring the bowl each time an exercise ends (a first side running into
  // its switch break doesn't count), including any that were skipped
  // over while the tab was in the background.
  if (state === "running" && phaseIndex > lastPhaseIndex) {
    for (let i = Math.max(lastPhaseIndex, 0); i < phaseIndex; i++) {
      if (PHASES[i].type !== "work" || PHASES[i + 1]?.type === "switch") continue;
      if (phaseIndex >= PHASES.length) ringBowl(FINAL_BOWL_HOLD_MS, FINAL_BOWL_FADE_MS);
      else ringBowl();
      break;
    }
    if (PHASES[phaseIndex]?.type === "work") blowWhistle();
    if (PHASES[phaseIndex]?.type === "switch") playBing();
  }
  if (state === "running") lastPhaseIndex = phaseIndex;

  els.totalTime.textContent = formatTime(TOTAL_SECONDS - elapsed);
  els.totalBar.style.width = `${Math.min(100, (elapsed / TOTAL_SECONDS) * 100)}%`;

  if (phaseIndex >= PHASES.length) {
    finish();
    return;
  }

  const phase = PHASES[phaseIndex];
  scheduleBoundary((phase.seconds - intoPhase) * 1000);

  // Rest and switch phases carry the index of the exercise they belong
  // to, so in every case each exercise before `phase.index` is done.
  showExercise(phase);
  markPlan(phase.index, state === "idle" ? -1 : phase.index);

  const label = { work: "Exercise", rest: "Rest", switch: "Switch" }[phase.type];
  els.phaseTime.textContent = formatTime(phase.seconds - intoPhase);
  els.phaseBar.style.width = `${(intoPhase / phase.seconds) * 100}%`;
  els.phaseBar.classList.toggle("rest", phase.type !== "work");
  els.phaseTimerLabel.textContent = label;

  els.phaseLabel.className = "phase-label";
  if (state === "idle") {
    els.phaseLabel.textContent = "Ready";
  } else if (state === "paused") {
    els.phaseLabel.textContent = "Paused";
  } else {
    els.phaseLabel.textContent = phase.type === "work" ? "Go!" : label;
    els.phaseLabel.classList.add(phase.type === "work" ? "work" : "rest");
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
  unlockAudio(els.march);
  unlockAudio(els.bing);
  state = "running";
  runStartedAt = Date.now();
  tickHandle = setInterval(render, TICK_MS);
  keepScreenOn();
  setButtons();
  render();
}

function togglePause() {
  if (state === "running") {
    elapsedBefore = elapsedMs();
    state = "paused";
    clearInterval(tickHandle);
    cancelBoundary();
    allowScreenOff();
  } else if (state === "paused") {
    state = "running";
    runStartedAt = Date.now();
    tickHandle = setInterval(render, TICK_MS);
    keepScreenOn();
  }
  setButtons();
  render();
}

function reset() {
  clearInterval(tickHandle);
  state = "idle";
  elapsedBefore = 0;
  lastPhaseIndex = -1;
  cancelBoundary();
  allowScreenOff();
  stopBowl();
  stopWhistle();
  stopMarch();
  stopConfetti();
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
  els.totalBar.style.width = "100%";
  setButtons();
  startConfetti();
  playMarchAfterBowl();
  allowScreenOff();
}

els.start.addEventListener("click", start);
els.pause.addEventListener("click", togglePause);
els.stop.addEventListener("click", reset);

buildPlan();
reset();
