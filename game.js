/*  Sky Dash — game engine
    HTML5 Canvas endless runner
    No external dependencies.
*/

(function () {
  'use strict';

  // ── DOM refs ──────────────────────────────────────
  const canvas  = document.getElementById('game-canvas');
  const ctx     = canvas.getContext('2d');
  const hud     = document.getElementById('hud');
  const hudScoreEl = document.getElementById('hud-score');

  const screens = {
    title:    document.getElementById('screen-title'),
    gameover: document.getElementById('screen-gameover'),
    pause:    document.getElementById('screen-pause'),
  };
  const goScore = document.getElementById('go-score');
  const goBest  = document.getElementById('go-best');

  // ── State machine ─────────────────────────────────
  const STATE = { TITLE: 0, PLAYING: 1, PAUSED: 2, DEAD: 3 };
  let state = STATE.TITLE;

  // ── Persistent data ───────────────────────────────
  let bestScore = parseInt(localStorage.getItem('skydash_best') || '0', 10);

  // ── Visual constants ──────────────────────────────
  const COLORS = {
    bg:         '#0a0a1a',
    ground:     '#00f0ff',
    groundDim:  '#004455',
    player:     '#00f0ff',
    playerGlow: 'rgba(0,240,255,0.35)',
    obstacle:   '#ff4de3',
    obstGlow:   'rgba(255,77,227,0.4)',
    particle:   '#ff4de3',
    star:       '#ffffff',
    scoreText:  '#00f0ff',
    trail:      'rgba(0,240,255,0.18)',
  };

  // ── Physics constants ─────────────────────────────
  const GRAVITY      = 0.55;
  const JUMP_VEL     = -13;
  const GROUND_FRAC  = 0.78;   // ground y = canvas.height * this
  const PLAYER_X     = 0.18;   // player x = canvas.width  * this
  const BASE_SPEED   = 5;
  const SPEED_INC    = 0.0015; // per frame
  const MAX_SPEED    = 18;
  const GAP_MIN      = 160;
  const GAP_MAX      = 320;
  const OBSTACLE_W   = 20;

  // ── Runtime variables ─────────────────────────────
  let W, H, groundY, playerX;
  let score, speed, frameCount;
  let player, obstacles, particles, stars;
  let nextObstX, raf;
  let flashTimer = 0;

  // ── Resize ────────────────────────────────────────
  function resize() {
    const container = canvas.parentElement;
    W = container.clientWidth;
    H = container.clientHeight;
    canvas.width  = W;
    canvas.height = H;
    groundY = H * GROUND_FRAC;
    playerX = W * PLAYER_X;
    if (state === STATE.TITLE) drawTitle();
  }

  window.addEventListener('resize', resize);
  resize();

  // ── Stars (background) ────────────────────────────
  function initStars() {
    stars = Array.from({ length: 80 }, () => ({
      x: Math.random() * W,
      y: Math.random() * groundY * 0.9,
      r: Math.random() * 1.5 + 0.3,
      speed: Math.random() * 0.4 + 0.1,
      alpha: Math.random() * 0.6 + 0.2,
    }));
  }

  function updateStars() {
    for (const s of stars) {
      s.x -= s.speed * (speed / BASE_SPEED);
      if (s.x < 0) { s.x = W; s.y = Math.random() * groundY * 0.9; }
    }
  }

  function drawStars() {
    for (const s of stars) {
      ctx.save();
      ctx.globalAlpha = s.alpha;
      ctx.fillStyle = COLORS.star;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ── Ground grid ───────────────────────────────────
  let gridOffset = 0;
  function drawGround() {
    // Solid line
    ctx.strokeStyle = COLORS.ground;
    ctx.lineWidth = 2;
    ctx.shadowColor = COLORS.ground;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    ctx.lineTo(W, groundY);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Perspective grid lines
    ctx.strokeStyle = COLORS.groundDim;
    ctx.lineWidth = 0.5;
    const gridSpacing = 60;
    gridOffset = (gridOffset + speed * 0.6) % gridSpacing;
    for (let x = -gridOffset; x < W; x += gridSpacing) {
      ctx.beginPath();
      ctx.moveTo(x, groundY);
      ctx.lineTo(x + (W / 2 - x) * 0.3, H);
      ctx.stroke();
    }
    // Horizontal depth lines
    for (let i = 0; i < 4; i++) {
      const y = groundY + (H - groundY) * (i / 4) + (H - groundY) * 0.1;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
  }

  // ── Player ────────────────────────────────────────
  function initPlayer() {
    player = {
      x: playerX,
      y: groundY - 28,
      vy: 0,
      w: 28,
      h: 28,
      jumps: 0,       // tracks how many jumps used this airtime
      maxJumps: 2,
      trail: [],
      dead: false,
    };
  }

  function jumpPlayer() {
    if (player.jumps < player.maxJumps) {
      player.vy = JUMP_VEL - (player.jumps * 2);
      player.jumps++;
      spawnJumpParticles();
    }
  }

  function updatePlayer() {
    player.vy += GRAVITY;
    player.y  += player.vy;

    // Land
    if (player.y >= groundY - player.h) {
      player.y  = groundY - player.h;
      player.vy = 0;
      player.jumps = 0;
    }

    // Trail
    player.trail.unshift({ x: player.x, y: player.y, alpha: 0.5 });
    if (player.trail.length > 8) player.trail.pop();
    for (const t of player.trail) t.alpha *= 0.75;
  }

  function drawPlayer() {
    // Trail
    for (const t of player.trail) {
      ctx.save();
      ctx.globalAlpha = t.alpha;
      ctx.fillStyle = COLORS.trail;
      ctx.fillRect(t.x - player.w / 2, t.y, player.w, player.h);
      ctx.restore();
    }

    // Glow
    const cx = player.x, cy = player.y + player.h / 2;
    const grad = ctx.createRadialGradient(cx, cy, 2, cx, cy, player.w * 1.6);
    grad.addColorStop(0, COLORS.playerGlow);
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.fillRect(cx - player.w * 1.6, cy - player.w * 1.6,
                 player.w * 3.2, player.w * 3.2);

    // Body (sharp diamond ship shape)
    ctx.save();
    ctx.shadowColor = COLORS.ground;
    ctx.shadowBlur = 14;
    ctx.strokeStyle = COLORS.player;
    ctx.lineWidth = 2.5;
    ctx.fillStyle = 'rgba(0,240,255,0.15)';
    ctx.beginPath();
    ctx.moveTo(player.x + player.w / 2, player.y + player.h / 2); // right tip
    ctx.lineTo(player.x,                player.y);                 // top
    ctx.lineTo(player.x - player.w / 2, player.y + player.h / 2); // left
    ctx.lineTo(player.x,                player.y + player.h);      // bottom
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // ── Obstacles ─────────────────────────────────────
  function initObstacles() {
    obstacles = [];
    nextObstX = W + 200;
  }

  function spawnObstacle() {
    const colH = 40 + Math.random() * (groundY * 0.55);
    const isTop = Math.random() < 0.4;  // 40 % are ceiling obstacles
    obstacles.push({
      x: W + 20,
      w: OBSTACLE_W,
      h: colH,
      y: isTop ? 0 : groundY - colH,
      top: isTop,
    });
    nextObstX = W + GAP_MIN + Math.random() * (GAP_MAX - GAP_MIN);
  }

  function updateObstacles() {
    for (const o of obstacles) o.x -= speed;

    // Cull off-screen
    while (obstacles.length && obstacles[0].x + obstacles[0].w < 0) {
      obstacles.shift();
    }

    // Spawn
    if (obstacles.length === 0 || obstacles[obstacles.length - 1].x < nextObstX - W) {
      spawnObstacle();
    }
  }

  function drawObstacles() {
    for (const o of obstacles) {
      ctx.save();
      ctx.shadowColor = COLORS.obstacle;
      ctx.shadowBlur  = 16;
      ctx.fillStyle   = COLORS.obstacle;

      // Draw body
      ctx.fillRect(o.x, o.y, o.w, o.h);

      // Glow gradient overlay
      const g = ctx.createLinearGradient(o.x, o.y, o.x + o.w, o.y);
      g.addColorStop(0, 'rgba(255,255,255,0.15)');
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.fillRect(o.x, o.y, o.w, o.h);

      // Cap indicator
      ctx.fillStyle = '#ffffff';
      if (o.top) {
        ctx.fillRect(o.x - 4, o.h - 6, o.w + 8, 6);
      } else {
        ctx.fillRect(o.x - 4, o.y, o.w + 8, 6);
      }

      ctx.restore();
    }
  }

  // ── Collision ─────────────────────────────────────
  function checkCollisions() {
    const px = player.x - player.w / 2 + 4;
    const py = player.y + 4;
    const pw = player.w - 8;
    const ph = player.h - 8;

    for (const o of obstacles) {
      if (px + pw > o.x + 2 &&
          px     < o.x + o.w - 2 &&
          py + ph > o.y &&
          py     < o.y + o.h) {
        return true;
      }
    }
    return false;
  }

  // ── Particles ─────────────────────────────────────
  function initParticles() { particles = []; }

  function spawnParticles(x, y, count, color, speed_) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd   = (Math.random() * speed_) + 1;
      particles.push({
        x, y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd - 2,
        life: 1,
        decay: 0.03 + Math.random() * 0.04,
        r: 2 + Math.random() * 3,
        color,
      });
    }
  }

  function spawnJumpParticles() {
    spawnParticles(player.x, player.y + player.h, 8, COLORS.ground, 3);
  }

  function spawnDeathParticles() {
    spawnParticles(player.x, player.y + player.h / 2, 30, COLORS.obstacle, 7);
    spawnParticles(player.x, player.y + player.h / 2, 20, COLORS.player, 5);
  }

  function updateParticles() {
    for (const p of particles) {
      p.x    += p.vx;
      p.y    += p.vy;
      p.vy   += 0.15;
      p.life -= p.decay;
    }
    particles = particles.filter(p => p.life > 0);
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.save();
      ctx.globalAlpha = p.life;
      ctx.fillStyle   = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur  = 6;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ── Score & difficulty ────────────────────────────
  function updateScore() {
    score++;
    speed = Math.min(BASE_SPEED + frameCount * SPEED_INC, MAX_SPEED);
    if (score > bestScore) {
      bestScore = score;
      localStorage.setItem('skydash_best', bestScore);
    }
    hudScoreEl.textContent = score;
  }

  // ── Screen flash (hit effect) ─────────────────────
  function triggerFlash() { flashTimer = 8; }

  function drawFlash() {
    if (flashTimer > 0) {
      ctx.save();
      ctx.globalAlpha = flashTimer / 8 * 0.35;
      ctx.fillStyle   = '#ff0000';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
      flashTimer--;
    }
  }

  // ── Distance marker lines (visual speed cue) ──────
  let markers = [];
  function updateMarkers() {
    if (Math.random() < 0.04) {
      markers.push({ x: W, alpha: 0.6, h: 2 + Math.random() * 4 });
    }
    for (const m of markers) {
      m.x -= speed * 0.8;
      m.alpha -= 0.005;
    }
    markers = markers.filter(m => m.alpha > 0 && m.x > 0);
  }
  function drawMarkers() {
    for (const m of markers) {
      ctx.save();
      ctx.globalAlpha = m.alpha;
      ctx.strokeStyle = COLORS.accent2 || '#ff4de3';
      ctx.lineWidth = m.h;
      ctx.beginPath();
      ctx.moveTo(m.x, groundY - 2); ctx.lineTo(m.x, groundY + 4);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ── Draw title preview ────────────────────────────
  function drawTitle() {
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, W, H);
    if (stars) drawStars();
    drawGround();
  }

  // ── Main loop ─────────────────────────────────────
  function loop() {
    if (state !== STATE.PLAYING) return;

    frameCount++;
    updateScore();
    updateStars();
    updateMarkers();
    updatePlayer();
    updateObstacles();
    updateParticles();

    // Draw
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, W, H);
    drawStars();
    drawMarkers();
    drawGround();
    drawObstacles();
    drawPlayer();
    drawParticles();
    drawFlash();

    // Collision check
    if (checkCollisions()) {
      triggerFlash();
      spawnDeathParticles();
      die();
      return;
    }

    raf = requestAnimationFrame(loop);
  }

  // ── Game lifecycle ────────────────────────────────
  function startGame() {
    score      = 0;
    frameCount = 0;
    speed      = BASE_SPEED;
    gridOffset = 0;
    markers    = [];
    initPlayer();
    initObstacles();
    initParticles();
    initStars();
    showScreen(null);
    hud.classList.add('visible');
    hudScoreEl.textContent = '0';
    state = STATE.PLAYING;
    raf = requestAnimationFrame(loop);
  }

  function die() {
    state = STATE.DEAD;
    hud.classList.remove('visible');
    // Let particles finish for a moment
    setTimeout(() => {
      goScore.textContent = score;
      goBest.textContent  = `Best: ${bestScore}`;
      showScreen('gameover');
    }, 700);
  }

  function pauseGame() {
    if (state !== STATE.PLAYING) return;
    state = STATE.PAUSED;
    cancelAnimationFrame(raf);
    showScreen('pause');
  }

  function resumeGame() {
    if (state !== STATE.PAUSED) return;
    showScreen(null);
    state = STATE.PLAYING;
    raf = requestAnimationFrame(loop);
  }

  // ── Screen helpers ────────────────────────────────
  function showScreen(name) {
    for (const [k, el] of Object.entries(screens)) {
      el.classList.toggle('active', k === name);
    }
  }

  // ── Input ─────────────────────────────────────────
  function handleJump() {
    if (state === STATE.PLAYING) jumpPlayer();
  }

  document.addEventListener('keydown', e => {
    if (e.code === 'Space' || e.code === 'ArrowUp') {
      e.preventDefault();
      handleJump();
    }
    if (e.code === 'Escape') {
      if (state === STATE.PLAYING) pauseGame();
      else if (state === STATE.PAUSED) resumeGame();
    }
  });

  canvas.addEventListener('click', handleJump);
  canvas.addEventListener('touchstart', e => { e.preventDefault(); handleJump(); }, { passive: false });

  document.getElementById('btn-start').addEventListener('click', startGame);
  document.getElementById('btn-retry').addEventListener('click', startGame);
  document.getElementById('btn-resume').addEventListener('click', resumeGame);
  document.getElementById('btn-pause').addEventListener('click', pauseGame);

  // ── Boot ──────────────────────────────────────────
  showScreen('title');
  drawTitle();

})();
