// Paste this file into CodePen's JS panel. Initialization also works when
// the script runs before the HTML has finished loading.
function initializeGame() {
  const desktop = document.querySelector("#desktop");
  const windows = document.querySelector("#windows");
  const vacuum = document.querySelector("#vacuum");
  const hint = document.querySelector("#tool-hint");
  const ending = document.querySelector("#ending");
  const restart = document.querySelector("#restart");

  const MAX_POPUPS = 12;
  const STEP = 26;
  const RANGE = 125;
  const messages = [
    "Nice try.", "Did you really think that would work?", "Oops. Another one.",
    "You're making quite a mess.", "That button seems popular.",
    "Are you having fun yet?", "Maybe stop clicking things.", "Try moving me."
  ];
  const directions = {
    ArrowLeft: [-1, 0], ArrowRight: [1, 0],
    ArrowUp: [0, -1], ArrowDown: [0, 1]
  };

  // The array holds the live windows, so its length is also the window count.
  let popups = [];
  let selected = null;
  let front = 0;
  let attempts = 0;
  let discovered = false;
  let exposed = false;
  let equipped = false;
  let active = false;
  let finished = false;
  let frame = 0;
  let audioContext;
  let motor;
  let pointer = { x: 0, y: 0 };
  let home = { x: 0, y: 0 };

  const clamp = (value, max) => Math.min(Math.max(0, max), Math.max(0, value));

  // Stage 1: create, select, and move windows.
  function placePopup(popup, x, y) {
    popup.x = clamp(x, desktop.clientWidth - popup.element.offsetWidth - 5);
    popup.y = clamp(y, desktop.clientHeight - popup.element.offsetHeight - 6);
    popup.element.style.left = popup.x + "px";
    popup.element.style.top = popup.y + "px";
  }

  function selectPopup(popup) {
    selected?.element.classList.remove("selected");
    selected = popup;
    if (popup) {
      popup.element.classList.add("selected");
      popup.element.style.zIndex = ++front;
    }
  }

  function createPopup(title, message, x, y) {
    const element = document.createElement("section");
    element.className = "popup";
    element.innerHTML = `
      <header class="title-bar"><span></span><button class="close" type="button" aria-label="Close">×</button></header>
      <div class="popup-body">
        <p class="message"><span class="alert-icon" aria-hidden="true">!</span><span></span></p>
        <button class="ok" type="button">OK</button>
      </div>`;
    element.querySelector(".title-bar span").textContent = title;
    element.querySelector(".message span:last-child").textContent = message;
    const popup = { element, x: 0, y: 0, suction: null };
    windows.append(element);
    popups.push(popup);
    placePopup(popup, x, y);
    selectPopup(popup);

    // Ignore clicks produced at the end of a mouse drag.
    let pressStart;
    let dragged = false;
    element.addEventListener("pointerdown", event => {
      pressStart = { x: event.clientX, y: event.clientY };
      dragged = false;
    });
    element.addEventListener("pointermove", event => {
      if (event.buttons && pressStart &&
          Math.hypot(event.clientX - pressStart.x, event.clientY - pressStart.y) > 5) {
        dragged = true;
      }
    });

    // A single click handler distinguishes buttons from the rest of the window.
    element.addEventListener("click", event => {
      if (popup.suction || (event.detail && dragged)) return;
      if (event.target.closest("button")) {
        attempts++;
        if (popups.length >= MAX_POPUPS) return;
        const message = messages[attempts - 1] ?? "Still here.";
        const shift = attempts % 2 ? 29 : -44;
        const maxX = Math.max(0, desktop.clientWidth - element.offsetWidth - 5);
        const maxY = Math.max(0, desktop.clientHeight - element.offsetHeight - 6);
        const x = clamp(popup.x + shift, maxX);
        const y = clamp(popup.y + 31, maxY);
        createPopup("System Notice", message, x === popup.x ? popup.x - shift : x, y === popup.y ? popup.y - 36 : y);
        checkVacuumDiscovery();
      } else {
        selectPopup(popup);
      }
    });
    return popup;
  }

  function moveSelectedPopup(dx, dy) {
    if (!selected || selected.suction) return;
    placePopup(selected, selected.x + dx * STEP, selected.y + dy * STEP);
    checkVacuumDiscovery();
  }

  // Stage 2: discover the tool only when its entire icon is clear.
  // Also check newly spawned windows so E cannot pick it up through a window.
  function checkVacuumDiscovery() {
    if (equipped || finished) return;
    exposed = !popups.some(({ element, x, y, suction }) =>
      !suction && x < home.x + 72 && x + element.offsetWidth > home.x &&
      y < home.y + 48 && y + element.offsetHeight > home.y
    );
    if (exposed) discovered = true;
    vacuum.hidden = !exposed;
    if (exposed) {
      hint.innerHTML = "<kbd>E</kbd> Pick up";
      placeVacuum(home.x, home.y);
    }
  }

  function placeVacuum(x, y) {
    x = clamp(x, desktop.clientWidth - 72);
    y = clamp(y, desktop.clientHeight - 48);
    vacuum.style.left = x + "px";
    vacuum.style.top = y + "px";
    hint.style.left = Math.min(0, desktop.clientWidth - x - hint.offsetWidth - 3) + "px";
    const fitsBelow = y + 48 + hint.offsetHeight + 3 <= desktop.clientHeight;
    hint.style.top = fitsBelow ? "100%" : -hint.offsetHeight - 3 + "px";
  }

  function followPointer() {
    placeVacuum(pointer.x - 14, pointer.y - 40);
  }

  function equipVacuum() {
    if (finished || !discovered || (!equipped && !exposed)) return;
    equipped = !equipped;
    vacuum.classList.toggle("equipped", equipped);
    if (equipped) {
      hint.innerHTML = "<kbd>SPACE</kbd> Hold to vacuum";
      followPointer();
    } else {
      stopVacuum();
      checkVacuumDiscovery();
    }
  }

  // Stage 3: capture windows near the nozzle, then animate them for 320 ms.
  // Once captured, a window finishes its short animation even after Space is released.
  function animate(now) {
    frame = 0;
    // The nozzle sits near the left edge of the vacuum illustration.
    const nozzleX = Number.parseFloat(vacuum.style.left) + 16;
    const nozzleY = Number.parseFloat(vacuum.style.top) + 40;

    for (const popup of [...popups]) {
      const { element, x, y } = popup;
      const width = element.offsetWidth;
      const height = element.offsetHeight;
      const nearX = Math.max(x, Math.min(nozzleX, x + width));
      const nearY = Math.max(y, Math.min(nozzleY, y + height));
      if (!popup.suction && active && Math.hypot(nozzleX - nearX, nozzleY - nearY) <= RANGE) {
        popup.suction = { start: now, nozzleX, nozzleY };
        element.classList.add("sucking");
        element.inert = true;
      }
      if (!popup.suction) continue;

      if (active) Object.assign(popup.suction, { nozzleX, nozzleY });
      const progress = Math.min(1, (now - popup.suction.start) / 320);
      const travel = progress * progress;
      const dx = popup.suction.nozzleX - x - width / 2;
      const dy = popup.suction.nozzleY - y - height / 2;
      const tilt = Math.sign(dx) * 15 * Math.sin(progress * Math.PI);
      element.style.transform = `translate(${dx * travel}px, ${dy * travel}px) rotate(${tilt}deg) scale(${1 - travel * .98})`;
      element.style.opacity = String(1 - progress ** 4);
      if (progress === 1) removePopup(popup);
    }

    if (active || popups.some(popup => popup.suction)) frame = requestAnimationFrame(animate);
  }

  function startVacuum() {
    if (!equipped || active || finished) return;
    active = true;
    vacuum.classList.add("active");
    startMotor();
    if (!frame) frame = requestAnimationFrame(animate);
  }

  function stopVacuum() {
    active = false;
    vacuum.classList.remove("active");
    if (motor) {
      motor.stop();
      motor = null;
    }
  }

  function removePopup(popup) {
    popup.element.remove();
    popups = popups.filter(window => window !== popup);
    if (selected === popup) selectPopup(popups.findLast(window => !window.suction) ?? null);
    checkCompletion();
  }

  // Stage 4: a quiet loop of filtered noise gives the vacuum its motor sound.
  function startMotor() {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio || motor) return;
    try {
      audioContext ??= new Audio();
      audioContext.resume().catch(() => {});
      const buffer = audioContext.createBuffer(1, audioContext.sampleRate, audioContext.sampleRate);
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) {
        samples[i] = (Math.random() * 2 - 1) * (.72 + .28 * Math.sin(i / samples.length * Math.PI * 2 * 72));
      }
      const source = audioContext.createBufferSource();
      const filter = audioContext.createBiquadFilter();
      const volume = audioContext.createGain();
      source.buffer = buffer;
      source.loop = true;
      filter.type = "lowpass";
      filter.frequency.value = 720;
      volume.gain.value = .20;
      source.connect(filter).connect(volume).connect(audioContext.destination);
      source.addEventListener("ended", () => {
        source.disconnect();
        filter.disconnect();
        volume.disconnect();
      });
      source.start();
      motor = source;
    } catch {
      // The game still works when browser audio is unavailable.
    }
  }

  function checkCompletion() {
    if (popups.length) return;
    finished = true;
    stopVacuum();
    equipped = false;
    vacuum.classList.remove("equipped");
    vacuum.hidden = true;
    ending.hidden = false;
    restart.focus({ preventScroll: true });
  }

  function reset() {
    stopVacuum();
    cancelAnimationFrame(frame);
    frame = 0;
    windows.replaceChildren();
    popups = [];
    selected = null;
    front = attempts = 0;
    discovered = exposed = equipped = finished = false;
    ending.hidden = true;
    vacuum.hidden = true;
    vacuum.classList.remove("equipped");

    const w = desktop.clientWidth;
    const h = desktop.clientHeight;
    const left = Math.max(6, w / 2 - 235);
    const top = Math.max(6, h / 2 - 135);
    const spread = Math.max(0, Math.min(166, w - left - 325));
    pointer = { x: w / 2, y: h / 2 };

    createPopup("Required Action", "Please acknowledge this notification.", left, top);
    createPopup("System Notice", "You have an important message.", left + spread, top + 42);
    createPopup("Status Update", "Your attention is required.", left + spread * .12, top + 88);
    const cover = createPopup("Notification", "Click OK to continue.", left + spread * .75, top + 140);
    home = {
      x: cover.x + cover.element.offsetWidth - 89,
      y: cover.y + cover.element.offsetHeight - 53
    };
    checkVacuumDiscovery();
  }

  desktop.addEventListener("pointermove", event => {
    const bounds = desktop.getBoundingClientRect();
    pointer = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    if (equipped) followPointer();
  });

  window.addEventListener("keydown", event => {
    if (finished || event.altKey || event.ctrlKey || event.metaKey) return;
    const direction = directions[event.key];
    if (Array.isArray(direction)) {
      event.preventDefault(); // Native key repeat keeps held arrows moving.
      moveSelectedPopup(...direction);
    } else if (event.code === "KeyE" && !event.repeat) {
      equipVacuum();
    } else if (event.code === "Space") {
      event.preventDefault(); // Space should also leave focused pop-up buttons alone.
      if (!event.repeat) startVacuum();
    }
  });
  window.addEventListener("keyup", event => {
    if (event.code === "Space") stopVacuum();
  });
  window.addEventListener("blur", stopVacuum);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopVacuum();
  });
  window.addEventListener("resize", () => {
    for (const popup of popups) placePopup(popup, popup.x, popup.y);
    home.x = clamp(home.x, desktop.clientWidth - 72);
    home.y = clamp(home.y, desktop.clientHeight - 48);
    if (equipped) followPointer();
    else checkVacuumDiscovery();
  });
  restart.addEventListener("click", reset);
  reset();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeGame);
} else {
  initializeGame();
}
