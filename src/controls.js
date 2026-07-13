// Dual virtual joysticks + winch button, with keyboard fallback for desktop.
// Output (read every frame):
//   cyclicX  [-1,1]  right stick of real helis; here: left stick horizontal (strafe/roll)
//   cyclicY  [-1,1]  left stick vertical (forward/back pitch)
//   collective [-1,1] right stick vertical (climb/descend)
//   yaw      [-1,1]  right stick horizontal (turn)
//   winch    bool    toggled by button / Space

export class Controls {
  constructor() {
    this.cyclicX = 0; this.cyclicY = 0;
    this.collective = 0; this.yaw = 0;
    this.winch = false;
    this._keys = {};

    this._bindStick(document.getElementById('stickL'), (x, y) => {
      this._stickL = { x, y };
    });
    this._bindStick(document.getElementById('stickR'), (x, y) => {
      this._stickR = { x, y };
    });
    this._stickL = { x: 0, y: 0 };
    this._stickR = { x: 0, y: 0 };

    const btn = document.getElementById('btnWinch');
    const toggle = (e) => { e.preventDefault(); this.winch = !this.winch; btn.classList.toggle('active', this.winch); };
    btn.addEventListener('pointerdown', toggle);

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this._keys[e.code] = true;
      if (e.code === 'Space') { this.winch = !this.winch; btn.classList.toggle('active', this.winch); }
    });
    window.addEventListener('keyup', (e) => { this._keys[e.code] = false; });
  }

  _bindStick(el, cb) {
    const nub = el.querySelector('.nub');
    let pid = null;
    const R = 44; // max nub travel px
    const setFromEvent = (e) => {
      const r = el.getBoundingClientRect();
      let dx = e.clientX - (r.left + r.width / 2);
      let dy = e.clientY - (r.top + r.height / 2);
      const len = Math.hypot(dx, dy);
      if (len > R) { dx *= R / len; dy *= R / len; }
      nub.style.transform = `translate(${dx}px,${dy}px)`;
      cb(dx / R, -dy / R); // up = +1
    };
    el.addEventListener('pointerdown', (e) => {
      pid = e.pointerId; el.setPointerCapture(pid); setFromEvent(e);
    });
    el.addEventListener('pointermove', (e) => { if (e.pointerId === pid) setFromEvent(e); });
    const end = (e) => {
      if (e.pointerId !== pid) return;
      pid = null;
      nub.style.transform = 'translate(0,0)';
      cb(0, 0);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  update() {
    const k = this._keys;
    const kx = (k['KeyD'] ? 1 : 0) - (k['KeyA'] ? 1 : 0);
    const ky = (k['KeyW'] ? 1 : 0) - (k['KeyS'] ? 1 : 0);
    const kc = (k['KeyR'] ? 1 : 0) - (k['KeyF'] ? 1 : 0);
    const kyaw = (k['KeyE'] ? 1 : 0) - (k['KeyQ'] ? 1 : 0);

    this.cyclicX = Math.abs(this._stickL.x) > 0.01 ? this._stickL.x : kx;
    this.cyclicY = Math.abs(this._stickL.y) > 0.01 ? this._stickL.y : ky;
    this.collective = Math.abs(this._stickR.y) > 0.01 ? this._stickR.y : kc;
    this.yaw = Math.abs(this._stickR.x) > 0.01 ? this._stickR.x : kyaw;
  }
}
